using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Hormes.Windows.Audio;

namespace Hormes.Windows.Speech;

/// <summary>
/// Records a lecture or a meeting from the microphone and transcribes it on this machine (the same Whisper model as
/// the voice turn; no audio leaves the PC, none is kept). The transcript is written as it goes to
/// <c>&lt;courses&gt;/&lt;course&gt;/Transcripts/&lt;date time title&gt;.md</c>, so the engine's course library indexes it
/// with the slides and homework and the brain can answer from it. A chunk is cut at a pause after 25 s, or at 40 s.
/// </summary>
public sealed class LectureRecorder : IDisposable
{
    private const int MinChunkSeconds = 25, MaxChunkSeconds = 40;
    private const float QuietRms = 0.012f;

    private readonly WhisperTranscriber whisper;
    private readonly object gate = new();
    private MicCapture? mic;
    private List<float> pending = new();
    private int pendingRate = 16000;
    private double chunkStart;
    /// <summary>Seconds of audio received; loopback skips silence and a fed recording runs ahead of the clock, so a
    /// stamp is the later of this and the wall clock.</summary>
    private double audioSeconds;
    private double quietFor;
    private Task writes = Task.CompletedTask;
    private CancellationTokenSource? cts;

    public LectureRecorder(WhisperTranscriber whisper) => this.whisper = whisper;

    public bool Recording { get; private set; }
    public string? FilePath { get; private set; }
    public DateTime StartedAt { get; private set; }
    public string Source { get; private set; } = "microphone";
    public TimeSpan Elapsed => Recording ? DateTime.Now - StartedAt : TimeSpan.Zero;
    public event Action<string>? Problem;

    /// <summary>The courses root: HORMES_COURSES_DIR, else ~/Hormes/Courses (the engine's default).</summary>
    public static string CoursesRoot => Environment.GetEnvironmentVariable("HORMES_COURSES_DIR") is { Length: > 0 } custom
        ? custom
        : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Hormes", "Courses");

    /// <summary>The course folders under the root, by name.</summary>
    public static IReadOnlyList<string> Courses()
    {
        try
        {
            return Directory.Exists(CoursesRoot)
                ? Directory.GetDirectories(CoursesRoot).Select(Path.GetFileName).Where(n => n is { Length: > 0 } && n[0] != '.' && n != "Meetings").Cast<string>().OrderBy(n => n).ToList()
                : Array.Empty<string>();
        }
        catch { return Array.Empty<string>(); }
    }

    /// <summary>Start recording into a course's Transcripts folder, or Meetings when course is null.</summary>
    /// <param name="capture">false: no device opens; samples arrive through <see cref="Feed"/> (the Checks drive it so).</param>
    public void Start(string? course, string title, bool computerAudio = false, bool capture = true)
    {
        lock (gate)
        {
            if (Recording) return;
            var dir = Path.Combine(CoursesRoot, course ?? "Meetings", "Transcripts");
            Directory.CreateDirectory(dir);
            StartedAt = DateTime.Now;
            var safe = string.Concat(title.Select(c => Path.GetInvalidFileNameChars().Contains(c) ? '-' : c)).Trim();
            FilePath = Path.Combine(dir, $"{StartedAt:yyyy-MM-dd HHmm} {safe}.md");
            File.WriteAllText(FilePath, $"# {title}\n\n{(course is null ? "Meeting" : course)} · recorded {StartedAt:dddd d MMMM yyyy, HH:mm} · {(computerAudio ? "computer audio" : "microphone")} · transcribed on this PC by Whisper; may contain mistakes.\n\n", new UTF8Encoding(false));
            pending = new List<float>();
            chunkStart = 0;
            audioSeconds = 0;
            quietFor = 0;
            cts = new CancellationTokenSource();
            mic = new MicCapture(loopback: computerAudio);
            Source = computerAudio ? "computer audio" : "microphone";
            mic.Samples += OnSamples;
            mic.Problem += p => Problem?.Invoke(p);
            if (capture) mic.Start();
            Recording = true;
        }
        _ = whisper.EnsureLoadedAsync(cts!.Token).ContinueWith(t => { if (t.IsFaulted) Problem?.Invoke($"transcription model unavailable: {t.Exception?.GetBaseException().Message}"); }, TaskScheduler.Default);
    }

    /// <summary>Stop, transcribe what is left, and return the transcript's path once every chunk is written.</summary>
    public async Task<string?> StopAsync()
    {
        float[] rest;
        int rate;
        lock (gate)
        {
            if (!Recording) return null;
            Recording = false;
            mic?.Dispose();
            mic = null;
            rest = pending.ToArray();
            rate = pendingRate;
            pending = new List<float>();
        }
        Queue(rest, rate, chunkStart);
        await writes.ConfigureAwait(false);
        if (FilePath is not null) File.AppendAllText(FilePath, $"\n_Recording ended {DateTime.Now:HH:mm}._\n", new UTF8Encoding(false));
        return FilePath;
    }

    /// <summary>Samples as the capture delivers them (mono, any rate).</summary>
    public void Feed(float[] samples, int rate) => OnSamples(samples, rate, 0);

    private void OnSamples(float[] samples, int rate, double at)
    {
        float[]? cut = null;
        double cutAt = 0;
        lock (gate)
        {
            if (!Recording) return;
            pendingRate = rate;
            if (pending.Count == 0) chunkStart = Math.Max(audioSeconds, (DateTime.Now - StartedAt).TotalSeconds);
            pending.AddRange(samples);
            audioSeconds += (double)samples.Length / rate;
            double sum = 0;
            foreach (var s in samples) sum += s * s;
            var rms = samples.Length > 0 ? Math.Sqrt(sum / samples.Length) : 0;
            quietFor = rms < QuietRms ? quietFor + (double)samples.Length / rate : 0;
            var seconds = (double)pending.Count / rate;
            if ((seconds >= MinChunkSeconds && quietFor >= 0.4) || seconds >= MaxChunkSeconds)
            {
                cut = pending.ToArray();
                cutAt = chunkStart;
                pending = new List<float>();
                quietFor = 0;
            }
        }
        if (cut is not null) Queue(cut, rate, cutAt);
    }

    /// <summary>Chunks are transcribed and appended strictly in order.</summary>
    private void Queue(float[] samples, int rate, double at)
    {
        if (samples.Length == 0 || FilePath is null) return;
        var path = FilePath;
        var token = cts?.Token ?? CancellationToken.None;
        lock (gate)
        {
            writes = writes.ContinueWith(async _ =>
            {
                try
                {
                    var text = await whisper.TranscribeAsync(WhisperTranscriber.Resample(samples, rate), token).ConfigureAwait(false);
                    if (text.Length == 0) return;
                    var stamp = TimeSpan.FromSeconds(at);
                    File.AppendAllText(path, $"[{(int)stamp.TotalMinutes:00}:{stamp.Seconds:00}] {text}\n\n", new UTF8Encoding(false));
                }
                catch (OperationCanceledException) { }
                catch (Exception e) { Problem?.Invoke($"transcription failed for a chunk: {e.Message}"); }
            }, TaskScheduler.Default).Unwrap();
        }
    }

    public void Dispose()
    {
        lock (gate)
        {
            Recording = false;
            mic?.Dispose();
            mic = null;
        }
        cts?.Cancel();
    }
}

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Hormes.Windows.Audio;
using Hormes.Windows.Speech;
using NAudio.Wave;

// Offline checks for the Windows app's ears:
//   dotnet run --project apps/windows/Checks                      claps + endpointer
//   dotnet run --project apps/windows/Checks -- --whisper a.wav   also transcribe a recording through the real path
// Exit code 1 when any check fails.

var failures = 0;
void Check(bool ok, string what, string detail = "")
{
    Console.WriteLine($"{(ok ? "ok  " : "FAIL")} {what}{(ok || detail.Length == 0 ? "" : $": {detail}")}");
    if (!ok) failures++;
}

var repo = FindRepo();

// ------------------------------------------------------------------ claps (apps/mac ClapRecordingChecks)

static List<double> Detections(IEnumerable<ClapDetector.Frame> frames)
{
    var detector = new ClapDetector();
    return frames.Where(detector.Feed).Select(f => f.At).ToList();
}

var fixture = Path.Combine(repo, "apps", "mac", "Scripts", "fixtures", "clap-recordings.json");
using (var doc = JsonDocument.Parse(File.ReadAllBytes(fixture)))
{
    foreach (var rec in doc.RootElement.EnumerateArray())
    {
        var name = rec.GetProperty("name").GetString();
        var clapsAt = rec.GetProperty("claps").EnumerateArray().Select(x => x.GetDouble()).ToArray();
        var frames = rec.GetProperty("frames").EnumerateArray().Select(f => new ClapDetector.Frame(
            f.GetProperty("at").GetDouble(), f.GetProperty("duration").GetDouble(), f.GetProperty("rms").GetDouble(),
            f.GetProperty("peak").GetDouble(), f.GetProperty("highFrequency").GetDouble())).ToList();
        foreach (var gain in new[] { 1.0, 0.5, 0.25 })
        {
            var hits = Detections(frames.Select(f => f with { Rms = f.Rms * gain, Peak = f.Peak * gain }));
            Check(hits.Count == 1 && hits[0] >= clapsAt[1] - 0.15 && hits[0] <= clapsAt[1] + 0.10,
                $"{name} detected once at gain {gain}", string.Join(", ", hits));
        }
        foreach (var removed in new[] { 0, 1 })
        {
            var mid = (clapsAt[0] + clapsAt[1]) / 2;
            var quiet = frames.Select(f => f.At >= clapsAt[0] && f.At <= clapsAt[1] && (removed == 0 ? f.At < mid : f.At >= mid)
                ? f with { Rms = 0.001, Peak = 0.002, HighFrequency = 0.001 } : f);
            Check(Detections(quiet).Count == 0, $"{name} with clap {removed + 1} removed stays quiet");
        }
    }
}

// The extractor's features do not depend on how the capture chops the stream.
{
    var samples = Enumerable.Range(0, 4800).Select(i => (float)(Math.Sin(i * 0.27) * 0.2)).ToArray();
    List<ClapDetector.Frame> Extract(int block)
    {
        var x = new ClapFrameExtractor();
        var all = new List<ClapDetector.Frame>();
        for (var o = 0; o < samples.Length; o += block)
            all.AddRange(x.Frames(samples.AsSpan(o, Math.Min(block, samples.Length - o)), 48000, o / 48000.0));
        return all;
    }
    var whole = Extract(samples.Length);
    Check(whole.Count == 10 && whole.All(f => Math.Abs(f.Duration - 0.01) < 1e-12), "feature windows stay exactly 10 ms");
    static bool Same(ClapDetector.Frame a, ClapDetector.Frame b) =>
        Math.Abs(a.At - b.At) < 1e-12 && a.Rms == b.Rms && a.Peak == b.Peak && a.HighFrequency == b.HighFrequency;
    foreach (var block in new[] { 32, 512, 1024, 4096 })
    {
        var pieces = Extract(block);
        Check(pieces.Count == whole.Count && pieces.Zip(whole).All(p => Same(p.First, p.Second)), $"features ignore buffer boundaries ({block})");
    }
}

// ------------------------------------------------------------------ endpointer

{
    // 30 ms frames: 1 s of room noise, 2 s of speech, a 0.9 s pause to think, 1.5 s more speech, then quiet.
    var rng = new Random(7);
    double Noise() => 0.003 + rng.NextDouble() * 0.002;
    double Voice() => 0.05 + rng.NextDouble() * 0.06;
    var plan = new List<(double rms, string part)>();
    void Add(double seconds, Func<double> rms, string part) { for (var i = 0; i < (int)(seconds / 0.03); i++) plan.Add((rms(), part)); }
    Add(1.0, Noise, "lead");
    Add(2.0, Voice, "speech");
    Add(0.9, Noise, "pause");
    Add(1.5, Voice, "speech");
    Add(4.0, Noise, "tail");
    var ep = new Endpointer();
    ep.Reset();
    var doneAt = -1.0;
    for (var i = 0; i < plan.Count; i++)
    {
        if (ep.Feed(plan[i].rms) != Endpointer.Verdict.Done) continue;
        doneAt = (i + 1) * 0.03;
        break;
    }
    var lastSpeech = 1.0 + 2.0 + 0.9 + 1.5;
    Check(doneAt > lastSpeech, "a 0.9 s pause inside a turn does not end it", $"ended at {doneAt:0.00} s");
    Check(Math.Abs(doneAt - (lastSpeech + 2.0)) < 0.15, "the turn ends 2 s after the last word", $"ended at {doneAt:0.00} s, last word {lastSpeech:0.00} s");

    var quiet = new Endpointer { NoSpeechTimeout = TimeSpan.FromSeconds(3) };
    quiet.Reset();
    var verdict = Endpointer.Verdict.Waiting;
    for (var i = 0; i < 200 && verdict == Endpointer.Verdict.Waiting; i++) verdict = quiet.Feed(Noise());
    Check(verdict == Endpointer.Verdict.NoSpeech, "silence ends the turn empty after the timeout");

    var blip = new Endpointer();
    blip.Reset();
    var seq = Enumerable.Repeat(0.004, 20).Concat(Enumerable.Repeat(0.2, 3)).Concat(Enumerable.Repeat(0.004, 70)).ToList();
    var verdicts = seq.Select(blip.Feed).ToList();
    Check(!verdicts.Contains(Endpointer.Verdict.Done), "a cough alone is not a turn");
}

Check(WhisperTranscriber.Clean(" [BLANK_AUDIO] ") == "" && WhisperTranscriber.Clean(" Thank you. ") == "" && WhisperTranscriber.Clean(" Open Spotify. ") == "Open Spotify.",
    "Whisper's filler on silence is dropped, real words kept");

// ------------------------------------------------------------------ whisper, end to end on a recording

var wavArg = Array.IndexOf(args, "--whisper");
if (wavArg >= 0 && wavArg + 1 < args.Length)
{
    var path = args[wavArg + 1];
    using var reader = new AudioFileReader(path);
    var rate = reader.WaveFormat.SampleRate;
    var channels = reader.WaveFormat.Channels;
    var interleaved = new List<float>();
    var buf = new float[rate * channels];
    int n;
    while ((n = reader.Read(buf.AsSpan())) > 0) interleaved.AddRange(buf.Take(n));
    var mono = Enumerable.Range(0, interleaved.Count / channels).Select(i => Enumerable.Range(0, channels).Average(c => interleaved[i * channels + c])).Select(x => (float)x).ToArray();

    // The live path: 30 ms frames through the endpointer; the turn is what it keeps.
    var ep = new Endpointer();
    ep.Reset();
    var frame = (int)(rate * 0.03);
    var end = mono.Length;
    for (var o = 0; o + frame <= mono.Length; o += frame)
    {
        var rms = Math.Sqrt(mono.Skip(o).Take(frame).Average(x => (double)x * x));
        if (ep.Feed(rms) is Endpointer.Verdict.Done or Endpointer.Verdict.NoSpeech) { end = o + frame; break; }
    }
    Console.WriteLine($"     recording {mono.Length / (double)rate:0.00} s; the endpointer ended the turn at {end / (double)rate:0.00} s");

    // --runtime cpu|vulkan pins whisper.cpp's backend (default: Whisper.net's own order, GPU first).
    var runtime = args.SkipWhile(a => a != "--runtime").Skip(1).FirstOrDefault();
    if (runtime is not null)
        Whisper.net.LibraryLoader.RuntimeOptions.RuntimeLibraryOrder = new() { Enum.Parse<Whisper.net.LibraryLoader.RuntimeLibrary>(runtime, ignoreCase: true) };
    await using var whisper = new WhisperTranscriber();
    var sw = Stopwatch.StartNew();
    await whisper.EnsureLoadedAsync();
    Console.WriteLine($"     model loaded in {sw.ElapsedMilliseconds} ms on {whisper.Runtime}");
    var audio16k = WhisperTranscriber.Resample(mono[..end], rate);
    var text = "";
    foreach (var pass in new[] { "cold", "warm" })
    {
        sw.Restart();
        text = await whisper.TranscribeAsync(audio16k);
        Console.WriteLine($"     {pass}: transcribed {end / (double)rate:0.0} s of audio in {sw.ElapsedMilliseconds} ms: \"{text}\"");
    }
    // The whole ear, in real time: VoiceInput fed the recording 20 ms at a time (as the mic would), the endpointer
    // deciding the end, the early transcription racing it. What counts is how long after the turn ends the text lands.
    await using (var ears = new VoiceInput(useMic: false))
    {
        var heard = new TaskCompletionSource<string>();
        var clock = Stopwatch.StartNew();
        TimeSpan? turnEnded = null;
        ears.StateChanged += st => { if (st == VoiceInput.State.Transcribing) turnEnded ??= clock.Elapsed; };
        ears.Heard += t => heard.TrySetResult(t);
        ears.Notice += t => heard.TrySetResult($"(notice: {t})");
        await ears.WarmUpAsync();
        ears.Begin();
        clock.Restart();
        var chunk = rate / 50;
        var padded = mono.Concat(new float[rate * 4]).ToArray();
        for (var o = 0; o + chunk <= padded.Length && !heard.Task.IsCompleted; o += chunk)
        {
            var due = TimeSpan.FromSeconds(o / (double)rate);
            if (due > clock.Elapsed) await Task.Delay(due - clock.Elapsed);
            ears.Feed(padded[o..(o + chunk)], rate, o / (double)rate);
        }
        var said = await heard.Task.WaitAsync(TimeSpan.FromSeconds(60));
        var lag = turnEnded is { } ended ? (clock.Elapsed - ended).TotalMilliseconds : double.NaN;
        Console.WriteLine($"     live path: turn ended at {turnEnded?.TotalSeconds:0.00} s; text {lag:0} ms later: \"{said}\"");
        text = said;
    }

    var expect = args.SkipWhile(a => a != "--expect").Skip(1).FirstOrDefault();
    if (expect is not null)
    {
        static string Norm(string s) => new string(s.ToLowerInvariant().Where(char.IsLetterOrDigit).ToArray());
        var words = expect.Split(' ', StringSplitOptions.RemoveEmptyEntries).Select(Norm).Where(w => w.Length > 0).ToList();
        var got = Norm(text);
        var found = words.Count(w => got.Contains(w));
        Check(found >= words.Count * 0.9, $"Whisper heard {found}/{words.Count} expected words, across the pause");
    }
}

Console.WriteLine(failures == 0 ? "all checks passed" : $"{failures} check(s) failed");
return failures == 0 ? 0 : 1;

static string FindRepo()
{
    for (var d = new DirectoryInfo(AppContext.BaseDirectory); d is not null; d = d.Parent)
        if (File.Exists(Path.Combine(d.FullName, "pnpm-workspace.yaml"))) return d.FullName;
    throw new InvalidOperationException("run from inside the Hormes checkout");
}

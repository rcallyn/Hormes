using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Hormes.Windows.Audio;

namespace Hormes.Windows.Speech;

/// <summary>
/// Hormes's ears on Windows. The microphone stays open while "listen for a double clap" is on (the clap detector
/// reads 10 ms features of it, on this machine, and keeps nothing); a double clap or the notch's mic button starts a
/// turn. The turn records until <see cref="Endpointer"/> hears User finish (pauses inside a sentence do not end it),
/// then Whisper transcribes it on-device and <see cref="Heard"/> hands the text on. The audio is dropped after.
/// </summary>
public sealed class VoiceInput : IAsyncDisposable
{
    public enum State { Idle, Listening, Transcribing }

    private const double EndpointFrameSeconds = 0.03;

    private readonly MicCapture mic = new();
    private readonly WhisperTranscriber whisper = new();
    private readonly ClapDetector claps = new();
    private readonly ClapFrameExtractor clapFrames = new();
    private readonly Endpointer endpointer = new();
    private readonly object gate = new();
    private readonly List<float> turn = new();
    /// <summary>The last second of 30 ms RMS values before a turn: the endpointer's floor starts from their median.</summary>
    private readonly Queue<double> recentRms = new();
    private float[] frameBuffer = Array.Empty<float>();
    private int frameFill;
    private int rate;
    private bool clapEnabled;
    private CancellationTokenSource? transcribing;
    /// <summary>
    /// The early transcription: started once User has been quiet <see cref="EarlyAfter"/> s, on everything said so far,
    /// so the text is ready about when the endpointer decides the turn is over. Dropped if User speaks again.
    /// </summary>
    private Task<string>? early;
    private CancellationTokenSource? earlyCts;
    private const double EarlyAfter = 0.7;
    /// <summary>The last early transcription started, dropped or not: Whisper cannot be stopped mid-run, so a new one waits it out rather than queueing behind it.</summary>
    private Task? earlyRunning;

    public State Current { get; private set; } = State.Idle;

    /// <summary>Sample-clock time of the newest audio; claps are not listened for before <see cref="clapsFrom"/>.</summary>
    private double lastAt;
    private double clapsFrom;
    private bool speakerActive;

    /// <summary>
    /// Hormes is speaking (ElevenLabs): its own voice through the speakers must not wake it. Claps resume 0.8 s after it
    /// stops.
    /// </summary>
    public bool SpeakerActive
    {
        get => speakerActive;
        set
        {
            speakerActive = value;
            if (!value) clapsFrom = Math.Max(clapsFrom, lastAt + 0.8);
        }
    }

    public event Action<State>? StateChanged;
    /// <summary>The mic's RMS every 30 ms while a turn listens, for the voice bars.</summary>
    public event Action<double>? Level;
    /// <summary>What User said, transcribed. Never empty.</summary>
    public event Action<string>? Heard;
    /// <summary>A turn that heard nothing usable ended.</summary>
    public event Action<string>? Notice;
    public event Action<double>? ModelDownloadProgress
    {
        add => whisper.DownloadProgress += value;
        remove => whisper.DownloadProgress -= value;
    }

    public string? Runtime => whisper.Runtime;

    /// <summary>False only for the checks, which feed a recording (<see cref="Feed"/>): the microphone stays shut.</summary>
    private readonly bool useMic;

    public VoiceInput() : this(useMic: true) { }

    internal VoiceInput(bool useMic)
    {
        this.useMic = useMic;
        mic.Samples += OnSamples;
        mic.Problem += p => { AppLog.Write($"mic: {p}"); Notice?.Invoke(p); };
    }

    /// <summary>Listen for a double clap (the mic stays open), or not (the mic opens only for a turn).</summary>
    public bool ClapEnabled
    {
        get => clapEnabled;
        set
        {
            clapEnabled = value;
            if (value && useMic) mic.Start();
            else if (Current == State.Idle) mic.Stop();
        }
    }

    /// <summary>Load Whisper in the background (downloading it the first time) so the first turn is not slow.</summary>
    public Task WarmUpAsync() => Task.Run(async () =>
    {
        try { await whisper.EnsureLoadedAsync().ConfigureAwait(false); }
        catch (Exception e) { AppLog.Write($"whisper: not ready: {e}"); Notice?.Invoke($"speech model not ready: {e.Message}"); }
    });

    /// <summary>The mic button: start a turn, or end the one listening now and transcribe what it has.</summary>
    public void Toggle()
    {
        if (Current == State.Listening) Finish(true);
        else if (Current == State.Idle) Begin();
    }

    public void Begin()
    {
        lock (gate)
        {
            if (Current != State.Idle) return;
            DropEarly();
            turn.Clear();
            var seed = recentRms.Count > 0 ? recentRms.OrderBy(x => x).ElementAt(recentRms.Count / 2) : -1;
            endpointer.Reset(seed);
            SetState(State.Listening);
        }
        if (useMic) mic.Start();
    }

    /// <summary>Stop: drop the turn (listening) or its transcription (transcribing), unheard.</summary>
    public void Cancel()
    {
        DropEarly();
        lock (gate)
        {
            transcribing?.Cancel();
            turn.Clear();
            if (Current != State.Idle) SetState(State.Idle);
        }
        if (!clapEnabled) StopMicSoon();
    }

    /// <summary>The checks drive the ears with a recording instead of the microphone (apps/windows/Checks).</summary>
    internal void Feed(float[] samples, int sampleRate, double at) => OnSamples(samples, sampleRate, at);

    private void OnSamples(float[] samples, int sampleRate, double at)
    {
        if (rate != sampleRate)
        {
            rate = sampleRate;
            frameBuffer = new float[(int)(sampleRate * EndpointFrameSeconds)];
            frameFill = 0;
        }

        lastAt = at;
        // Claps: only while nothing else is going on, and not right after a turn or while Hormes speaks.
        if (Current == State.Idle && clapEnabled && !speakerActive && at >= clapsFrom)
        {
            foreach (var f in clapFrames.Frames(samples, sampleRate, at))
            {
                if (!claps.Feed(f)) continue;
                AppLog.Write($"voice: double clap at {f.At:0.00} s; listening");
                Begin();
                break;
            }
        }

        lock (gate)
        {
            if (Current == State.Listening) turn.AddRange(samples);
        }

        // 30 ms frames: the floor while idle, the endpointer and the bars while listening.
        foreach (var s in samples)
        {
            frameBuffer[frameFill++] = s;
            if (frameFill < frameBuffer.Length) continue;
            frameFill = 0;
            double sum = 0;
            foreach (var v in frameBuffer) sum += v * v;
            var rms = Math.Sqrt(sum / frameBuffer.Length);
            if (Current != State.Listening)
            {
                recentRms.Enqueue(rms);
                while (recentRms.Count > 33) recentRms.Dequeue();
                continue;
            }
            Level?.Invoke(rms);
            switch (endpointer.Feed(rms))
            {
                case Endpointer.Verdict.Done:
                    Finish(true);
                    return;
                case Endpointer.Verdict.NoSpeech:
                    Finish(false);
                    return;
                case Endpointer.Verdict.Speaking when endpointer.Silence == 0 && early is not null:
                    DropEarly(); // User went on: what was transcribed early is not the whole turn
                    break;
                case Endpointer.Verdict.Speaking when endpointer.Silence >= EarlyAfter && early is null:
                    StartEarly();
                    break;
            }
        }
    }

    private void StartEarly()
    {
        if (earlyRunning is { IsCompleted: false }) return;
        float[] audio;
        int audioRate;
        lock (gate)
        {
            audio = turn.ToArray();
            audioRate = rate;
        }
        var cts = new CancellationTokenSource();
        earlyCts = cts;
        early = Task.Run(() => whisper.TranscribeAsync(WhisperTranscriber.Resample(audio, audioRate), cts.Token));
        earlyRunning = early;
    }

    private void DropEarly()
    {
        earlyCts?.Cancel();
        earlyCts = null;
        early = null;
    }

    private void Finish(bool transcribe)
    {
        float[] audio;
        int audioRate;
        var ready = early;
        var readyCts = earlyCts;
        early = null;
        earlyCts = null;
        lock (gate)
        {
            if (Current != State.Listening) { readyCts?.Cancel(); return; }
            audio = turn.ToArray();
            audioRate = rate;
            turn.Clear();
            if (!transcribe || audio.Length < audioRate / 4)
            {
                readyCts?.Cancel();
                SetState(State.Idle);
                Notice?.Invoke("didn't catch anything");
                if (!clapEnabled) StopMicSoon();
                return;
            }
            SetState(State.Transcribing);
        }
        if (!clapEnabled) StopMicSoon();
        var cts = readyCts ?? new CancellationTokenSource();
        transcribing = cts;
        _ = Task.Run(async () =>
        {
            try
            {
                var sw = Stopwatch.StartNew();
                // The early transcription already holds every word: nothing but quiet has come in since it started.
                var text = ready is not null
                    ? await ready.ConfigureAwait(false)
                    : await whisper.TranscribeAsync(WhisperTranscriber.Resample(audio, audioRate), cts.Token).ConfigureAwait(false);
                AppLog.Write($"voice: {audio.Length / (double)audioRate:0.0} s turn → {text.Length} chars, {sw.ElapsedMilliseconds} ms after it ended ({(ready is not null ? "early" : "late")} transcription, {whisper.Runtime})");
                if (cts.IsCancellationRequested) return;
                lock (gate) SetState(State.Idle);
                if (text.Length > 0) Heard?.Invoke(text);
                else Notice?.Invoke("didn't catch anything");
            }
            catch (OperationCanceledException) { }
            catch (Exception e)
            {
                lock (gate) SetState(State.Idle);
                AppLog.Write($"voice: transcription failed: {e}");
                Notice?.Invoke($"transcription failed: {e.Message}");
            }
        });
    }

    /// <summary>Off the capture thread: stopping a WASAPI capture from its own callback would wait on itself.</summary>
    private void StopMicSoon() => Task.Run(() => { if (!clapEnabled && Current != State.Listening) mic.Stop(); });

    private void SetState(State s)
    {
        if (Current == s) return;
        Current = s;
        // A turn just ended: 3 s before a clap counts again (what follows a turn is rarely a fresh double clap).
        if (s == State.Idle) clapsFrom = Math.Max(clapsFrom, lastAt + 3);
        StateChanged?.Invoke(s);
    }

    public async ValueTask DisposeAsync()
    {
        transcribing?.Cancel();
        mic.Dispose();
        await whisper.DisposeAsync().ConfigureAwait(false);
    }
}

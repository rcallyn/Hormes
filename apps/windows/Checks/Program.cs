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
//   dotnet run --project apps/windows/Checks -- --hands           Notepad through build/hands/hormes-hands.exe (types on your desktop)
// Exit code 1 when any check fails.

var renderAt = Array.IndexOf(args, "--render");
if (renderAt >= 0 && renderAt + 1 < args.Length)
{
    Hormes.Windows.Checks.Render.Run(args[renderAt + 1]);
    return 0;
}

// --hands: drive the native helper (build/hands) through Notepad; needs the desktop, so it is not part of the default run.
if (Array.IndexOf(args, "--hands") >= 0) return Hormes.Windows.Checks.HandsCheck.Run(FindRepo());
// --hands-click: click and focus through the helper, on Calculator. --console-pass [dir]: click through the live Console and capture each page.
if (Array.IndexOf(args, "--hands-click") >= 0) return Hormes.Windows.Checks.ClickCheck.RunClick(FindRepo());
if (Array.IndexOf(args, "--console-pass") is var cp and >= 0) return Hormes.Windows.Checks.ClickCheck.RunConsolePass(FindRepo(), cp + 1 < args.Length ? args[cp + 1] : Path.Combine(FindRepo(), "build", "console-pass"));

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
            // The Mac window, plus the quiet after the pair that confirms it here.
            Check(hits.Count == 1 && hits[0] >= clapsAt[1] - 0.15 && hits[0] <= clapsAt[1] + 0.10 + ClapDetector.ConfirmSeconds + 0.05,
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

// Sounds that are not a double clap, and synthetic claps that are: 48 kHz, a quiet room under everything.
{
    const int sr = 48000;
    var rng = new Random(11);
    float[] Room(double seconds) => Enumerable.Range(0, (int)(seconds * sr)).Select(_ => (float)((rng.NextDouble() - 0.5) * 0.004)).ToArray();
    void Clap(float[] buf, double at, double amp)
    {
        // A clap: a broadband burst that decays in a few milliseconds.
        var start = (int)(at * sr);
        for (var i = 0; i < sr * 40 / 1000 && start + i < buf.Length; i++)
            buf[start + i] += (float)((rng.NextDouble() * 2 - 1) * amp * Math.Exp(-i / (sr * 0.006)));
    }
    int Count(float[] buf)
    {
        var x = new ClapFrameExtractor();
        var frames = new List<ClapDetector.Frame>();
        for (var o = 0; o < buf.Length; o += 960) frames.AddRange(x.Frames(buf.AsSpan(o, Math.Min(960, buf.Length - o)), sr, o / (double)sr));
        return Detections(frames).Count;
    }

    foreach (var amp in new[] { 0.9, 0.4, 0.2 })
    {
        var two = Room(3); Clap(two, 1.0, amp); Clap(two, 1.35, amp * 0.8);
        Check(Count(two) == 1, $"a clean double clap counts (amplitude {amp})");
    }
    var three = Room(3); Clap(three, 1.0, 0.6); Clap(three, 1.35, 0.6); Clap(three, 1.55, 0.6);
    Check(Count(three) == 0, "three claps in a row are not a double clap");
    var uneven = Room(3); Clap(uneven, 1.0, 0.9); Clap(uneven, 1.35, 0.12);
    Check(Count(uneven) == 0, "a loud bang and a faint tick are not a pair");
    var slow = Room(3); Clap(slow, 1.0, 0.6); Clap(slow, 1.75, 0.6);
    Check(Count(slow) == 0, "two claps 0.75 s apart are two claps, not a double clap");
    var single = Room(3); Clap(single, 1.0, 0.8);
    Check(Count(single) == 0, "one clap is not two");

    // Typing: clicks every 60-300 ms for 30 s, with none of the quiet a deliberate pair has around it.
    var typing = Room(30);
    for (var t = 0.5; t < 29.5; t += 0.06 + rng.NextDouble() * 0.24) Clap(typing, t, 0.15 + rng.NextDouble() * 0.5);
    Check(Count(typing) == 0, "30 s of keyboard-like clicking does not wake it", $"{Count(typing)} detections");

    // Speech, at its own level and louder: plosives are sharp, but never out of silence and never confirmed by it.
    var speechDir = Path.Combine(Path.GetTempPath(), "hormes-checks");
    foreach (var wav in Directory.Exists(speechDir) ? Directory.GetFiles(speechDir, "*.wav") : Array.Empty<string>())
    {
        using var r = new AudioFileReader(wav);
        var buf = new float[(int)r.Length / 4];
        var n = r.Read(buf.AsSpan());
        var ch = r.WaveFormat.Channels;
        var monoSpeech = Enumerable.Range(0, n / ch).Select(i => buf[i * ch]).ToArray();
        foreach (var gain in new[] { 1f, 3f })
        {
            var x = new ClapFrameExtractor();
            var scaled = monoSpeech.Select(v => Math.Clamp(v * gain, -1f, 1f)).ToArray();
            var hits = Detections(x.Frames(scaled, r.WaveFormat.SampleRate, 0)).Count;
            Check(hits == 0, $"speech ({Path.GetFileName(wav)}, gain {gain}) does not wake it", $"{hits} detections");
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
    var verdicts = seq.Select(r => blip.Feed(r)).ToList();
    Check(!verdicts.Contains(Endpointer.Verdict.Done), "a cough alone is not a turn");

    // Voiced, or only loud: a 150 Hz voice-like tone with harmonics against white noise, at 48 kHz.
    var rnd = new Random(7);
    var tone = new float[1440];
    var hiss = new float[1440];
    for (var i = 0; i < tone.Length; i++)
    {
        var t = i / 48000.0;
        tone[i] = (float)(0.2 * Math.Sin(2 * Math.PI * 150 * t) + 0.1 * Math.Sin(2 * Math.PI * 300 * t) + 0.05 * Math.Sin(2 * Math.PI * 450 * t));
        hiss[i] = (float)((rnd.NextDouble() * 2 - 1) * 0.2);
    }
    var voiced = Endpointer.Voicing(tone, 48000);
    var unvoiced = Endpointer.Voicing(hiss, 48000);
    Check(voiced > 0.8 && unvoiced < Endpointer.VoicedAt, "a voice is voiced, hiss is not", $"voice {voiced:0.00}, hiss {unvoiced:0.00}");

    var noisy = new Endpointer { NoSpeechTimeout = TimeSpan.FromSeconds(3) };
    noisy.Reset(0.004);
    var noisyVerdict = Endpointer.Verdict.Waiting;
    for (var i = 0; i < 200 && noisyVerdict == Endpointer.Verdict.Waiting; i++) noisyVerdict = noisy.Feed(0.15, unvoiced);
    Check(noisyVerdict == Endpointer.Verdict.NoSpeech, "loud noise that is not a voice never opens a turn");

    // A TV across the room, on before the turn (the floor is seeded from it) and on after User stops: the turn ends
    // 2 s after User's last word, and the TV is not taken for more of the turn.
    var room = new Endpointer();
    room.Reset(0.02);
    var tvTurn = false;
    for (var i = 0; i < 33; i++) tvTurn |= room.Feed(0.02 + 0.006 * Math.Sin(i), 0.7) != Endpointer.Verdict.Waiting;
    var userTurn = false;
    for (var i = 0; i < 66; i++) userTurn |= room.Feed(0.2 + 0.05 * Math.Sin(i), 0.8) == Endpointer.Verdict.Speaking;
    var endedAfter = -1.0;
    for (var i = 0; i < 200; i++) if (room.Feed(0.035 + 0.01 * Math.Sin(i), 0.7) == Endpointer.Verdict.Done) { endedAfter = (i + 1) * 0.03; break; }
    var ended = Math.Abs(endedAfter - 2.0) < 0.15;
    Check(!tvTurn && userTurn && ended, "a voice in the background neither opens nor holds a turn; User's voice is heard", $"tv {tvTurn}, user {userTurn}, ended {endedAfter:0.00} s after the last word");
}

Check(WhisperTranscriber.Clean(" [BLANK_AUDIO] ") == "" && WhisperTranscriber.Clean(" Thank you. ") == "" && WhisperTranscriber.Clean(" Open Spotify. ") == "Open Spotify.",
    "Whisper's filler on silence is dropped, real words kept");
Check(WhisperTranscriber.Clean(" I'm going to go to the top of the top of the top of the top.") == "" && WhisperTranscriber.Clean(" I'm going to go.") == "",
    "Whisper's loops and stock lines on noise are dropped");
Check(WhisperTranscriber.Clean(" Claude Code, Wispr.") == "" && WhisperTranscriber.Clean(" Ask Claude.") == "Ask Claude.", "its own hint words read back on noise are dropped");
Check(WhisperTranscriber.Clean(" Move the meeting to the top of the list.") == "Move the meeting to the top of the list." && WhisperTranscriber.Clean(" Yes, yes.") == "Yes, yes.",
    "a phrase said once or twice is kept");

{
    var spoken = ElevenLabsSpeaker.Speakable("## Done\n- Opened **Spotify** and [your playlist](https://open.spotify.com/x).\n```sh\nrm -rf /tmp/x\n```\nRun `pnpm test` next.");
    Check(spoken == "Done Opened Spotify and your playlist. (code on screen) Run pnpm test next.", "answers are made speakable: no markdown, links or code read out", spoken);
    Check(SpokenReply.Pick("Done. The dentist is on Friday at 3pm.") == "Done. The dentist is on Friday at 3pm.", "a short answer is spoken");
    Check(SpokenReply.Pick("Here's your week:\n- Mon: Calc quiz\n- Wed: Essay due\n- Fri: Dentist") is null, "a list is for reading, not spoken");
    Check(SpokenReply.Pick("Run this:\n```sh\npnpm test\n```") is null, "code is not spoken");
    Check(SpokenReply.Pick("It's at https://example.com/page.") is null, "a link is not spoken");
    Check(SpokenReply.Pick(string.Join(" ", Enumerable.Repeat("This sentence explains one more detail.", 8))) is null, "a long explanation is not spoken");
    Check(SpokenReply.Pick("Yes. It's 72 degrees. Bring a jacket tonight. Rain after nine. Wind from the west.") is not null, "five sentences are spoken");
    Check(SpokenReply.Pick("Yes. It's 72 degrees. Bring a jacket tonight. Rain after nine. Wind from the west. Clear by morning.") is null, "six sentences is too many to speak");
}

// The Mac's sounds play here: every .caf parses to PCM of a sensible length.
foreach (var caf in Directory.GetFiles(Path.Combine(repo, "apps", "mac", "Resources", "Sounds"), "*.caf"))
{
    var (format, pcm) = Hormes.Windows.Audio.Earcons.ReadCaf(File.ReadAllBytes(caf));
    var seconds = pcm.Length / (double)format.AverageBytesPerSecond;
    Check(format.Encoding == NAudio.Wave.WaveFormatEncoding.Pcm && seconds is > 0.05 and < 10, $"sound {Path.GetFileName(caf)} reads as {format.SampleRate} Hz {format.BitsPerSample}-bit, {seconds:0.00} s");
}

// ------------------------------------------------------------------ whisper, end to end on a recording

{
    var f = new FollowUp();
    f.ListeningStarted(); f.Heard(); f.ListeningEnded();
    f.EngineBusy(true); f.ReplyLine(); f.Speaking(true);
    var early = f.Due;
    f.EngineBusy(false); f.Speaking(false);
    var due = f.StillDue();
    var once = !f.StillDue();
    f.ListeningStarted(); f.ListeningEnded();
    f.ReplyLine();
    Check(!early && due && once && !f.Due && !f.InConversation, "a spoken turn listens again once the answer is done, once, and stops after a silent turn");
    var t = new FollowUp(); t.Heard(); t.End(); t.ReplyLine();
    Check(!t.Due, "typing or Stop ends the spoken conversation");
}
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

Console.WriteLine($"info Windows output muted now: {Hormes.Windows.Audio.SystemAudio.IsMuted()}");
Console.WriteLine(failures == 0 ? "all checks passed" : $"{failures} check(s) failed");
return failures == 0 ? 0 : 1;

static string FindRepo()
{
    for (var d = new DirectoryInfo(AppContext.BaseDirectory); d is not null; d = d.Parent)
        if (File.Exists(Path.Combine(d.FullName, "pnpm-workspace.yaml"))) return d.FullName;
    throw new InvalidOperationException("run from inside the Hormes checkout");
}

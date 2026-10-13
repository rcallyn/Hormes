using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Hormes.Windows.Daemon;
using Whisper.net;
using Whisper.net.LibraryLoader;

namespace Hormes.Windows.Speech;

/// <summary>
/// On-device speech recognition: whisper.cpp (Whisper.net) running OpenAI's Whisper large-v3-turbo, quantised
/// (q5_0, ~574 MB), on the GPU through Vulkan where there is one and on the CPU otherwise. Audio never leaves the
/// machine. The model lives in <c>~/.hormes/models</c>; the first use downloads it once from whisper.cpp's
/// Hugging Face repository.
/// </summary>
public sealed class WhisperTranscriber : IAsyncDisposable
{
    public const string ModelFile = "ggml-large-v3-turbo-q5_0.bin";
    public const string ModelUrl = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/" + ModelFile;
    /// <summary>Whisper's input rate.</summary>
    public const int SampleRate = 16000;

    private readonly SemaphoreSlim gate = new(1, 1);
    private WhisperFactory? factory;
    /// <summary>One processor per encoder window (audio_ctx bucket): building one per turn would cost more than it saves.</summary>
    private readonly Dictionary<int, WhisperProcessor> processors = new();

    /// <summary>
    /// Whisper encodes a fixed 30 s window (1500 positions) however short the clip; a sentence pays for all of it.
    /// whisper.cpp's audio_ctx shrinks the window to the clip, in buckets of 1/6 (5 s), with a little room to spare.
    /// </summary>
    private static int ContextFor(int samples)
    {
        const int full = 1500, bucket = 125;
        var needed = (int)Math.Ceiling(samples / (double)SampleRate / 30.0 * full) + 64;
        return Math.Min(full, (needed + bucket - 1) / bucket * bucket);
    }

    private WhisperProcessor ProcessorFor(int samples)
    {
        var ctx = ContextFor(samples);
        if (processors.TryGetValue(ctx, out var p)) return p;
        var builder = factory!.CreateBuilder()
            .WithLanguage("auto")
            .WithThreads(Math.Clamp(Environment.ProcessorCount / 2, 2, 8))
            // Names it should spell right; a prompt only biases, it is never output.
            .WithPrompt("Hormes, Claude, Claude Code, Wispr.")
            .WithNoSpeechThreshold(0.6f);
        if (ctx < 1500) builder = builder.WithAudioContextSize(ctx);
        p = builder.Build();
        processors[ctx] = p;
        return p;
    }

    public static string ModelPath => Path.Combine(Ipc.StateDir, "models", ModelFile);

    /// <summary>"Vulkan" / "Cpu" once loaded: which whisper.cpp runtime took the model.</summary>
    public string? Runtime { get; private set; }
    public bool Loaded => factory is not null;

    /// <summary>Download progress, 0..1, while the model is being fetched.</summary>
    public event Action<double>? DownloadProgress;

    /// <summary>The model on disk and loaded: downloads it the first time (several hundred MB), then loads it (a few seconds).</summary>
    public async Task EnsureLoadedAsync(CancellationToken ct = default)
    {
        if (factory is not null) return;
        await gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            if (factory is not null) return;
            if (!File.Exists(ModelPath)) await DownloadAsync(ct).ConfigureAwait(false);
            var sw = Stopwatch.StartNew();
            factory = WhisperFactory.FromPath(ModelPath);
            // The commonest turn (a sentence or two) ready before the first one arrives.
            ProcessorFor(SampleRate * 8);
            Runtime = RuntimeOptions.LoadedLibrary?.ToString() ?? "unknown";
            AppLog.Write($"whisper: loaded {ModelFile} on {Runtime} in {sw.ElapsedMilliseconds} ms");
        }
        finally
        {
            gate.Release();
        }
    }

    /// <summary>16 kHz mono samples → text, or "" for nothing worth sending (silence, Whisper's stock filler).</summary>
    public async Task<string> TranscribeAsync(float[] samples16k, CancellationToken ct = default)
    {
        await EnsureLoadedAsync(ct).ConfigureAwait(false);
        samples16k = TrimSilence(samples16k);
        if (samples16k.Length < SampleRate / 5) return "";
        await gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            var text = new StringBuilder();
            await foreach (var segment in ProcessorFor(samples16k.Length).ProcessAsync(samples16k, ct).ConfigureAwait(false))
                text.Append(segment.Text);
            return Clean(text.ToString());
        }
        finally
        {
            gate.Release();
        }
    }

    /// <summary>
    /// The clip without the quiet before and after the speech (0.25 s kept each side). With a window cut to the
    /// clip, trailing silence is where Whisper starts repeating itself; and silence costs encoder time for nothing.
    /// </summary>
    public static float[] TrimSilence(float[] samples)
    {
        var frame = SampleRate * 30 / 1000;
        var count = samples.Length / frame;
        if (count == 0) return samples;
        var rms = new double[count];
        for (var i = 0; i < count; i++)
        {
            double sum = 0;
            for (var j = i * frame; j < (i + 1) * frame; j++) sum += samples[j] * samples[j];
            rms[i] = Math.Sqrt(sum / frame);
        }
        var threshold = Math.Max(0.008, rms.Max() * 0.06);
        var first = Array.FindIndex(rms, r => r > threshold);
        var last = Array.FindLastIndex(rms, r => r > threshold);
        if (first < 0) return Array.Empty<float>();
        var margin = SampleRate / 4;
        var start = Math.Max(0, first * frame - margin);
        var end = Math.Min(samples.Length, (last + 1) * frame + margin);
        return samples[start..end];
    }

    /// <summary>
    /// Whisper on near-silence makes things up: bracketed tags ("[BLANK_AUDIO]", "(music)") and a few stock lines.
    /// Those alone are not something User said.
    /// </summary>
    public static string Clean(string raw)
    {
        var text = Regex.Replace(raw, @"\[[^\]]*\]|\([^)]*\)|\*[^*]*\*", " ");
        text = Regex.Replace(text, @"\s+", " ").Trim();
        // A sentence said once and written twice in a row (a cut window's known loop): once.
        text = Regex.Replace(text, @"(?<s>[^.!?]{8,}[.!?])(\s+\k<s>)+", "${s}", RegexOptions.IgnoreCase);
        var bare = text.Trim('.', '!', '?', ',', ' ').ToLowerInvariant();
        string[] filler = { "", "you", "thank you", "thanks for watching", "thank you for watching", "bye", ".", "so" };
        return filler.Contains(bare) ? "" : text;
    }

    /// <summary>The mic's rate to 16 kHz: a Hann-windowed sinc, plenty for speech.</summary>
    public static float[] Resample(float[] input, int fromRate)
    {
        if (fromRate == SampleRate) return input;
        var ratio = (double)SampleRate / fromRate;
        var output = new float[(int)(input.Length * ratio)];
        // Low-pass at the new Nyquist (or the old one, upsampling), Hann-windowed sinc, 16 taps a side.
        var cutoff = Math.Min(1.0, ratio);
        const int half = 16;
        for (var i = 0; i < output.Length; i++)
        {
            var center = i / ratio;
            var start = (int)Math.Floor(center) - half + 1;
            double sum = 0, weights = 0;
            for (var j = start; j < start + 2 * half; j++)
            {
                if (j < 0 || j >= input.Length) continue;
                var x = (center - j) * cutoff;
                var sinc = x == 0 ? 1 : Math.Sin(Math.PI * x) / (Math.PI * x);
                var window = 0.5 + 0.5 * Math.Cos(Math.PI * (center - j) / half);
                var w = sinc * window;
                sum += input[j] * w;
                weights += w;
            }
            output[i] = weights > 0 ? (float)(sum / weights) : 0;
        }
        return output;
    }

    private async Task DownloadAsync(CancellationToken ct)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(ModelPath)!);
        var part = ModelPath + ".part";
        using var http = new HttpClient { Timeout = TimeSpan.FromHours(1) };
        using var response = await http.GetAsync(ModelUrl, HttpCompletionOption.ResponseHeadersRead, ct).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();
        var total = response.Content.Headers.ContentLength ?? 0;
        await using (var source = await response.Content.ReadAsStreamAsync(ct).ConfigureAwait(false))
        await using (var file = File.Create(part))
        {
            var buffer = new byte[1 << 20];
            long done = 0;
            int n;
            while ((n = await source.ReadAsync(buffer, ct).ConfigureAwait(false)) > 0)
            {
                await file.WriteAsync(buffer.AsMemory(0, n), ct).ConfigureAwait(false);
                done += n;
                if (total > 0) DownloadProgress?.Invoke((double)done / total);
            }
        }
        File.Move(part, ModelPath, overwrite: true);
    }

    public async ValueTask DisposeAsync()
    {
        foreach (var p in processors.Values) await p.DisposeAsync().ConfigureAwait(false);
        factory?.Dispose();
    }
}

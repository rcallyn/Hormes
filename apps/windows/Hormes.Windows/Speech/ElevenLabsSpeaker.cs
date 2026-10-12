using System;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;
using Hormes.Windows.Daemon;
using NAudio.Wave;

namespace Hormes.Windows.Speech;

/// <summary>
/// Hormes's voice on Windows: ElevenLabs text-to-speech, the "Alistair" voice, streamed (raw 24 kHz PCM) and played as
/// it arrives, so the first words sound while the rest is still being generated. Lines are spoken one after another;
/// <see cref="Stop"/> cuts the current one and drops the queue (a new turn, the Stop button).
///
/// The key is <c>ELEVENLABS_API_KEY</c>, from the environment or <c>~/.hormes/env</c>; the voice is
/// <c>ELEVENLABS_VOICE_ID</c> when set, else the voice named Alistair in the account's voices, else the Voice Library's.
/// Only the text of Hormes's answers goes to ElevenLabs; never audio or anything User said.
/// </summary>
public sealed class ElevenLabsSpeaker : IAsyncDisposable
{
    public const string VoiceName = "Alistair";
    private const string Api = "https://api.elevenlabs.io";
    /// <summary>The low-latency model: the first audio in a few hundred ms.</summary>
    private const string Model = "eleven_flash_v2_5";
    private const int Rate = 24000;
    /// <summary>A spoken answer is the gist: past this the rest stays on screen (and off the bill).</summary>
    private const int MaxChars = 1200;

    private readonly HttpClient http = new() { Timeout = TimeSpan.FromMinutes(2) };
    private readonly Channel<string> lines = Channel.CreateUnbounded<string>();
    private readonly CancellationTokenSource lifetime = new();
    private CancellationTokenSource? current;
    private string? voiceId;
    private int generation;

    public ElevenLabsSpeaker()
    {
        ApiKey = ReadKey();
        voiceId = Environment.GetEnvironmentVariable("ELEVENLABS_VOICE_ID");
        _ = Task.Run(RunAsync);
    }

    public string? ApiKey { get; private set; }
    public bool Available => !string.IsNullOrEmpty(ApiKey);
    public bool Enabled { get; set; } = true;

    /// <summary>True while audio plays (or is about to); false once the queue is empty.</summary>
    public event Action<bool>? Speaking;
    /// <summary>The RMS of what is playing, ~every 20 ms, for the voice bars.</summary>
    public event Action<double>? Level;
    public event Action<string>? Problem;

    /// <summary>Queue a line of Hormes's to say. Markdown and code are made speakable or left out.</summary>
    public void Say(string text)
    {
        if (!Enabled) return;
        // Windows muted: nothing would be heard, so nothing goes to ElevenLabs.
        if (Audio.SystemAudio.IsMuted()) return;
        if (!Available)
        {
            ApiKey = ReadKey(); // added since start?
            if (!Available) return;
        }
        var speakable = Speakable(text);
        if (speakable.Length > 0) lines.Writer.TryWrite(speakable);
    }

    /// <summary>Cut what is playing and drop everything queued.</summary>
    public void Stop()
    {
        Interlocked.Increment(ref generation);
        while (lines.Reader.TryRead(out _)) { }
        current?.Cancel();
    }

    private async Task RunAsync()
    {
        var reader = lines.Reader;
        try
        {
            while (await reader.WaitToReadAsync(lifetime.Token).ConfigureAwait(false))
            {
                Speaking?.Invoke(true);
                while (reader.TryRead(out var line))
                {
                    var mine = Volatile.Read(ref generation);
                    using var cts = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
                    current = cts;
                    try
                    {
                        await SpeakAsync(line, cts.Token).ConfigureAwait(false);
                    }
                    catch (OperationCanceledException) when (!lifetime.IsCancellationRequested) { }
                    catch (Exception e) when (e is HttpRequestException or IOException or InvalidOperationException)
                    {
                        AppLog.Write($"speech: {e.Message}");
                        Problem?.Invoke(e.Message);
                    }
                    current = null;
                    if (mine != Volatile.Read(ref generation)) break;
                }
                Level?.Invoke(0);
                Speaking?.Invoke(false);
            }
        }
        catch (OperationCanceledException) { }
    }

    private async Task SpeakAsync(string text, CancellationToken ct)
    {
        var voice = await ResolveVoiceAsync(ct).ConfigureAwait(false);
        using var request = new HttpRequestMessage(HttpMethod.Post, $"{Api}/v1/text-to-speech/{voice}/stream?output_format=pcm_{Rate}");
        request.Headers.Add("xi-api-key", ApiKey);
        request.Content = new StringContent(JsonSerializer.Serialize(new { text, model_id = Model }), Encoding.UTF8, "application/json");
        var started = DateTime.UtcNow;
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            throw new HttpRequestException(Explain((int)response.StatusCode, body));
        }

        var buffer = new BufferedWaveProvider(new WaveFormat(Rate, 16, 1), TimeSpan.FromMinutes(5)) { ReadFully = true, DiscardOnBufferOverflow = false };
        var tap = new LevelTap(buffer, rms => Level?.Invoke(rms));
        using var output = new WaveOut { BufferMilliseconds = 60, NumberOfBuffers = 2 };
        output.Init(tap);
        await using var stream = await response.Content.ReadAsStreamAsync(ct).ConfigureAwait(false);
        var chunk = new byte[4800];
        var playing = false;
        long total = 0;
        int n;
        while ((n = await stream.ReadAsync(chunk, ct).ConfigureAwait(false)) > 0)
        {
            buffer.AddSamples(chunk, 0, n);
            total += n;
            // A little in hand before starting, so a slow chunk does not stutter the first word.
            if (!playing && buffer.BufferedDuration >= TimeSpan.FromMilliseconds(150))
            {
                output.Play();
                playing = true;
                AppLog.Write($"speech: first audio {(DateTime.UtcNow - started).TotalMilliseconds:0} ms after the request ({text.Length} chars)");
            }
        }
        if (!playing && total > 0) output.Play();
        while (buffer.BufferedBytes > 0 && !ct.IsCancellationRequested) await Task.Delay(30, ct).ConfigureAwait(false);
        await Task.Delay(120, ct).ConfigureAwait(false); // the device's own latency
        output.Stop();
    }

    /// <summary>ELEVENLABS_VOICE_ID, else Alistair among the account's voices, else in the shared Voice Library.</summary>
    private async Task<string> ResolveVoiceAsync(CancellationToken ct)
    {
        if (!string.IsNullOrEmpty(voiceId)) return voiceId;
        var mine = await GetJsonAsync($"{Api}/v1/voices", ct).ConfigureAwait(false);
        voiceId = FindVoice(mine, "voices");
        if (voiceId is null)
        {
            var shared = await GetJsonAsync($"{Api}/v1/shared-voices?search={VoiceName}&page_size=20", ct).ConfigureAwait(false);
            voiceId = FindVoice(shared, "voices");
            if (voiceId is not null) AppLog.Write($"speech: {VoiceName} found in the Voice Library ({voiceId}); if ElevenLabs refuses it, add it to My Voices");
        }
        if (voiceId is null) throw new InvalidOperationException($"no ElevenLabs voice named {VoiceName}: add it to My Voices, or set ELEVENLABS_VOICE_ID");
        AppLog.Write($"speech: voice {VoiceName} = {voiceId}");
        return voiceId;
    }

    private async Task<JsonDocument> GetJsonAsync(string url, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Add("xi-api-key", ApiKey);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        using var response = await http.SendAsync(request, ct).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode) throw new HttpRequestException(Explain((int)response.StatusCode, body));
        return JsonDocument.Parse(body);
    }

    private static string? FindVoice(JsonDocument doc, string array)
    {
        using (doc)
        {
            if (!doc.RootElement.TryGetProperty(array, out var voices) || voices.ValueKind != JsonValueKind.Array) return null;
            var named = voices.EnumerateArray()
                .Where(v => v.TryGetProperty("name", out var name) && (name.GetString() ?? "").Contains(VoiceName, StringComparison.OrdinalIgnoreCase))
                .OrderBy(v => string.Equals(v.GetProperty("name").GetString(), VoiceName, StringComparison.OrdinalIgnoreCase) ? 0 : 1)
                .FirstOrDefault();
            return named.ValueKind == JsonValueKind.Object && named.TryGetProperty("voice_id", out var id) ? id.GetString() : null;
        }
    }

    private static string Explain(int status, string body)
    {
        var detail = body.Length > 300 ? body[..300] : body;
        return status switch
        {
            401 => "ElevenLabs refused the key (401): check ELEVENLABS_API_KEY in ~/.hormes/env",
            402 or 429 => $"ElevenLabs quota or rate limit ({status}): {detail}",
            _ => $"ElevenLabs {status}: {detail}",
        };
    }

    /// <summary>What a voice can say of a markdown answer: code left out, links and emphasis plain, capped at a sentence.</summary>
    public static string Speakable(string text)
    {
        var s = Regex.Replace(text, "```[\\s\\S]*?```", " (code on screen) ");
        s = Regex.Replace(s, "`([^`]*)`", "$1");
        s = Regex.Replace(s, @"!?\[([^\]]*)\]\([^)]*\)", "$1");
        s = Regex.Replace(s, @"https?://\S+", "a link");
        s = Regex.Replace(s, @"^\s{0,3}(#{1,6}|[-*+]|\d+\.)\s+", "", RegexOptions.Multiline);
        s = Regex.Replace(s, @"(\*\*|__|\*|_|~~)(\S[^*_~]*?)\1", "$2");
        s = Regex.Replace(s, @"\|", " ");
        s = Regex.Replace(s, @"\s+", " ").Trim();
        if (s.Length <= MaxChars) return s;
        var cut = s.LastIndexOfAny(new[] { '.', '!', '?' }, MaxChars);
        return (cut > MaxChars / 2 ? s[..(cut + 1)] : s[..MaxChars]) + " The rest is on screen.";
    }

    /// <summary><c>ELEVENLABS_API_KEY</c> from the environment, else from <c>~/.hormes/env</c> (KEY=value lines).</summary>
    private static string? ReadKey()
    {
        var env = Environment.GetEnvironmentVariable("ELEVENLABS_API_KEY");
        if (!string.IsNullOrWhiteSpace(env)) return env.Trim();
        var file = Path.Combine(Ipc.StateDir, "env");
        if (!File.Exists(file)) return null;
        try
        {
            foreach (var raw in File.ReadLines(file))
            {
                var line = raw.Trim();
                if (line.StartsWith("export ")) line = line[7..].TrimStart();
                if (!line.StartsWith("ELEVENLABS_API_KEY=")) continue;
                var value = line["ELEVENLABS_API_KEY=".Length..].Trim().Trim('"', '\'');
                return value.Length > 0 ? value : null;
            }
        }
        catch (IOException) { }
        return null;
    }

    public async ValueTask DisposeAsync()
    {
        Stop();
        lifetime.Cancel();
        lines.Writer.TryComplete();
        await Task.Yield();
        http.Dispose();
    }

    /// <summary>Passes 16-bit PCM through, reporting the RMS of each read (what is about to be heard).</summary>
    private sealed class LevelTap(IWaveProvider source, Action<double> level) : IWaveProvider
    {
        public WaveFormat WaveFormat => source.WaveFormat;

        public int Read(Span<byte> buffer)
        {
            var n = source.Read(buffer);
            var samples = n / 2;
            if (samples > 0)
            {
                double sum = 0;
                for (var i = 0; i < samples; i++)
                {
                    var v = BitConverter.ToInt16(buffer.Slice(i * 2, 2)) / 32768.0;
                    sum += v * v;
                }
                level(Math.Sqrt(sum / samples));
            }
            return n;
        }
    }
}

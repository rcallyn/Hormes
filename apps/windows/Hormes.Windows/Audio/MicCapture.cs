using System;
using System.Diagnostics;
using System.Threading.Tasks;
using NAudio.CoreAudioApi;
using NAudio.Wave;

// WasapiCapture: NAudio 3 suggests WasapiRecorder; the classic event API is enough here and widely documented.
#pragma warning disable CS0618

namespace Hormes.Windows.Audio;

/// <summary>
/// The default microphone, shared mode (WASAPI), as mono float samples with a sample-clock timestamp. Restarts on its
/// own when the device goes away or changes (a headset plugged in), after a short pause. Samples are raised on the
/// capture thread; nothing is written to disk.
/// </summary>
public sealed class MicCapture : IDisposable
{
    private readonly object gate = new();
    private WasapiCapture? capture;
    private long samplesSeen;
    private bool wanted;
    private bool disposed;

    /// <summary>Mono samples (-1..1), their rate, and the time (s, sample clock since this capture started) of the first.</summary>
    public event Action<float[], int, double>? Samples;
    public event Action<string>? Problem;

    public bool Running { get; private set; }

    public void Start()
    {
        lock (gate)
        {
            wanted = true;
            if (Running || disposed) return;
            try
            {
                var c = new WasapiCapture(WasapiCapture.GetDefaultCaptureDevice(), true, 20);
                c.DataAvailable += OnData;
                c.RecordingStopped += OnStopped;
                samplesSeen = 0;
                c.StartRecording();
                capture = c;
                Running = true;
            }
            catch (Exception e)
            {
                Problem?.Invoke($"microphone unavailable: {e.Message}");
                RetrySoon();
            }
        }
    }

    public void Stop()
    {
        lock (gate)
        {
            wanted = false;
            var c = capture;
            capture = null;
            Running = false;
            if (c is null) return;
            c.DataAvailable -= OnData;
            c.RecordingStopped -= OnStopped;
            try { c.StopRecording(); } catch (Exception e) { AppLog.Write($"mic stop: {e.Message}"); }
            c.Dispose();
        }
    }

    private void OnData(object? sender, WaveInEventArgs e)
    {
        if (sender is not WasapiCapture c || e.BytesRecorded == 0) return;
        var format = c.WaveFormat;
        var mono = ToMono(e.Buffer, e.BytesRecorded, format);
        if (mono.Length == 0) return;
        var at = (double)samplesSeen / format.SampleRate;
        samplesSeen += mono.Length;
        Samples?.Invoke(mono, format.SampleRate, at);
    }

    private void OnStopped(object? sender, StoppedEventArgs e)
    {
        lock (gate)
        {
            if (!ReferenceEquals(sender, capture)) return;
            capture?.Dispose();
            capture = null;
            Running = false;
        }
        if (e.Exception is not null) Problem?.Invoke($"microphone stopped: {e.Exception.Message}");
        RetrySoon();
    }

    private void RetrySoon()
    {
        if (!wanted || disposed) return;
        _ = Task.Delay(2000).ContinueWith(_ => { if (wanted && !Running) Start(); }, TaskScheduler.Default);
    }

    /// <summary>KSDATAFORMAT_SUBTYPE_IEEE_FLOAT: what a shared-mode WASAPI mix format usually is.</summary>
    private static readonly Guid IeeeFloatSubFormat = new("00000003-0000-0010-8000-00aa00389b71");

    /// <summary>Whatever the device delivers (float or 16/24/32-bit PCM, any channel count) as mono float.</summary>
    private static float[] ToMono(byte[] buffer, int bytes, WaveFormat format)
    {
        var channels = Math.Max(1, format.Channels);
        var bytesPerSample = format.BitsPerSample / 8;
        var frames = bytes / (bytesPerSample * channels);
        var mono = new float[frames];
        var isFloat = format.Encoding == WaveFormatEncoding.IeeeFloat
            || (format is WaveFormatExtensible ext && ext.SubFormat == IeeeFloatSubFormat);
        for (var i = 0; i < frames; i++)
        {
            double sum = 0;
            for (var ch = 0; ch < channels; ch++)
            {
                var o = (i * channels + ch) * bytesPerSample;
                sum += isFloat && bytesPerSample == 4 ? BitConverter.ToSingle(buffer, o)
                    : bytesPerSample switch
                    {
                        2 => BitConverter.ToInt16(buffer, o) / 32768.0,
                        3 => ((buffer[o] | (buffer[o + 1] << 8) | (buffer[o + 2] << 16)) << 8 >> 8) / 8388608.0,
                        4 => BitConverter.ToInt32(buffer, o) / 2147483648.0,
                        _ => 0,
                    };
            }
            mono[i] = (float)(sum / channels);
        }
        return mono;
    }

    public void Dispose()
    {
        disposed = true;
        Stop();
    }
}

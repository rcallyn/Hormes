using System;

namespace Hormes.Windows.Audio;

/// <summary>
/// When User has finished speaking. Energy against an adaptive noise floor, in 30 ms frames: User's speech is a frame
/// well above the floor and voiced (a pitch, <see cref="Voicing"/>), so a fan, typing, a door or a clap never counts.
/// The floor learns from every frame that is not User's speech, background voices included: a TV or a conversation
/// across the room raises it, and only a voice close to the microphone clears it. The turn ends after <see cref="EndSilence"/> (2 s) of quiet following at least <see cref="MinSpeech"/>
/// of speech, so a pause to think inside a sentence does not cut it. Nothing heard within
/// <see cref="NoSpeechTimeout"/> ends it empty; <see cref="MaxTurn"/> caps a turn that never goes quiet.
/// </summary>
public sealed class Endpointer
{
    public enum Verdict { Waiting, Speaking, Done, NoSpeech }

    public TimeSpan EndSilence { get; init; } = TimeSpan.FromSeconds(2.0);
    public TimeSpan MinSpeech { get; init; } = TimeSpan.FromSeconds(0.25);
    public TimeSpan NoSpeechTimeout { get; init; } = TimeSpan.FromSeconds(7);
    public TimeSpan MaxTurn { get; init; } = TimeSpan.FromSeconds(90);

    private const double FrameSeconds = 0.03;
    private double floor = -1;
    private double elapsed;
    private double speech;
    private double silence;
    private bool started;
    private int hot;
    /// <summary>How loud User's own speech runs in this turn (RMS), learned once it starts; 0 before.</summary>
    private double voice;

    /// <summary>
    /// Once User is speaking, a frame this far under their own level is someone else (a TV, a voice across the room)
    /// and counts as quiet, so the turn ends when User stops even while the room goes on. About -14 dB.
    /// </summary>
    public const double OwnVoiceShare = 0.2;

    /// <summary>Speech has started in this turn.</summary>
    public bool Started => started;
    /// <summary>Seconds of quiet since the last speech (0 while speaking or before any).</summary>
    public double Silence => started ? silence : 0;

    /// <summary>The floor as it stands (RMS), seeded from what was heard just before the turn began.</summary>
    public double Floor => floor;

    /// <summary>The voicing a frame needs to count as speech: a held pitch, not noise.</summary>
    public const double VoicedAt = 0.45;

    /// <summary>
    /// How periodic a frame is, 0..1: the peak of its normalised autocorrelation over the lags of a speaking voice's
    /// pitch (70 to 400 Hz), on a copy decimated to about 16 kHz. Vowels score 0.6 to 0.95; fans, hiss, keys and
    /// claps stay well under <see cref="VoicedAt"/>.
    /// </summary>
    public static double Voicing(ReadOnlySpan<float> frame, int sampleRate)
    {
        var step = Math.Max(1, sampleRate / 16000);
        var rate = sampleRate / (double)step;
        var n = frame.Length / step;
        if (n < 64) return 0;
        Span<double> x = n <= 2048 ? stackalloc double[n] : new double[n];
        double mean = 0;
        for (var i = 0; i < n; i++)
        {
            double acc = 0;
            for (var j = 0; j < step; j++) acc += frame[i * step + j];
            x[i] = acc / step;
            mean += x[i];
        }
        mean /= n;
        for (var i = 0; i < n; i++) x[i] -= mean;
        var minLag = (int)(rate / 400);
        var maxLag = Math.Min(n / 2, (int)(rate / 70));
        double best = 0;
        for (var lag = minLag; lag <= maxLag; lag++)
        {
            double xy = 0, xx = 0, yy = 0;
            for (var i = 0; i + lag < n; i++)
            {
                xy += x[i] * x[i + lag];
                xx += x[i] * x[i];
                yy += x[i + lag] * x[i + lag];
            }
            if (xx <= 0 || yy <= 0) continue;
            var r = xy / Math.Sqrt(xx * yy);
            if (r > best) best = r;
        }
        return best;
    }

    public void Reset(double seedFloor = -1)
    {
        floor = seedFloor;
        elapsed = speech = silence = 0;
        started = false;
        hot = 0;
        voice = 0;
    }

    /// <summary>One 30 ms frame's RMS (mono, -1..1). Frames of another length: call once per 30 ms of audio.</summary>
    /// <param name="voicing">How periodic the frame is, 0..1 (<see cref="Voicing"/>); 1 when the caller has only levels.</param>
    public Verdict Feed(double rms, double voicing = 1)
    {
        elapsed += FrameSeconds;
        if (floor < 0) floor = Math.Max(rms, 0.002);
        // Speech: clearly over the floor, and over an absolute minimum so a silent room's tiny floor does not make
        // every breath speech.
        var threshold = Math.Max(Math.Max(floor * 3.2, 0.012), voice * OwnVoiceShare);
        var loud = rms > threshold && voicing >= VoicedAt;
        if (loud)
        {
            hot++;
            // Two hot frames in a row before it counts: a click or a tap is not the start of a sentence.
            if (hot >= 2 || started)
            {
                started = true;
                speech += FrameSeconds;
                voice = voice <= 0 ? rms : voice * 0.95 + rms * 0.05;
                silence = 0;
            }
        }
        else
        {
            hot = 0;
            if (started) silence += FrameSeconds;
            // The floor follows the room, quickly down and slowly up, and never learns from User's speech. Loud sound
            // that is not User (noise, or a voice under the threshold) pulls it up faster before a turn has started, so
            // a room that is already busy does not open a turn on its own.
            var up = started ? 0.005 : rms > threshold ? 0.02 : 0.005;
            floor = rms < floor ? floor * 0.9 + rms * 0.1 : floor * (1 - up) + rms * up;
            floor = Math.Clamp(floor, 0.0008, 0.05);
        }

        if (elapsed >= MaxTurn.TotalSeconds) return started ? Verdict.Done : Verdict.NoSpeech;
        if (!started) return elapsed >= NoSpeechTimeout.TotalSeconds ? Verdict.NoSpeech : Verdict.Waiting;
        if (silence >= EndSilence.TotalSeconds)
        {
            if (speech >= MinSpeech.TotalSeconds) return Verdict.Done;
            // Only a blip (a cough, a chair): not a turn. Keep waiting for real speech.
            started = false;
            speech = silence = 0;
            voice = 0;
            return elapsed >= NoSpeechTimeout.TotalSeconds ? Verdict.NoSpeech : Verdict.Waiting;
        }
        return Verdict.Speaking;
    }
}

using System;

namespace Hormes.Windows.Audio;

/// <summary>
/// When User has finished speaking. Energy against an adaptive noise floor, in 30 ms frames: speech is a frame well
/// above the floor; the turn ends after <see cref="EndSilence"/> (2 s) of quiet following at least <see cref="MinSpeech"/>
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

    /// <summary>Speech has started in this turn.</summary>
    public bool Started => started;
    /// <summary>Seconds of quiet since the last speech (0 while speaking or before any).</summary>
    public double Silence => started ? silence : 0;

    /// <summary>The floor as it stands (RMS), seeded from what was heard just before the turn began.</summary>
    public double Floor => floor;

    public void Reset(double seedFloor = -1)
    {
        floor = seedFloor;
        elapsed = speech = silence = 0;
        started = false;
        hot = 0;
    }

    /// <summary>One 30 ms frame's RMS (mono, -1..1). Frames of another length: call once per 30 ms of audio.</summary>
    public Verdict Feed(double rms)
    {
        elapsed += FrameSeconds;
        if (floor < 0) floor = Math.Max(rms, 0.002);
        // Speech: clearly over the floor, and over an absolute minimum so a silent room's tiny floor does not make
        // every breath speech.
        var threshold = Math.Max(floor * 3.2, 0.012);
        var loud = rms > threshold;
        if (loud)
        {
            hot++;
            // Two hot frames in a row before it counts: a click or a tap is not the start of a sentence.
            if (hot >= 2 || started)
            {
                started = true;
                speech += FrameSeconds;
                silence = 0;
            }
        }
        else
        {
            hot = 0;
            if (started) silence += FrameSeconds;
            // The floor follows the room, quickly down and slowly up, and never learns from speech.
            floor = rms < floor ? floor * 0.9 + rms * 0.1 : floor * 0.995 + rms * 0.005;
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
            return elapsed >= NoSpeechTimeout.TotalSeconds ? Verdict.NoSpeech : Verdict.Waiting;
        }
        return Verdict.Speaking;
    }
}

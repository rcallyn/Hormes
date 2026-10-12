using System;
using System.Collections.Generic;

namespace Hormes.Windows.Audio;

/// <summary>
/// Small local signal detector, from apps/mac Wake/ClapDetector.swift. It identifies two short, sharp transients;
/// it is intentionally not an identity check and cannot distinguish a replayed clap. Checked against the Mac's
/// recordings (apps/mac/Scripts/fixtures/clap-recordings.json) and against speech and clicks by apps/windows/Checks.
///
/// Stricter than the Mac's, because on Windows the microphone stays open for it all day: a keyboard, a "t" in a
/// sentence or a beat in music made two sharp transients often enough to wake it. A double clap here is also
/// <b>isolated</b> (0.3 s of quiet before the first clap, 80 ms before the second, and about one more clap interval of
/// quiet after the pair, so a third clap or a burst of typing cancels it), <b>matched</b> (the two within 2.5x of each
/// other in strength) and <b>clap-paced</b> (0.2 to 0.6 s apart). None of these depends on
/// loudness, so a soft clap in a quiet room still counts.
/// </summary>
public sealed class ClapDetector
{
    public readonly record struct Frame(double At, double Duration, double Rms, double Peak, double HighFrequency)
    {
        public double Crest => Peak / Math.Max(Rms, 0.000001);
    }

    /// <summary>The longest it waits in quiet after the second clap before the pair counts: 1.1 clap intervals, at least 0.15 s.</summary>
    public const double ConfirmSeconds = 0.5;
    private const double MinGap = 0.20, MaxGap = 0.60;
    private const double MaxStrengthRatio = 2.5;
    /// <summary>Frames (10 ms) of quiet required just before the first clap, and before the second.</summary>
    private const int QuietBeforeFirst = 30, QuietBeforeSecond = 8;

    private sealed class Pulse
    {
        public double At;
        public double End;
        public double StrongestRms;
        public bool NeedsFastDecay;
    }

    private double noise = 0.001;
    private double previousRms = 0.001;
    private Pulse? pulse;
    private double? first;
    private double firstStrength;
    private double? confirmUntil;
    private double quietUntil;
    private double cooldownUntil;
    private double lastAt = double.NegativeInfinity;
    private double? warmupUntil;
    private readonly Queue<double> recent = new();

    public void Reset()
    {
        noise = 0.001;
        previousRms = 0.001;
        pulse = null;
        first = null;
        firstStrength = 0;
        confirmUntil = null;
        quietUntil = 0;
        cooldownUntil = 0;
        lastAt = double.NegativeInfinity;
        warmupUntil = null;
        recent.Clear();
    }

    /// <summary>One 10 ms frame; true on the frame that confirms a double clap.</summary>
    public bool Feed(Frame f)
    {
        if (!double.IsFinite(f.At) || f.Duration <= 0 || f.Duration > 0.04 || !double.IsFinite(f.Rms) || f.Rms < 0
            || !double.IsFinite(f.Peak) || f.Peak < f.Rms || !double.IsFinite(f.HighFrequency) || f.HighFrequency < 0)
        {
            Reset();
            return false;
        }
        if (f.At < lastAt || f.At - lastAt > 0.25) Reset();
        lastAt = f.At;
        warmupUntil ??= f.At + 0.35;
        var threshold = Math.Max(0.014, noise * 7);
        // Below this the room is quiet: what isolation asks for before a clap and after the pair.
        var quiet = Math.Max(noise * 4, threshold * 0.45);
        // A microphone or AAC recording can soften a clap's high frequencies and
        // lower its crest. Keep the original broadband route, but admit those
        // filtered impulses only with a stronger rise and an immediate decay.
        var broadband = f.Crest >= 2.7 && f.HighFrequency >= 0.18;
        var filtered = f.Crest >= 2.2 && f.HighFrequency >= 0.004 && f.Rms >= previousRms * 4;
        var sharp = f.Rms >= threshold && ((broadband && f.Peak >= 0.065) || (filtered && f.Peak >= 0.06));
        var onset = sharp && f.Rms >= Math.Max(0.006, previousRms * 2.8);
        var quietBefore = QuietTail(quiet, first is null ? QuietBeforeFirst : QuietBeforeSecond);
        try
        {
            // The pair is in: it counts once the room has stayed quiet a moment.
            if (confirmUntil is { } until)
            {
                if (f.Rms > quiet)
                {
                    confirmUntil = null; first = null; quietUntil = f.At + 0.12;
                    return false;
                }
                if (f.At < until) return false;
                confirmUntil = null; cooldownUntil = f.At + 4;
                return true;
            }
            if (first is { } a0 && f.At - a0 > MaxGap + 0.1) first = null;
            if (pulse is { } p)
            {
                p.StrongestRms = Math.Max(p.StrongestRms, f.Rms);
                if (p.NeedsFastDecay && f.At - p.At >= 0.04 && f.Rms > p.StrongestRms * 0.35)
                {
                    pulse = null; first = null; quietUntil = f.At + 0.12;
                    return false;
                }
                if (f.Rms > Math.Max(0.006, noise * 3))
                {
                    p.End = f.At + f.Duration;
                    if (p.End - p.At > 0.10) { pulse = null; first = null; quietUntil = f.At + 0.12; }
                    return false;
                }
                pulse = null;
                quietUntil = f.At + 0.075;
                if (p.End - p.At > 0.10) { first = null; return false; }
                if (first is { } a && p.At - a >= MinGap && p.At - a <= MaxGap)
                {
                    var ratio = p.StrongestRms / Math.Max(firstStrength, 0.000001);
                    first = null;
                    if (ratio > MaxStrengthRatio || ratio < 1 / MaxStrengthRatio) return false;
                    confirmUntil = f.At + Math.Clamp((p.At - a) * 1.1, 0.15, ConfirmSeconds);
                    return false;
                }
                first = p.At;
                firstStrength = p.StrongestRms;
                return false;
            }
            if (f.At >= (warmupUntil ?? double.PositiveInfinity) && f.At >= cooldownUntil && f.At >= quietUntil && onset)
            {
                // Out of the blue, not out of ongoing sound: speech and typing are never quiet just before their clicks.
                if (quietBefore) pulse = new Pulse { At = f.At, End = f.At + f.Duration, StrongestRms = f.Rms, NeedsFastDecay = !broadband };
                else first = null;
            }
            else if (f.Rms < threshold)
                noise = Math.Max(0.0002, Math.Min(0.008, noise * 0.98 + f.Rms * 0.02));
            return false;
        }
        finally
        {
            previousRms = f.Rms;
            recent.Enqueue(f.Rms);
            while (recent.Count > QuietBeforeFirst) recent.Dequeue();
        }
    }

    /// <summary>The last <paramref name="frames"/> frames were all quiet (and there were that many).</summary>
    private bool QuietTail(double quiet, int frames)
    {
        if (recent.Count < frames) return false;
        var skip = recent.Count - frames;
        foreach (var r in recent)
        {
            if (skip-- > 0) continue;
            if (r > quiet) return false;
        }
        return true;
    }
}

/// <summary>
/// The live capture and the offline checks use identical 10 ms signal features (apps/mac ClapFrameExtractor).
/// Timestamps refer to audio samples, so callback scheduling cannot split a pair.
/// </summary>
public sealed class ClapFrameExtractor
{
    private double sampleRate;
    private int pending;
    private double squares, difference, peak, prior;
    private double windowAt;
    private double? nextAt;

    public List<ClapDetector.Frame> Frames(ReadOnlySpan<float> samples, double rate, double at)
    {
        var frames = new List<ClapDetector.Frame>();
        if (!double.IsFinite(rate) || rate <= 0 || samples.Length == 0 || !double.IsFinite(at)) return frames;
        if (sampleRate != rate || (nextAt is { } n && Math.Abs(at - n) > 1.5 / rate))
        {
            pending = 0; squares = 0; difference = 0; peak = 0; prior = 0;
        }
        sampleRate = rate;
        nextAt = at + samples.Length / rate;
        var window = Math.Max(1, (int)(rate * 0.01));
        for (var i = 0; i < samples.Length; i++)
        {
            if (pending == 0) windowAt = at + i / rate;
            double value = samples[i];
            squares += value * value;
            peak = Math.Max(peak, Math.Abs(value));
            if (pending > 0) difference += (value - prior) * (value - prior);
            prior = value;
            pending++;
            if (pending == window)
            {
                frames.Add(new ClapDetector.Frame(windowAt, window / rate, Math.Sqrt(squares / window), peak, difference / Math.Max(squares, 0.0000001)));
                pending = 0; squares = 0; difference = 0; peak = 0; prior = 0;
            }
        }
        return frames;
    }
}

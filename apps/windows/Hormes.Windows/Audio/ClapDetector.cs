using System;
using System.Collections.Generic;

namespace Hormes.Windows.Audio;

/// <summary>
/// Small local signal detector, ported line for line from apps/mac Wake/ClapDetector.swift. It identifies two short,
/// sharp transients; it is intentionally not an identity check and cannot distinguish a replayed clap. Checked
/// against the Mac's recordings (apps/mac/Scripts/fixtures/clap-recordings.json) by apps/windows/Checks.
/// </summary>
public sealed class ClapDetector
{
    public readonly record struct Frame(double At, double Duration, double Rms, double Peak, double HighFrequency)
    {
        public double Crest => Peak / Math.Max(Rms, 0.000001);
    }

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
    private double quietUntil;
    private double cooldownUntil;
    private double lastAt = double.NegativeInfinity;
    private double? warmupUntil;

    public void Reset()
    {
        noise = 0.001;
        previousRms = 0.001;
        pulse = null;
        first = null;
        quietUntil = 0;
        cooldownUntil = 0;
        lastAt = double.NegativeInfinity;
        warmupUntil = null;
    }

    /// <summary>One 10 ms frame; true on the frame that completes a double clap.</summary>
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
        // A microphone or AAC recording can soften a clap's high frequencies and
        // lower its crest. Keep the original broadband route, but admit those
        // filtered impulses only with a stronger rise and an immediate decay.
        var broadband = f.Crest >= 2.7 && f.HighFrequency >= 0.18;
        var filtered = f.Crest >= 2.2 && f.HighFrequency >= 0.004 && f.Rms >= previousRms * 4;
        var sharp = f.Rms >= threshold && ((broadband && f.Peak >= 0.065) || (filtered && f.Peak >= 0.06));
        var onset = sharp && f.Rms >= Math.Max(0.006, previousRms * 2.8);
        try
        {
            if (first is { } a0 && f.At - a0 > 0.75) first = null;
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
                if (first is { } a && p.At - a >= 0.18 && p.At - a <= 0.70)
                {
                    first = null; cooldownUntil = f.At + 4;
                    return true;
                }
                first = p.At;
                return false;
            }
            if (f.At >= (warmupUntil ?? double.PositiveInfinity) && f.At >= cooldownUntil && f.At >= quietUntil && onset)
                pulse = new Pulse { At = f.At, End = f.At + f.Duration, StrongestRms = f.Rms, NeedsFastDecay = !broadband };
            else if (f.Rms < threshold)
                noise = Math.Max(0.0002, Math.Min(0.008, noise * 0.98 + f.Rms * 0.02));
            return false;
        }
        finally
        {
            previousRms = f.Rms;
        }
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

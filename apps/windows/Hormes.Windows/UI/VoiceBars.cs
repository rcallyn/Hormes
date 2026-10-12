using System;
using System.Windows;
using System.Windows.Media;

namespace Hormes.Windows.UI;

/// <summary>
/// The five white voice bars on black: Hormes's mark, the app icon and the notch's face.
/// Asleep they rest as short stubs; listening they follow the mic, speaking the speaker,
/// thinking/working a slow travelling wave. Animates only while it is visible.
/// </summary>
public sealed class VoiceBars : FrameworkElement
{
    private static readonly double[] Shape = { 0.45, 0.75, 1.0, 0.75, 0.45 };
    private readonly double[] heights = new double[5];
    private TimeSpan last;
    private bool rendering;

    public string Phase { get; set; } = "asleep";
    /// <summary>Mic RMS, 0..1.</summary>
    public double Input { get; set; }
    /// <summary>Speaker RMS, 0..1.</summary>
    public double Output { get; set; }

    public VoiceBars()
    {
        IsVisibleChanged += (_, _) => SetRendering(IsVisible);
        Unloaded += (_, _) => SetRendering(false);
    }

    private void SetRendering(bool on)
    {
        if (on == rendering) return;
        rendering = on;
        if (on) CompositionTarget.Rendering += OnFrame;
        else CompositionTarget.Rendering -= OnFrame;
    }

    private void OnFrame(object? sender, EventArgs e)
    {
        var now = ((RenderingEventArgs)e).RenderingTime;
        if (now == last) return;
        last = now;
        var t = now.TotalSeconds;
        for (var i = 0; i < 5; i++)
        {
            double target = Phase switch
            {
                "listening" => 0.22 + Math.Min(1, Input * 6) * Shape[i],
                "speaking" => 0.22 + Math.Min(1, Output * 6) * Shape[i] * (0.8 + 0.2 * Math.Sin(t * 9 + i)),
                "thinking" or "acting" or "connecting" => 0.3 + 0.45 * (0.5 + 0.5 * Math.Sin(t * 4 - i * 0.9)),
                "paused" or "muted" => 0.3,
                _ => 0.22 + 0.05 * Math.Sin(t * 1.4 + i * 0.6),
            };
            heights[i] += (target - heights[i]) * 0.25;
        }
        InvalidateVisual();
    }

    protected override void OnRender(DrawingContext dc)
    {
        var w = ActualWidth;
        var h = ActualHeight;
        if (w <= 0 || h <= 0) return;
        var gap = w / 5 * 0.45;
        var bar = (w - gap * 4) / 5;
        var brush = Phase is "asleep" or "disconnected" ? Brushes.Gray : Brushes.White;
        for (var i = 0; i < 5; i++)
        {
            var bh = Math.Max(bar, Math.Clamp(heights[i], 0, 1) * h);
            var x = i * (bar + gap);
            dc.DrawRoundedRectangle(brush, null, new Rect(x, (h - bh) / 2, bar, bh), bar / 2, bar / 2);
        }
    }
}

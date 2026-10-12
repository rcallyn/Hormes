using System;
using System.Drawing;
using System.Runtime.InteropServices;

namespace Hormes.Windows.UI;

/// <summary>
/// Where the notch goes and how big it is: centred on the top edge of the primary monitor, whatever
/// the other monitors are and wherever they sit, and scaled so it takes the same share of that
/// monitor's width as it does on the 1600-DIP-wide display it was drawn for (3200×2000 at 200%).
/// A 1080p monitor at 100% scale (1920 DIPs) gets 1.2×, at 125% (1536 DIPs) 0.96×.
///
/// Everything here is in physical pixels, which is what the window manager places by: with
/// per-monitor DPI, WPF's Left/Top are in the DIPs of whichever monitor the window is on now.
/// </summary>
public readonly record struct NotchPlacement(double Scale, int X, int Y, int Width, int Height)
{
    /// <summary>The display width (DIPs) the notch's sizes in NotchWindow.xaml were drawn for.</summary>
    public const double ReferenceWidthDip = 1600;
    public const double MinScale = 0.8, MaxScale = 1.5;

    /// <param name="monitor">The primary monitor's bounds, physical pixels (virtual-screen coordinates).</param>
    /// <param name="dpi">Its effective DPI (96 = 100%).</param>
    /// <param name="baseWidth">The window's unscaled width, DIPs.</param>
    /// <param name="baseHeight">The window's unscaled height, DIPs.</param>
    public static NotchPlacement For(Rectangle monitor, uint dpi, double baseWidth, double baseHeight)
    {
        var factor = Math.Max(1, dpi) / 96.0;
        var widthDip = monitor.Width / factor;
        var scale = Math.Clamp(widthDip / ReferenceWidthDip, MinScale, MaxScale);
        var w = (int)Math.Round(baseWidth * scale * factor);
        var h = (int)Math.Round(baseHeight * scale * factor);
        var x = monitor.X + (monitor.Width - w) / 2;
        return new NotchPlacement(scale, x, monitor.Y, w, h);
    }

    /// <summary>The primary monitor's bounds (physical) and effective DPI, read now.</summary>
    public static (Rectangle Bounds, uint Dpi) Primary()
    {
        // The primary monitor is the one at the virtual screen's origin.
        var monitor = MonitorFromPoint(new POINT { X = 0, Y = 0 }, MONITOR_DEFAULTTOPRIMARY);
        var info = new MONITORINFO { cbSize = Marshal.SizeOf<MONITORINFO>() };
        GetMonitorInfo(monitor, ref info);
        var r = info.rcMonitor;
        if (GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, out var dpiX, out _) != 0) dpiX = 96;
        return (Rectangle.FromLTRB(r.Left, r.Top, r.Right, r.Bottom), dpiX);
    }

    private const uint MONITOR_DEFAULTTOPRIMARY = 1;
    private const int MDT_EFFECTIVE_DPI = 0;

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT { public int X, Y; }

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    private struct MONITORINFO
    {
        public int cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public uint dwFlags;
    }

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromPoint(POINT pt, uint dwFlags);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);

    [DllImport("shcore.dll")]
    private static extern int GetDpiForMonitor(IntPtr hmonitor, int dpiType, out uint dpiX, out uint dpiY);
}

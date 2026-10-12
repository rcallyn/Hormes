using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using static Hormes.Hands.Native;

namespace Hormes.Hands;

/// <summary>
/// Displays and screen capture. Global "points" are physical pixels with the origin at the top-left of the
/// primary monitor (negative on monitors left of or above it); the process is Per-Monitor-V2 aware, so a
/// display's scale is always 1 and a screenshot's `scale` is only its downscale factor.
/// </summary>
internal static class Screen
{
    internal sealed record Display(int Id, int X, int Y, int W, int H, bool Main);

    private static int _frame;

    /// <summary>Active monitors, primary first; ids are 1-based positions in that order (stable while the configuration is).</summary>
    public static List<Display> Displays()
    {
        var rects = new List<(RECT Rect, bool Main)>();
        EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (IntPtr hMon, IntPtr hdc, ref RECT rc, IntPtr lp) =>
        {
            var mi = new MONITORINFO { cbSize = System.Runtime.InteropServices.Marshal.SizeOf<MONITORINFO>() };
            if (GetMonitorInfo(hMon, ref mi)) rects.Add((mi.rcMonitor, (mi.dwFlags & 1) != 0));
            return true;
        }, IntPtr.Zero);
        return rects
            .OrderByDescending(r => r.Main).ThenBy(r => r.Rect.Left).ThenBy(r => r.Rect.Top)
            .Select((r, i) => new Display(i + 1, r.Rect.Left, r.Rect.Top, r.Rect.Width, r.Rect.Height, r.Main))
            .ToList();
    }

    public static Dictionary<string, object?> OpDisplays() => new()
    {
        ["displays"] = Displays().Select(d => (object?)new Dictionary<string, object?>
        {
            ["id"] = d.Id, ["x"] = d.X, ["y"] = d.Y, ["w"] = d.W, ["h"] = d.H, ["scale"] = 1.0, ["main"] = d.Main,
        }).ToList(),
    };

    public static (int X, int Y) CursorLocation()
    {
        GetCursorPos(out var p);
        return (p.X, p.Y);
    }

    public static Dictionary<string, object?> OpCursor()
    {
        var (x, y) = CursorLocation();
        return Json.Point(x, y);
    }

    private static Display? Containing(int x, int y, List<Display> ds) =>
        ds.FirstOrDefault(d => x >= d.X && x < d.X + d.W && y >= d.Y && y < d.Y + d.H);

    /// <summary>display: number | "main" | "cursor" (default "cursor").</summary>
    private static Display Resolve(Params p)
    {
        var ds = Displays();
        if (ds.Count == 0) throw HandsException.CaptureFailed("no active displays");
        var main = ds.FirstOrDefault(d => d.Main) ?? ds[0];
        Display Cursor() { var (cx, cy) = CursorLocation(); return Containing(cx, cy, ds) ?? main; }
        if (!p.Has("display")) return Cursor();
        // `display` may be a string or a number: read it raw.
        string? s = null;
        double? n = null;
        foreach (var prop in p.Properties)
        {
            if (prop.Name != "display") continue;
            if (prop.Value.ValueKind == System.Text.Json.JsonValueKind.String) s = prop.Value.GetString();
            else if (prop.Value.ValueKind == System.Text.Json.JsonValueKind.Number) n = prop.Value.GetDouble();
        }
        if (s is not null)
        {
            switch (s.ToLowerInvariant())
            {
                case "main": return main;
                case "cursor": return Cursor();
                default:
                    if (int.TryParse(s, out var id) && ds.FirstOrDefault(d => d.Id == id) is { } d1) return d1;
                    throw HandsException.BadRequest("'display' must be a display id, \"main\" or \"cursor\"");
            }
        }
        if (n is not null)
        {
            return ds.FirstOrDefault(d => d.Id == (int)n.Value) ?? throw HandsException.NotFound($"display {(int)n.Value} is not active");
        }
        throw HandsException.BadRequest("'display' must be a display id, \"main\" or \"cursor\"");
    }

    /// <summary>A hash of the display layout and the foreground window: a coordinate action compares it with the last shot's.</summary>
    public static string ConfigHash()
    {
        var sb = new StringBuilder();
        foreach (var d in Displays()) sb.Append($"{d.Id}:{d.X},{d.Y},{d.W},{d.H}{(d.Main ? "m" : "")};");
        sb.Append($"fg:{GetForegroundWindow().ToInt64()}");
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(sb.ToString())))[..16].ToLowerInvariant();
    }

    private static (int W, int H) Downscaled(int pw, int ph, double maxLongEdge, double maxPixels)
    {
        double w = Math.Max(pw, 1), h = Math.Max(ph, 1);
        double s = Math.Min(1.0, Math.Min(maxLongEdge / Math.Max(w, h), Math.Sqrt(maxPixels / (w * h))));
        if (double.IsNaN(s) || double.IsInfinity(s) || s <= 0) s = 1;
        return (Math.Max(1, (int)Math.Round(w * s)), Math.Max(1, (int)Math.Round(h * s)));
    }

    /// <summary>BitBlt the screen rectangle (global pixels) into a BGRA buffer, the cursor painted in when asked.</summary>
    private static byte[] Grab(int x, int y, int w, int h, bool showCursor)
    {
        IntPtr screen = GetDC(IntPtr.Zero);
        if (screen == IntPtr.Zero) throw HandsException.CaptureFailed("GetDC failed");
        IntPtr mem = CreateCompatibleDC(screen);
        IntPtr bmp = CreateCompatibleBitmap(screen, w, h);
        try
        {
            if (mem == IntPtr.Zero || bmp == IntPtr.Zero) throw HandsException.CaptureFailed("could not create the capture bitmap");
            IntPtr old = SelectObject(mem, bmp);
            if (!BitBlt(mem, 0, 0, w, h, screen, x, y, SRCCOPY | CAPTUREBLT))
                throw HandsException.CaptureFailed("BitBlt failed (the desktop may be locked or on a secure screen)");
            if (showCursor)
            {
                var ci = new CURSORINFO { cbSize = System.Runtime.InteropServices.Marshal.SizeOf<CURSORINFO>() };
                if (GetCursorInfo(ref ci) && (ci.flags & 1) != 0 && ci.hCursor != IntPtr.Zero)
                    DrawIconEx(mem, ci.ptScreenPos.X - x, ci.ptScreenPos.Y - y, ci.hCursor, 0, 0, 0, IntPtr.Zero, 3);
            }
            SelectObject(mem, old);
            var bi = new BITMAPINFOHEADER { biSize = System.Runtime.InteropServices.Marshal.SizeOf<BITMAPINFOHEADER>(), biWidth = w, biHeight = -h, biPlanes = 1, biBitCount = 32 };
            var buf = new byte[checked(w * h * 4)];
            if (GetDIBits(mem, bmp, 0, (uint)h, buf, ref bi, 0) == 0) throw HandsException.CaptureFailed("GetDIBits failed");
            return buf;
        }
        finally
        {
            if (bmp != IntPtr.Zero) DeleteObject(bmp);
            if (mem != IntPtr.Zero) DeleteDC(mem);
            ReleaseDC(IntPtr.Zero, screen);
        }
    }

    private static Dictionary<string, object?> CaptureResult(Display d, RECT region, int outW, int outH, bool showCursor)
    {
        string config = ConfigHash();
        int w = region.Width, h = region.Height;
        var pixels = Grab(region.Left, region.Top, w, h, showCursor);
        // GDI leaves alpha 0 in a 32-bit DIB: Bgr32 ignores it.
        BitmapSource src = BitmapSource.Create(w, h, 96, 96, PixelFormats.Bgr32, null, pixels, w * 4);
        if (outW != w || outH != h) src = new TransformedBitmap(src, new ScaleTransform((double)outW / w, (double)outH / h));
        var encoder = new PngBitmapEncoder();
        encoder.Frames.Add(BitmapFrame.Create(src));
        using var ms = new MemoryStream();
        encoder.Save(ms);
        int width = src.PixelWidth, height = src.PixelHeight;
        return new Dictionary<string, object?>
        {
            ["displayId"] = d.Id,
            ["pngBase64"] = Convert.ToBase64String(ms.GetBuffer(), 0, (int)ms.Length),
            ["width"] = width,
            ["height"] = height,
            ["points"] = Json.Rect(region.Left, region.Top, w, h),
            ["scale"] = w > 0 ? (double)width / w : 1.0,
            ["frameId"] = System.Threading.Interlocked.Increment(ref _frame),
            ["config"] = config,
        };
    }

    public static Dictionary<string, object?> OpScreenshot(Params p)
    {
        var d = Resolve(p);
        double maxLongEdge = p.Double("maxLongEdge") ?? 2576;
        double maxPixels = p.Double("maxPixels") ?? 3_750_000;
        if (maxLongEdge < 1) throw HandsException.BadRequest("'maxLongEdge' must be >= 1");
        if (maxPixels < 1) throw HandsException.BadRequest("'maxPixels' must be >= 1");
        bool showCursor = p.Bool("showCursor") ?? true;
        p.IntArray("excludePids"); // validated only: GDI cannot leave a process's windows out of the shot
        var (ow, oh) = Downscaled(d.W, d.H, maxLongEdge, maxPixels);
        return CaptureResult(d, new RECT { Left = d.X, Top = d.Y, Right = d.X + d.W, Bottom = d.Y + d.H }, ow, oh, showCursor);
    }

    public static Dictionary<string, object?> OpZoom(Params p)
    {
        double x = p.RequireDouble("x"), y = p.RequireDouble("y"), w = p.RequireDouble("w"), h = p.RequireDouble("h");
        if (w <= 0 || h <= 0) throw HandsException.BadRequest("'w' and 'h' must be > 0");
        double maxLongEdge = p.Double("maxLongEdge") ?? 2576;
        if (maxLongEdge < 1) throw HandsException.BadRequest("'maxLongEdge' must be >= 1");
        bool showCursor = p.Bool("showCursor") ?? false;
        var ds = Displays();
        if (ds.Count == 0) throw HandsException.CaptureFailed("no active displays");
        double cx = x + w / 2, cy = y + h / 2;
        long Overlap(Display d)
        {
            long iw = Math.Min((long)(x + w), d.X + d.W) - Math.Max((long)x, d.X);
            long ih = Math.Min((long)(y + h), d.Y + d.H) - Math.Max((long)y, d.Y);
            return iw > 0 && ih > 0 ? iw * ih : 0;
        }
        var disp = ds.FirstOrDefault(d => cx >= d.X && cx < d.X + d.W && cy >= d.Y && cy < d.Y + d.H) ?? ds.OrderByDescending(Overlap).First();
        int l = (int)Math.Max(Math.Floor(x), disp.X), t = (int)Math.Max(Math.Floor(y), disp.Y);
        int r = (int)Math.Min(Math.Ceiling(x + w), disp.X + disp.W), b = (int)Math.Min(Math.Ceiling(y + h), disp.Y + disp.H);
        if (r - l < 1 || b - t < 1) throw HandsException.BadRequest("region is not on any display");
        double ow = r - l, oh = b - t;
        double longEdge = Math.Max(ow, oh);
        if (longEdge > maxLongEdge) { double f = maxLongEdge / longEdge; ow *= f; oh *= f; }
        return CaptureResult(disp, new RECT { Left = l, Top = t, Right = r, Bottom = b }, Math.Max(1, (int)Math.Round(ow)), Math.Max(1, (int)Math.Round(oh)), showCursor);
    }
}

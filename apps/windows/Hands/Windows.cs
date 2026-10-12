using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading;
using static Hormes.Hands.Native;

namespace Hormes.Hands;

/// <summary>Top-level windows, the foreground window, and launching / focusing apps.</summary>
internal static class Windows
{
    internal sealed record Win(long Id, int Pid, string App, string Title, RECT Bounds);

    private static readonly Dictionary<int, string> AppNames = new();

    /// <summary>The name a person calls the app of this process: its file description ("Notepad"), else the process name.</summary>
    public static string AppName(int pid)
    {
        lock (AppNames)
        {
            if (AppNames.TryGetValue(pid, out var cached)) return cached;
        }
        string name = "";
        try
        {
            using var proc = Process.GetProcessById(pid);
            name = proc.ProcessName;
            try
            {
                var desc = proc.MainModule?.FileVersionInfo.FileDescription;
                if (!string.IsNullOrWhiteSpace(desc)) name = desc.Trim();
            }
            catch { /* an elevated or protected process: keep the process name */ }
        }
        catch { /* gone */ }
        lock (AppNames) AppNames[pid] = name;
        return name;
    }

    public static string ProcessName(int pid)
    {
        try { using var p = Process.GetProcessById(pid); return p.ProcessName; } catch { return ""; }
    }

    /// <summary>
    /// The process that owns a top-level window. A Store app's window (Calculator, Settings, Photos) belongs to
    /// ApplicationFrameHost; the app itself owns a child CoreWindow, and that is the process reported.
    /// </summary>
    public static int OwnerPid(IntPtr h)
    {
        GetWindowThreadProcessId(h, out uint pid);
        if (!ProcessName((int)pid).Equals("ApplicationFrameHost", StringComparison.OrdinalIgnoreCase)) return (int)pid;
        uint hosted = 0;
        EnumChildWindows(h, (child, _) =>
        {
            GetWindowThreadProcessId(child, out uint c);
            if (c != pid) { hosted = c; return false; }
            return true;
        }, IntPtr.Zero);
        return hosted != 0 ? (int)hosted : (int)pid;
    }

    public static bool Matches(int pid, string wanted)
    {
        string w = wanted.Trim().ToLowerInvariant();
        if (w.EndsWith(".exe")) w = w[..^4];
        return AppName(pid).ToLowerInvariant() == w || ProcessName(pid).ToLowerInvariant() == w;
    }

    private static bool Cloaked(IntPtr h) => DwmGetWindowAttribute(h, DWMWA_CLOAKED, out int c, sizeof(int)) == 0 && c != 0;

    public static RECT FrameBounds(IntPtr h)
    {
        if (DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, out RECT r, System.Runtime.InteropServices.Marshal.SizeOf<RECT>()) == 0) return r;
        GetWindowRect(h, out r);
        return r;
    }

    private static Win Describe(IntPtr h)
    {
        int pid = OwnerPid(h);
        return new Win(h.ToInt64(), pid, AppName(pid), WindowTitle(h), FrameBounds(h));
    }

    /// <summary>Visible, un-minimised, un-cloaked top-level windows, front to back; untitled tool windows are left out.</summary>
    public static List<Win> Enumerate()
    {
        var list = new List<Win>();
        uint self = (uint)Environment.ProcessId;
        EnumWindows((h, _) =>
        {
            if (!IsWindowVisible(h) || IsIconic(h) || Cloaked(h)) return true;
            long ex = GetWindowLongPtr(h, GWL_EXSTYLE).ToInt64();
            string title = WindowTitle(h);
            if ((ex & WS_EX_TOOLWINDOW) != 0 && (ex & WS_EX_APPWINDOW) == 0) return true;
            if (title.Length == 0) return true;
            int pid = OwnerPid(h);
            if (pid == self) return true;
            var b = FrameBounds(h);
            if (b.Width <= 0 || b.Height <= 0) return true;
            list.Add(new Win(h.ToInt64(), pid, AppName(pid), title, b));
            return true;
        }, IntPtr.Zero);
        return list;
    }

    public static Dictionary<string, object?> OpWindows(Params p)
    {
        p.Bool("allLayers");
        return new Dictionary<string, object?>
        {
            ["windows"] = Enumerate().Select(w => (object?)new Dictionary<string, object?>
            {
                ["windowId"] = w.Id, ["pid"] = w.Pid, ["app"] = w.App, ["title"] = w.Title,
                ["x"] = w.Bounds.Left, ["y"] = w.Bounds.Top, ["w"] = w.Bounds.Width, ["h"] = w.Bounds.Height,
                ["layer"] = 0, ["onScreen"] = true,
            }).ToList(),
        };
    }

    public static (IntPtr Hwnd, int Pid)? Foreground()
    {
        var h = GetForegroundWindow();
        if (h == IntPtr.Zero) return null;
        return (h, OwnerPid(h));
    }

    public static Dictionary<string, object?> OpFrontmost()
    {
        var fg = Foreground();
        if (fg is null) throw HandsException.NotFound("no foreground window");
        var (h, pid) = fg.Value;
        var w = Describe(h);
        string proc = ProcessName(pid);
        return new Dictionary<string, object?>
        {
            ["app"] = w.App.Length > 0 ? w.App : proc,
            ["bundleId"] = proc.Length > 0 ? proc.ToLowerInvariant() + ".exe" : null,
            ["pid"] = pid,
            ["window"] = new Dictionary<string, object?>
            {
                ["title"] = w.Title, ["x"] = w.Bounds.Left, ["y"] = w.Bounds.Top, ["w"] = w.Bounds.Width, ["h"] = w.Bounds.Height, ["windowId"] = w.Id,
            },
        };
    }

    // ------------------------------------------------------------------ open / focus

    private static readonly string[] StartMenuRoots =
    {
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonStartMenu), "Programs"),
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs"),
    };

    private static string? FindShortcut(string name, bool exact)
    {
        string w = name.Trim().ToLowerInvariant();
        string? contains = null;
        foreach (var root in StartMenuRoots.Where(Directory.Exists))
        {
            IEnumerable<string> files;
            try { files = Directory.EnumerateFiles(root, "*.lnk", SearchOption.AllDirectories); } catch { continue; }
            foreach (var f in files)
            {
                string stem = Path.GetFileNameWithoutExtension(f).ToLowerInvariant();
                if (stem == w) return f;
                if (!exact && contains is null && stem.Contains(w) && !stem.Contains("uninstall")) contains = f;
            }
        }
        return exact ? null : contains;
    }

    private static bool Shell(string file, string? args = null)
    {
        try
        {
            Process.Start(new ProcessStartInfo(file) { UseShellExecute = true, Arguments = args ?? "" })?.Dispose();
            return true;
        }
        catch { return false; }
    }

    public static Dictionary<string, object?> OpOpenApp(Params p)
    {
        string? name = p.String("name"), path = p.String("path");
        p.String("bundleId");
        if (name is null && path is null) throw HandsException.BadRequest("one of 'name' or 'path' is required");
        bool activate = p.Bool("activate") ?? true;
        if (activate) Input.GuardActing(p);
        var before = Foreground();
        var existing = Enumerate().Select(w => w.Id).ToHashSet();

        string launched;
        if (path is not null)
        {
            if (!File.Exists(path)) throw HandsException.NotFound($"could not find application {path}");
            if (!Shell(path)) throw HandsException.Internal($"could not launch {path}");
            launched = path;
        }
        else
        {
            string n = name!;
            // Exact names first: a shortcut named exactly so, then what Windows itself resolves ("notepad", "calc", a
            // registered App Path). Only then a shortcut that merely contains the name, so "notepad" never opens Notepad++.
            string? lnk = FindShortcut(n, exact: true);
            string? partial;
            if (lnk is not null && Shell(lnk)) launched = lnk;
            else if (Shell(n)) launched = n;
            else if ((partial = FindShortcut(n, exact: false)) is not null && Shell(partial)) launched = partial;
            else throw HandsException.NotFound($"could not find application {n}");
        }

        // Wait for the app's window: a new top-level window, or the foreground moving to an app that matches the name.
        var deadline = DateTime.UtcNow.AddSeconds(5);
        Win? found = null;
        string probe = name ?? Path.GetFileNameWithoutExtension(path!);
        while (DateTime.UtcNow < deadline && found is null)
        {
            Thread.Sleep(150);
            var now = Enumerate();
            found = now.FirstOrDefault(w => !existing.Contains(w.Id) && (Matches(w.Pid, probe) || w.Title.Contains(probe, StringComparison.OrdinalIgnoreCase)))
                ?? now.FirstOrDefault(w => !existing.Contains(w.Id));
            found ??= now.FirstOrDefault(w => Matches(w.Pid, probe) && Foreground()?.Pid == w.Pid);
        }
        if (found is not null && activate) FocusWindow(new IntPtr(found.Id));
        var fg = found is null ? Foreground() : null;
        int pid = found?.Pid ?? fg?.Pid ?? 0;
        string proc = pid > 0 ? ProcessName(pid) : "";
        return new Dictionary<string, object?>
        {
            ["pid"] = pid,
            ["bundleId"] = proc.Length > 0 ? proc.ToLowerInvariant() + ".exe" : null,
            ["app"] = pid > 0 ? AppName(pid) : null,
            ["path"] = launched,
        };
    }

    /// <summary>Bring a window to the front: restore it, then SetForegroundWindow with the AttachThreadInput / Alt trick.</summary>
    public static bool FocusWindow(IntPtr h)
    {
        if (IsIconic(h)) ShowWindow(h, SW_RESTORE);
        var fg = GetForegroundWindow();
        if (fg == h) return true;
        uint fgThread = fg == IntPtr.Zero ? 0 : GetWindowThreadProcessId(fg, out _);
        uint me = GetCurrentThreadId();
        bool attached = fgThread != 0 && fgThread != me && AttachThreadInput(me, fgThread, true);
        try
        {
            // A tap of Alt lets this process claim the foreground (the system only lends it to a process that just had input).
            keybd_event(0x12, 0, 0, UIntPtr.Zero);
            keybd_event(0x12, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
            BringWindowToTop(h);
            SetForegroundWindow(h);
        }
        finally
        {
            if (attached) AttachThreadInput(me, fgThread, false);
        }
        for (int i = 0; i < 10; i++)
        {
            if (GetForegroundWindow() == h) return true;
            Thread.Sleep(30);
        }
        return GetForegroundWindow() == h;
    }

    public static Dictionary<string, object?> OpFocusApp(Params p)
    {
        int? pid = p.Int("pid");
        string? name = p.String("name");
        if (pid is null && name is null) throw HandsException.BadRequest("'pid' or 'name' is required");
        Input.GuardActing(p);
        var all = Enumerate();
        Win? target = pid is not null ? all.FirstOrDefault(w => w.Pid == pid) : all.FirstOrDefault(w => Matches(w.Pid, name!));
        if (target is null)
        {
            // A minimised window is not in the list: look for the process's main window.
            Process? proc = null;
            try
            {
                proc = pid is not null ? Process.GetProcessById(pid.Value)
                    : Process.GetProcesses().FirstOrDefault(x => Matches(x.Id, name!) && x.MainWindowHandle != IntPtr.Zero);
            }
            catch { }
            if (proc is null || proc.MainWindowHandle == IntPtr.Zero)
                throw HandsException.NotFound(pid is not null ? $"no running application with pid {pid}" : $"no running application named {name}");
            target = Describe(proc.MainWindowHandle);
        }
        bool activated = FocusWindow(new IntPtr(target.Id));
        string procName = ProcessName(target.Pid);
        return new Dictionary<string, object?>
        {
            ["pid"] = target.Pid,
            ["bundleId"] = procName.Length > 0 ? procName.ToLowerInvariant() + ".exe" : null,
            ["app"] = target.App,
            ["activated"] = activated,
        };
    }
}

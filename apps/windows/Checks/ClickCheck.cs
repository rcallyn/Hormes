using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Threading;

namespace Hormes.Windows.Checks;

/// <summary>
/// --hands-click: clicking and focusing through build/hands/hormes-hands.exe, on Calculator only. Opens Calculator,
/// clicks 7 + 8 = by UI Automation name and reads 15 back; moves the focus to Notepad (no keys sent there), brings
/// Calculator back with focus_app, and closes Calculator. Every click and key first checks Calculator is in front.
///
/// --console-pass [dir]: opens the Console from the notch by hovering it and clicking "Console", then clicks each
/// sidebar page and saves a screenshot of the window per page. Clicks only Hormes's own windows.
/// </summary>
internal static class ClickCheck
{
    private static int _failures, _seq;
    private static Process _helper = null!;

    private static void Check(bool ok, string what, string detail = "")
    {
        Console.WriteLine($"{(ok ? "ok  " : "FAIL")} {what}{(detail.Length == 0 ? "" : $" ({detail})")}");
        if (!ok) _failures++;
    }

    private static JsonElement? Call(string op, object? args = null)
    {
        var req = new System.Collections.Generic.Dictionary<string, object?> { ["id"] = $"k{++_seq}", ["op"] = op };
        if (args is not null)
            foreach (var p in JsonSerializer.SerializeToElement(args).EnumerateObject()) req[p.Name] = p.Value;
        _helper.StandardInput.WriteLine(JsonSerializer.Serialize(req));
        _helper.StandardInput.Flush();
        var line = _helper.StandardOutput.ReadLine();
        if (line is null) return null;
        var root = JsonDocument.Parse(line).RootElement.Clone();
        if (!root.GetProperty("ok").GetBoolean())
        {
            var e = root.GetProperty("error");
            Console.WriteLine($"info {op} -> {e.GetProperty("code").GetString()}: {e.GetProperty("message").GetString()}");
            return null;
        }
        return root.GetProperty("result");
    }

    private static void Start(string repo)
    {
        _helper = Process.Start(new ProcessStartInfo(Path.Combine(repo, "build", "hands", "hormes-hands.exe"))
        {
            RedirectStandardInput = true, RedirectStandardOutput = true, UseShellExecute = false, CreateNoWindow = true,
            StandardOutputEncoding = new UTF8Encoding(false), StandardInputEncoding = new UTF8Encoding(false),
        })!;
    }

    private static void Stop() { try { _helper.StandardInput.Close(); _helper.WaitForExit(3000); } catch { } }

    private static string FrontProcess(out int pid)
    {
        pid = 0;
        var f = Call("frontmost");
        if (f is null) return "";
        pid = f.Value.GetProperty("pid").GetInt32();
        try { using var p = Process.GetProcessById(pid); return p.ProcessName; } catch { return ""; }
    }

    private static bool IsCalc(string proc) => proc.Equals("CalculatorApp", StringComparison.OrdinalIgnoreCase);
    private static bool IsHormes(string proc) => proc.Equals("Hormes", StringComparison.OrdinalIgnoreCase);

    /// <summary>Find an element by name in the frontmost window and click its centre, only while <paramref name="front"/> holds.</summary>
    private static bool ClickNamed(string name, Func<string, bool> front, string? role = null)
    {
        if (!front(FrontProcess(out var pid))) { Check(false, $"click {name}", "the expected app is no longer in front; stopped"); return false; }
        var found = Call("find_element", new { name, role, maxAgeMs = 0 });
        if (found is null || !found.Value.GetProperty("found").GetBoolean()) { Check(false, $"find {name}"); return false; }
        var c = found.Value.GetProperty("element").GetProperty("center");
        var clicked = Call("click", new { x = c.GetProperty("x").GetDouble(), y = c.GetProperty("y").GetDouble(), button = "left", count = 1, ownDriver = true, expectFront = new { pid } });
        Thread.Sleep(250);
        return clicked is not null;
    }

    public static int RunClick(string repo)
    {
        Start(repo);
        try
        {
            Check(Call("open_app", new { name = "calc", ownDriver = true }) is not null, "open_app calc");
            Thread.Sleep(1500);
            if (!IsCalc(FrontProcess(out _))) { Check(false, "Calculator is in front", "stopped; nothing was clicked"); return 1; }
            Check(true, "Calculator is in front");

            var allClicked = ClickNamed("Clear", IsCalc) & ClickNamed("Seven", IsCalc) & ClickNamed("Plus", IsCalc) & ClickNamed("Eight", IsCalc) & ClickNamed("Equals", IsCalc);
            Check(allClicked, "click Clear, 7, +, 8, = by name");
            var display = Call("find_element", new { name = "Display is", maxAgeMs = 0 });
            var label = display is not null && display.Value.GetProperty("found").GetBoolean() ? display.Value.GetProperty("element").GetProperty("label").GetString() ?? "" : "";
            Check(label.Contains("15"), "Calculator shows 15", label);

            // Focus: send the focus elsewhere (Notepad opens; nothing is sent to it), then bring Calculator back.
            Call("open_app", new { name = "notepad", ownDriver = true });
            Thread.Sleep(1200);
            var away = FrontProcess(out _);
            Check(!IsCalc(away), "the focus moved away from Calculator", away);
            Call("focus_app", new { name = "CalculatorApp", ownDriver = true });
            Thread.Sleep(600);
            var back = FrontProcess(out var calcPid);
            Check(IsCalc(back), "focus_app brings Calculator back to the front", back);

            if (IsCalc(back)) Call("key", new { combo = "alt+F4", ownDriver = true, expectFront = new { pid = calcPid } });
        }
        finally { Stop(); }
        Console.WriteLine(_failures == 0 ? "all click checks passed" : $"{_failures} click check(s) failed");
        return _failures == 0 ? 0 : 1;
    }

    public static int RunConsolePass(string repo, string dir)
    {
        Directory.CreateDirectory(dir);
        Start(repo);
        try
        {
            // The Console is opened by the caller (Hormes.exe --console); bring its window to the front.
            Call("focus_app", new { name = "Hormes", ownDriver = true });
            Thread.Sleep(800);
            var front0 = FrontProcess(out _);
            if (!IsHormes(front0)) { Check(false, "the Console is in front", $"front is {front0}; stopped, nothing was clicked"); return 1; }
            Check(true, "the Console is in front");

            foreach (var page in new[] { "Home", "Calendar", "Todos", "School", "Settings" })
            {
                if (!ClickNamed(page, IsHormes)) continue;
                Thread.Sleep(900);
                var front = Call("frontmost");
                if (front is null) { Check(false, $"{page}: screenshot"); continue; }
                var w = front.Value.GetProperty("window");
                var shot = Call("zoom", new { x = w.GetProperty("x").GetDouble(), y = w.GetProperty("y").GetDouble(), w = w.GetProperty("w").GetDouble(), h = w.GetProperty("h").GetDouble(), maxLongEdge = 1400 });
                if (shot is null) { Check(false, $"{page}: screenshot"); continue; }
                File.WriteAllBytes(Path.Combine(dir, $"{page.ToLowerInvariant()}.png"), Convert.FromBase64String(shot.Value.GetProperty("pngBase64").GetString()!));
                Check(true, $"{page}: clicked and captured");
            }
        }
        finally { Stop(); }
        Console.WriteLine(_failures == 0 ? "console pass done" : $"{_failures} console step(s) failed");
        return _failures == 0 ? 0 : 1;
    }
}

using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Threading;

namespace Hormes.Windows.Checks;

/// <summary>
/// `--hands`: drives build/hands/hormes-hands.exe like the engine does. Opens Notepad, types "hello" through the helper,
/// reads it back with focused_text and closes Notepad without saving. It takes the keyboard for a few seconds: run it
/// on a desktop you are not using. Build the helper first with `pnpm build:hands`.
/// </summary>
internal static class HandsCheck
{
    private static int _failures;
    private static int _seq;
    private static Process _helper = null!;

    private static void Check(bool ok, string what, string detail = "")
    {
        Console.WriteLine($"{(ok ? "ok  " : "FAIL")} {what}{(ok || detail.Length == 0 ? "" : $": {detail}")}");
        if (!ok) _failures++;
    }

    private static JsonElement? Call(string op, object? args = null)
    {
        var req = new System.Collections.Generic.Dictionary<string, object?> { ["id"] = $"c{++_seq}", ["op"] = op };
        if (args is not null)
            foreach (var p in JsonSerializer.SerializeToElement(args).EnumerateObject()) req[p.Name] = p.Value;
        _helper.StandardInput.WriteLine(JsonSerializer.Serialize(req));
        _helper.StandardInput.Flush();
        string? line = _helper.StandardOutput.ReadLine();
        if (line is null) { Check(false, op, "the helper closed its output"); return null; }
        var root = JsonDocument.Parse(line).RootElement.Clone();
        if (!root.GetProperty("ok").GetBoolean())
        {
            var e = root.GetProperty("error");
            Console.WriteLine($"info {op} -> {e.GetProperty("code").GetString()}: {e.GetProperty("message").GetString()}");
            return null;
        }
        return root.GetProperty("result");
    }

    public static int Run(string repo)
    {
        string exe = Path.Combine(repo, "build", "hands", "hormes-hands.exe");
        if (!File.Exists(exe))
        {
            Console.WriteLine($"FAIL the helper is not built at {exe}; run: pnpm build:hands");
            return 1;
        }
        _helper = Process.Start(new ProcessStartInfo(exe)
        {
            RedirectStandardInput = true, RedirectStandardOutput = true, UseShellExecute = false, CreateNoWindow = true,
            StandardOutputEncoding = new UTF8Encoding(false), StandardInputEncoding = new UTF8Encoding(false),
        })!;

        var hello = Call("hello");
        Check(hello is not null && hello.Value.GetProperty("version").GetString() == "2.0.0", "helper says hello");

        // Only ever acts on Windows Notepad (process "Notepad", exactly), in a new tab of its own that it empties and
        // closes; never keys into a tab it did not just make, and never into anything else.
        bool NotepadInFront(out int pid)
        {
            pid = 0;
            var f = Call("frontmost");
            if (f is null) return false;
            pid = f.Value.GetProperty("pid").GetInt32();
            try { using var proc = Process.GetProcessById(pid); return proc.ProcessName.Equals("Notepad", StringComparison.OrdinalIgnoreCase); }
            catch { return false; }
        }

        var opened = Call("open_app", new { name = "notepad", ownDriver = true });
        Check(opened is not null, "open_app notepad");
        Thread.Sleep(1000);
        if (!NotepadInFront(out var notepadPid))
        {
            Check(false, "Windows Notepad is in front (stopped here; nothing was typed)");
            try { _helper.StandardInput.Close(); _helper.WaitForExit(3000); } catch { }
            Console.WriteLine($"{_failures} hands check(s) failed");
            return 1;
        }
        Check(true, "Windows Notepad is in front");

        var tabOpen = false;
        try
        {
            Call("key", new { combo = "ctrl+n", ownDriver = true, expectFront = new { pid = notepadPid } });
            Thread.Sleep(500);
            tabOpen = NotepadInFront(out _);
            if (!tabOpen) { Check(false, "a new Notepad tab (stopped here; nothing was typed)"); return 1; }
            var typed = Call("type", new { text = "hello", ownDriver = true, expectFront = new { pid = notepadPid } });
            Check(typed is not null && typed.Value.GetProperty("characters").GetInt32() == 5, "type hello",
                typed is null ? "" : $"via {typed.Value.GetProperty("via").GetString()}");
            Thread.Sleep(300);

            var focused = Call("focused_text");
            if (focused is not null) Console.WriteLine($"info focused_text -> {focused.Value.GetRawText()}");
            string value = focused is not null && focused.Value.TryGetProperty("value", out var v) && v.ValueKind == JsonValueKind.String ? v.GetString()! : "";
            Check(value.Contains("hello", StringComparison.Ordinal), "focused_text reads hello back", $"got \"{value}\"");
        }
        finally
        {
            // Close the check's own tab only: empty it (it holds only "hello"), then Ctrl+W, which closes an empty untitled
            // tab without a prompt. No "don't save" key is ever sent: if a dialog did appear, it is left for User.
            if (tabOpen && NotepadInFront(out _))
            {
                Call("key", new { combo = "ctrl+a", ownDriver = true, expectFront = new { pid = notepadPid } });
                Call("key", new { combo = "delete", ownDriver = true, expectFront = new { pid = notepadPid } });
                Thread.Sleep(200);
                if (NotepadInFront(out _)) Call("key", new { combo = "ctrl+w", ownDriver = true, expectFront = new { pid = notepadPid } });
                Thread.Sleep(400);
            }
            try { _helper.StandardInput.Close(); _helper.WaitForExit(3000); } catch { }
        }

        Console.WriteLine(_failures == 0 ? "all hands checks passed" : $"{_failures} hands check(s) failed");
        return _failures == 0 ? 0 : 1;
    }
}

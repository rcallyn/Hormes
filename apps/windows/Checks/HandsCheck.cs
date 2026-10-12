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

        int notepadPid = 0;
        try
        {
            var opened = Call("open_app", new { name = "notepad", ownDriver = true });
            Check(opened is not null, "open_app notepad");
            if (opened is not null) notepadPid = opened.Value.GetProperty("pid").GetInt32();
            Thread.Sleep(800);

            var front = Call("frontmost");
            Check(front is not null && (front.Value.GetProperty("app").GetString() ?? "").Contains("notepad", StringComparison.OrdinalIgnoreCase),
                "Notepad is in front", front is null ? "no frontmost" : front.Value.GetProperty("app").GetString() ?? "");
            if (front is not null) notepadPid = front.Value.GetProperty("pid").GetInt32();

            // Clear whatever a restored session left in the document, then type.
            Call("key", new { combo = "ctrl+a", ownDriver = true });
            Call("key", new { combo = "delete", ownDriver = true });
            var typed = Call("type", new { text = "hello", ownDriver = true, expectFront = new { pid = notepadPid } });
            Check(typed is not null && typed.Value.GetProperty("characters").GetInt32() == 5, "type hello",
                typed is null ? "" : $"via {typed.Value.GetProperty("via").GetString()}");
            Thread.Sleep(300);

            var focused = Call("focused_text");
            string value = focused is not null && focused.Value.TryGetProperty("value", out var v) && v.ValueKind == JsonValueKind.String ? v.GetString()! : "";
            Check(value.Contains("hello", StringComparison.Ordinal), "focused_text reads hello back", $"got \"{value}\"");
        }
        finally
        {
            // Close without saving: Alt+F4, then "Don't save" if Notepad asks; kill what is left.
            Call("key", new { combo = "alt+F4", ownDriver = true });
            Thread.Sleep(700);
            var after = Call("frontmost");
            if (after is not null && notepadPid > 0 && after.Value.GetProperty("pid").GetInt32() == notepadPid)
            {
                Call("key", new { combo = "n", ownDriver = true });
                Thread.Sleep(500);
            }
            try
            {
                using var np = notepadPid > 0 ? Process.GetProcessById(notepadPid) : null;
                if (np is not null && !np.HasExited && np.ProcessName.Contains("notepad", StringComparison.OrdinalIgnoreCase)) np.Kill();
            }
            catch { /* already closed */ }
            try { _helper.StandardInput.Close(); _helper.WaitForExit(3000); } catch { }
        }

        Console.WriteLine(_failures == 0 ? "all hands checks passed" : $"{_failures} hands check(s) failed");
        return _failures == 0 ? 0 : 1;
    }
}

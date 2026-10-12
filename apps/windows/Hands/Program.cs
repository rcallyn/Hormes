using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Threading;

namespace Hormes.Hands;

// hormes-hands (Windows): the engine's native helper over stdio.
// One JSON object per line on stdin, one response line per request on stdout, processed serially in order.
// Debug output goes to stderr only. Exits cleanly on stdin EOF.
//
// Coordinates: global points, origin top-left of the primary display, negative allowed. The process is
// Per-Monitor-V2 DPI aware (manifest + SetProcessDpiAwarenessContext), so a point is a physical pixel and every
// display's scale is 1.
internal static class Program
{
    internal const string Version = "2.0.0";

    private static readonly JsonSerializerOptions JsonOpts = new() { DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.Never, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping };
    private static StreamWriter _out = null!;

    private static Dictionary<string, object?> Permissions() => new()
    {
        // Windows has no per-app grants for these: input injection, capture and UI Automation are open to any process in the session.
        ["accessibility"] = true, ["screenRecording"] = true, ["inputMonitoring"] = true, ["fullDiskAccess"] = true,
    };

    private static Dictionary<string, object?> Dispatch(string op, Params p) => op switch
    {
        "hello" => new() { ["version"] = Version, ["pid"] = Environment.ProcessId, ["permissions"] = Permissions() },
        "owner_approval" => Approval.Op(p),
        "permissions" => new(),
        "displays" => Screen.OpDisplays(),
        "screenshot" => Screen.OpScreenshot(p),
        "zoom" => Screen.OpZoom(p),
        "cursor" => Screen.OpCursor(),
        "move" => Input.OpMove(p),
        "click" => Input.OpClick(p),
        "mouse_down" => Input.OpMouseDown(p),
        "mouse_up" => Input.OpMouseUp(p),
        "drag" => Input.OpDrag(p),
        "scroll" => Input.OpScroll(p),
        "type" => Input.OpType(p),
        "key" => Input.OpKey(p),
        "hold_key" => Input.OpHoldKey(p),
        "frontmost" => Windows.OpFrontmost(),
        "windows" => Windows.OpWindows(p),
        "open_app" => Windows.OpOpenApp(p),
        "focus_app" => Windows.OpFocusApp(p),
        "focused_text" => Uia.OpFocusedText(),
        "element_at" => Uia.OpElementAt(p),
        "find_element" => Uia.OpFindElement(p),
        "ax_tree" => Uia.OpAxTree(p),
        "browser_js" or "browser_tabs" or "browser_navigate" or "browser_url" => throw HandsException.BadRequest("not supported on Windows"),
        "user_idle" => Input.OpUserIdle(),
        "wait" => Wait(p),
        _ => throw HandsException.BadRequest($"unknown op '{op}'"),
    };

    private static Dictionary<string, object?> Wait(Params p)
    {
        int ms = p.RequireInt("ms");
        if (ms < 0) throw HandsException.BadRequest("'ms' must be >= 0");
        Thread.Sleep(Math.Min(ms, 10_000));
        return new();
    }

    private static void Send(object? id, bool ok, object payload)
    {
        var line = new Dictionary<string, object?> { ["id"] = id, ["ok"] = ok };
        line[ok ? "result" : "error"] = payload;
        string json;
        try { json = JsonSerializer.Serialize(line, JsonOpts); }
        catch (Exception e)
        {
            json = JsonSerializer.Serialize(new Dictionary<string, object?>
            {
                ["id"] = id, ["ok"] = false,
                ["error"] = new Dictionary<string, object?> { ["code"] = "internal", ["message"] = "response was not serializable: " + e.Message },
            }, JsonOpts);
        }
        try { _out.Write(json); _out.Write('\n'); _out.Flush(); }
        catch (IOException) { Environment.Exit(0); }   // the parent is gone
    }

    private static void Fail(object? id, string code, string message) =>
        Send(id, false, new Dictionary<string, object?> { ["code"] = code, ["message"] = message });

    private static void HandleLine(string line)
    {
        if (line.Trim().Length == 0) return;
        JsonDocument doc;
        try { doc = JsonDocument.Parse(line); }
        catch (JsonException) { Fail(null, "bad_request", "request must be a JSON object"); return; }
        using (doc)
        {
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) { Fail(null, "bad_request", "request must be a JSON object"); return; }
            object? id = null;
            if (root.TryGetProperty("id", out var idEl))
            {
                if (idEl.ValueKind == JsonValueKind.String) id = idEl.GetString();
                else if (idEl.ValueKind == JsonValueKind.Number) id = idEl.GetDouble();
            }
            if (!root.TryGetProperty("op", out var opEl) || opEl.ValueKind != JsonValueKind.String)
            {
                Fail(id, "bad_request", "'op' must be a string");
                return;
            }
            string op = opEl.GetString()!;
            try { Send(id, true, Dispatch(op, new Params(root))); }
            catch (HandsException e) { Fail(id, e.Code, e.Message); }
            catch (Exception e) { Fail(id, "internal", e.Message); }
        }
    }

    // MTA on purpose: UI Automation clients are meant to run off an STA/UI thread.
    private static int Main(string[] args)
    {
        Native.SetProcessDpiAwarenessContext(Native.DPI_PER_MONITOR_V2);
        var utf8 = new UTF8Encoding(false);
        _out = new StreamWriter(Console.OpenStandardOutput(), utf8, 1 << 16) { AutoFlush = false, NewLine = "\n" };

        // `hormes-hands --permissions`: print the grants and exit.
        if (Array.IndexOf(args, "--permissions") >= 0)
        {
            _out.Write(JsonSerializer.Serialize(Permissions(), JsonOpts));
            _out.Write('\n');
            _out.Flush();
            return 0;
        }

        if (Environment.GetEnvironmentVariable("HORMES_HANDS_DEBUG") == "1")
            Console.Error.WriteLine($"[hormes-hands] ready pid={Environment.ProcessId} version={Version}");

        using var reader = new StreamReader(Console.OpenStandardInput(), utf8, false, 1 << 16);
        string? line;
        while ((line = reader.ReadLine()) is not null) HandleLine(line);
        return 0;
    }
}

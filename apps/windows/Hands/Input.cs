using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using static Hormes.Hands.Native;

namespace Hormes.Hands;

/// <summary>Mouse and keyboard through SendInput, with the user-hands and front-app guards of the Mac helper.</summary>
internal static class Input
{
    /// <summary>User's key/click/scroll within this many ms holds an acting op back (the Mac helper's quiet window).</summary>
    private const double QuietMs = 700;
    private const double NoneMs = 1e12;
    private static uint _ownTick;          // GetLastInputInfo.dwTime right after our own last post
    private static bool _ownPosted;

    // ------------------------------------------------------------------ idle / ledger

    private static uint LastInputTick()
    {
        var li = new LASTINPUTINFO { cbSize = (uint)Marshal.SizeOf<LASTINPUTINFO>() };
        return GetLastInputInfo(ref li) ? li.dwTime : 0;
    }

    private static double SinceMs(uint tick) => tick == 0 ? NoneMs : unchecked((uint)(GetTickCount() - tick));

    /// <summary>
    /// Input the OS saw that this helper did not post: GetLastInputInfo moves for our own SendInput too, so an input is
    /// foreign only when its tick differs from the one we recorded right after our last post.
    /// </summary>
    private static double? ForeignMs()
    {
        uint tick = LastInputTick();
        if (tick == 0) return null;
        if (_ownPosted && tick == _ownTick) return null;
        return SinceMs(tick);
    }

    private static void NotePost()
    {
        _ownTick = LastInputTick();
        _ownPosted = true;
    }

    public static Dictionary<string, object?> OpUserIdle()
    {
        // GetLastInputInfo does not say which kind of input it was: every kind reads the same.
        double any = SinceMs(LastInputTick());
        return new Dictionary<string, object?>
        {
            ["keyMs"] = any, ["clickMs"] = any, ["scrollMs"] = any, ["moveMs"] = any,
            ["foreignMs"] = ForeignMs() ?? NoneMs,
        };
    }

    /// <summary>The two refusals every acting op makes before its first post: the user's hands (unless ownDriver), then the front app.</summary>
    public static void GuardActing(Params p, bool busyCheck = true)
    {
        if (busyCheck && p.Bool("ownDriver") != true)
        {
            var ms = ForeignMs();
            if (ms is not null && ms.Value < QuietMs)
                throw new HandsException("busy", $"the user used the keyboard/mouse {(long)ms.Value} ms ago; nothing was posted");
        }
        RequireFront(p);
    }

    public static void RequireFront(Params p)
    {
        var expect = p.Object("expectFront");
        if (expect is null) return;
        RequireFront(expect.RequireInt("pid"));
    }

    public static void RequireFront(int pid)
    {
        var front = Windows.Foreground();
        if (front is not null && front.Value.Pid == pid) return;
        string name = front is null ? "nothing" : $"{Windows.AppName(front.Value.Pid)} (pid {front.Value.Pid})";
        throw new HandsException("focus_moved", $"the front app is {name}, not pid {pid}; nothing was posted");
    }

    // ------------------------------------------------------------------ SendInput

    private static void Send(params INPUT[] inputs)
    {
        if (inputs.Length == 0) return;
        uint sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<INPUT>());
        NotePost();
        if (sent != inputs.Length)
            throw HandsException.Internal("SendInput was blocked (the target window may run elevated, or the desktop is locked)");
    }

    private static INPUT Mouse(uint flags, int data = 0) =>
        new() { type = INPUT_MOUSE, u = new INPUTUNION { mi = new MOUSEINPUT { dwFlags = flags, mouseData = unchecked((uint)data) } } };

    private static INPUT Key(ushort vk, bool up, bool extended = false) =>
        new()
        {
            type = INPUT_KEYBOARD,
            u = new INPUTUNION { ki = new KEYBDINPUT { wVk = vk, dwFlags = (up ? KEYEVENTF_KEYUP : 0) | (extended ? KEYEVENTF_EXTENDEDKEY : 0) } },
        };

    private static INPUT Unicode(ushort unit, bool up) =>
        new() { type = INPUT_KEYBOARD, u = new INPUTUNION { ki = new KEYBDINPUT { wVk = 0, wScan = unit, dwFlags = KEYEVENTF_UNICODE | (up ? KEYEVENTF_KEYUP : 0) } } };

    private static void MoveTo((double X, double Y) pt)
    {
        SetCursorPos((int)Math.Round(pt.X), (int)Math.Round(pt.Y));
        NotePost();
    }

    // ------------------------------------------------------------------ mouse ops

    private sealed record Button(string Name, uint Down, uint Up);

    private static Button ParseButton(string? name) => (name ?? "left").ToLowerInvariant() switch
    {
        "left" => new Button("left", MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP),
        "right" => new Button("right", MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP),
        "middle" or "center" => new Button("middle", MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP),
        var other => throw HandsException.BadRequest($"unknown button '{other}'"),
    };

    private static List<ushort> Modifiers(Params p)
    {
        var list = new List<ushort>();
        foreach (var m in p.StringArray("modifiers") ?? new List<string>())
        {
            var ks = Keys.Parse(m);
            if (ks.Vk is { } vk && ks.Modifiers.Count == 0) { if (!list.Contains(vk)) list.Add(vk); }
            else throw HandsException.BadRequest($"unknown modifier '{m}'");
        }
        return list;
    }

    private static void Hold(List<ushort> mods, Action body)
    {
        foreach (var m in mods) Send(Key(m, false));
        try { body(); }
        finally { foreach (var m in Enumerable.Reverse(mods)) Send(Key(m, true)); }
    }

    public static Dictionary<string, object?> OpMove(Params p)
    {
        var pt = p.RequireXY();
        GuardActing(p);
        MoveTo(pt);
        return Json.Point(pt.X, pt.Y);
    }

    public static Dictionary<string, object?> OpClick(Params p)
    {
        var button = ParseButton(p.String("button"));
        int count = p.Int("count") ?? 1;
        if (count is < 1 or > 3) throw HandsException.BadRequest("'count' must be 1, 2 or 3");
        var mods = Modifiers(p);
        GuardActing(p);
        var (cx, cy) = Screen.CursorLocation();
        (double X, double Y) point = (cx, cy);
        if (p.OptionalXY() is { } target) { point = target; MoveTo(point); Thread.Sleep(12); }
        Hold(mods, () =>
        {
            for (int i = 1; i <= count; i++)
            {
                if (i > 1) Thread.Sleep(60);
                Send(Mouse(button.Down));
                Thread.Sleep(8);
                Send(Mouse(button.Up));
            }
        });
        return new Dictionary<string, object?> { ["x"] = point.X, ["y"] = point.Y, ["button"] = button.Name, ["count"] = count };
    }

    public static Dictionary<string, object?> OpMouseDown(Params p)
    {
        var button = ParseButton(p.String("button"));
        var mods = Modifiers(p);
        GuardActing(p);
        foreach (var m in mods) Send(Key(m, false));
        Send(Mouse(button.Down));
        var (x, y) = Screen.CursorLocation();
        return new Dictionary<string, object?> { ["x"] = (double)x, ["y"] = (double)y, ["button"] = button.Name };
    }

    public static Dictionary<string, object?> OpMouseUp(Params p)
    {
        var button = ParseButton(p.String("button"));
        var mods = Modifiers(p);
        GuardActing(p);
        Send(Mouse(button.Up));
        foreach (var m in Enumerable.Reverse(mods)) Send(Key(m, true));
        var (x, y) = Screen.CursorLocation();
        return new Dictionary<string, object?> { ["x"] = (double)x, ["y"] = (double)y, ["button"] = button.Name };
    }

    public static Dictionary<string, object?> OpDrag(Params p)
    {
        var from = p.Point("from");
        var to = p.Point("to");
        var button = ParseButton(p.String("button"));
        var mods = Modifiers(p);
        int duration = p.Int("durationMs") ?? 300;
        if (duration is < 0 or > 10_000) throw HandsException.BadRequest("'durationMs' must be 0...10000");
        GuardActing(p);
        MoveTo(from);
        Thread.Sleep(30);
        Hold(mods, () =>
        {
            Send(Mouse(button.Down));
            Thread.Sleep(40);
            int steps = Math.Max(2, Math.Min(60, duration / 8));
            for (int i = 1; i <= steps; i++)
            {
                double t = (double)i / steps;
                MoveTo((from.X + (to.X - from.X) * t, from.Y + (to.Y - from.Y) * t));
                Thread.Sleep(Math.Max(1, duration / steps));
            }
            Thread.Sleep(30);
            Send(Mouse(button.Up));
        });
        return new Dictionary<string, object?>
        {
            ["from"] = Json.Point(from.X, from.Y), ["to"] = Json.Point(to.X, to.Y), ["button"] = button.Name, ["durationMs"] = duration,
        };
    }

    /// <summary>`dy` positive = content scrolls up (the Mac convention, and the wheel's); `dx` positive = content scrolls left, the wheel's opposite.
    /// The client sends 60 "pixels" per click: 120 wheel units per click here.</summary>
    public static Dictionary<string, object?> OpScroll(Params p)
    {
        if (!p.Has("dx") && !p.Has("dy")) throw HandsException.BadRequest("'dx' or 'dy' is required");
        double dx = p.Double("dx") ?? 0, dy = p.Double("dy") ?? 0;
        var mods = Modifiers(p);
        GuardActing(p);
        if (p.OptionalXY() is { } target) { MoveTo(target); Thread.Sleep(8); }
        int wy = (int)Math.Clamp(Math.Round(dy * 2), -100000, 100000);
        int wx = (int)Math.Clamp(Math.Round(-dx * 2), -100000, 100000);
        Hold(mods, () =>
        {
            if (wy != 0) Send(Mouse(MOUSEEVENTF_WHEEL, wy));
            if (wx != 0) Send(Mouse(MOUSEEVENTF_HWHEEL, wx));
        });
        return new Dictionary<string, object?> { ["dx"] = dx, ["dy"] = dy };
    }

    // ------------------------------------------------------------------ keys

    private static void PostStroke(KeyStroke s, int holdMs = 0)
    {
        Hold(s.Modifiers, () =>
        {
            if (s.Vk is { } vk)
            {
                Send(Key(vk, false, s.Extended));
                if (holdMs > 0) Thread.Sleep(holdMs);
                Send(Key(vk, true, s.Extended));
            }
            else if (s.Unicode is { } u)
            {
                foreach (char c in u) Send(Unicode(c, false), Unicode(c, true));
                if (holdMs > 0) Thread.Sleep(holdMs);
            }
        });
    }

    public static Dictionary<string, object?> OpKey(Params p)
    {
        string combo = p.RequireString("combo");
        int repeat = p.Int("repeat") ?? 1;
        if (repeat is < 1 or > 100) throw HandsException.BadRequest("'repeat' must be 1...100");
        var stroke = Keys.Parse(combo);
        GuardActing(p);
        for (int i = 0; i < repeat; i++)
        {
            if (i > 0) Thread.Sleep(30);
            PostStroke(stroke);
        }
        return new Dictionary<string, object?> { ["combo"] = combo, ["repeat"] = repeat };
    }

    public static Dictionary<string, object?> OpHoldKey(Params p)
    {
        string combo = p.RequireString("combo");
        int duration = p.RequireInt("durationMs");
        if (duration is < 0 or > 10_000) throw HandsException.BadRequest("'durationMs' must be 0...10000");
        var stroke = Keys.Parse(combo);
        GuardActing(p);
        PostStroke(stroke, duration);
        return new Dictionary<string, object?> { ["combo"] = combo, ["durationMs"] = duration };
    }

    // ------------------------------------------------------------------ type

    /// <summary>Text elements the way the client counts them: a line break or tab is one, a grapheme cluster is one.</summary>
    private static List<string> Graphemes(string text)
    {
        var list = new List<string>();
        var e = StringInfo.GetTextElementEnumerator(text.Replace("\r\n", "\n").Replace('\r', '\n'));
        while (e.MoveNext()) list.Add((string)e.Current);
        return list;
    }

    private static void TypeElement(string g)
    {
        if (g == "\n") PostStroke(new KeyStroke(new List<ushort>(), 0x0D, false, null));
        else if (g == "\t") PostStroke(new KeyStroke(new List<ushort>(), 0x09, false, null));
        else
        {
            var inputs = new List<INPUT>();
            foreach (char c in g) { inputs.Add(Unicode(c, false)); inputs.Add(Unicode(c, true)); }
            Send(inputs.ToArray());
        }
    }

    public static Dictionary<string, object?> OpType(Params p)
    {
        string text = p.RequireString("text");
        int delay = p.Int("delayMs") ?? 3;
        if (delay is < 0 or > 1000) throw HandsException.BadRequest("'delayMs' must be 0...1000");
        string strategy = p.String("strategy") ?? "auto";
        if (strategy is not ("auto" or "ax" or "keystrokes" or "paste"))
            throw HandsException.BadRequest("'strategy' must be auto, ax, keystrokes or paste");
        var graphemes = Graphemes(text);
        int total = graphemes.Count;
        GuardActing(p);
        int? expectPid = p.Object("expectFront")?.RequireInt("pid");
        bool ownDriver = p.Bool("ownDriver") == true;

        var el = Uia.Focused();
        if (el is not null && Uia.IsSecure(el)) throw HandsException.BadRequest("the focused field is a password field; User types secrets himself");
        string? field = el is null ? null : Uia.FieldLabel(el);

        // 1. Accessibility: set the field's value through UI Automation. A set replaces the whole value, so auto
        //    uses it only on an empty field (where replacing is inserting); "ax" insists, and appends.
        if (el is not null && (strategy == "auto" || strategy == "ax"))
        {
            string? before = Uia.ReadText(el, 100_000);
            if (before is not null && (strategy == "ax" || before.Length == 0) && Uia.CanSetValue(el))
            {
                string normalized = string.Concat(graphemes);
                if (Uia.TrySetValue(el, before + normalized))
                {
                    string? after = Uia.ReadText(el, 100_000);
                    if (after is not null && after.Replace("\r\n", "\n") == (before + normalized).Replace("\r\n", "\n"))
                        return Result(total, total, 1, "ax", 1, true, field);
                    if (strategy == "ax") return Result(total, total, 1, "ax", 1, false, field);
                    if (after is not null) Uia.TrySetValue(el, before);   // took the text but not as given: put it back, type instead
                }
                else if (strategy == "ax") throw HandsException.Internal("the focused field does not accept a value through accessibility");
            }
            else if (strategy == "ax") throw HandsException.Internal("the focused field does not accept a value through accessibility");
        }

        // 2. Keystrokes (also "paste": Windows types Unicode units directly rather than going through the clipboard).
        string? start = el is null ? null : Uia.ReadText(el, 100_000);
        int landed = 0, events = 0;
        string? cancelReason = null;
        foreach (var g in graphemes)
        {
            if (landed % 8 == 0 && landed > 0)
            {
                // The place the keystrokes land moved to another app, or User used his hands.
                if (expectPid is { } pid && Windows.Foreground()?.Pid != pid) { cancelReason = "focus_moved"; break; }
                if (!ownDriver && ForeignMs() is { } ms && ms < 150) { cancelReason = "busy"; break; }
            }
            TypeElement(g);
            events += g.Length * 2;
            landed++;
            if (delay > 0) Thread.Sleep(delay);
        }
        if (cancelReason is not null)
            return new Dictionary<string, object?>
            {
                ["characters"] = landed, ["total"] = total, ["events"] = events, ["via"] = "keystrokes", ["attempts"] = 1,
                ["cancelled"] = true, ["reason"] = cancelReason, ["field"] = field,
            };

        bool? verified = null;
        if (el is not null)
        {
            Thread.Sleep(30);
            string? after = Uia.ReadText(el, 100_000);
            verified = after is not null && start is not null && after.Replace("\r\n", "\n").Length >= start.Replace("\r\n", "\n").Length && after.Replace("\r\n", "\n").Contains(text.Replace("\r\n", "\n").Replace('\r', '\n'));
            if (after is null) verified = false;
        }
        return Result(total, total, events, "keystrokes", 1, verified, field);
    }

    private static Dictionary<string, object?> Result(int characters, int total, int events, string via, int attempts, bool? verified, string? field)
    {
        var r = new Dictionary<string, object?>
        {
            ["characters"] = characters, ["total"] = total, ["events"] = events, ["via"] = via, ["attempts"] = attempts, ["field"] = field,
        };
        if (verified is not null) r["verified"] = verified;
        return r;
    }
}

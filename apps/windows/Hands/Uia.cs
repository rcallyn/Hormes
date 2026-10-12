using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Windows;
using System.Windows.Automation;
using static Hormes.Hands.Native;

namespace Hormes.Hands;

/// <summary>Accessibility through UI Automation, reported in the Mac helper's AX vocabulary (AXButton, AXTextField, ...).</summary>
internal static class Uia
{
    // ------------------------------------------------------------------ roles

    private static readonly Dictionary<string, string> Roles = new()
    {
        ["Button"] = "AXButton", ["Calendar"] = "AXGroup", ["CheckBox"] = "AXCheckBox", ["ComboBox"] = "AXComboBox",
        ["Custom"] = "AXGroup", ["DataGrid"] = "AXTable", ["DataItem"] = "AXRow", ["Document"] = "AXTextArea", ["Edit"] = "AXTextField",
        ["Group"] = "AXGroup", ["Header"] = "AXGroup", ["HeaderItem"] = "AXColumn", ["Hyperlink"] = "AXLink", ["Image"] = "AXImage",
        ["List"] = "AXList", ["ListItem"] = "AXRow", ["Menu"] = "AXMenu", ["MenuBar"] = "AXMenuBar", ["MenuItem"] = "AXMenuItem",
        ["Pane"] = "AXGroup", ["ProgressBar"] = "AXProgressIndicator", ["RadioButton"] = "AXRadioButton", ["ScrollBar"] = "AXScrollBar",
        ["Separator"] = "AXSplitter", ["Slider"] = "AXSlider", ["Spinner"] = "AXIncrementor", ["SplitButton"] = "AXMenuButton",
        ["StatusBar"] = "AXGroup", ["Tab"] = "AXTabGroup", ["TabItem"] = "AXTab", ["Table"] = "AXTable", ["Text"] = "AXStaticText",
        ["Thumb"] = "AXHandle", ["TitleBar"] = "AXGroup", ["ToolBar"] = "AXToolbar", ["ToolTip"] = "AXHelpTag", ["Tree"] = "AXOutline",
        ["TreeItem"] = "AXRow", ["Window"] = "AXWindow", ["AppBar"] = "AXToolbar", ["SemanticZoom"] = "AXGroup",
    };

    public static string RoleOf(ControlType? t)
    {
        if (t is null) return "AXUnknown";
        string key = t.ProgrammaticName.Replace("ControlType.", "");
        return Roles.TryGetValue(key, out var r) ? r : "AXUnknown";
    }

    private static T? Safe<T>(Func<T> f, T? fallback = default)
    {
        try { return f(); } catch { return fallback; }
    }

    private static string RoleOf(AutomationElement e, out string? subrole)
    {
        string role = RoleOf(Safe(() => e.Current.ControlType));
        subrole = null;
        if (role == "AXTextField" && Safe(() => e.Current.IsPassword)) subrole = "AXSecureTextField";
        return role;
    }

    public static bool IsSecure(AutomationElement e) => Safe(() => e.Current.IsPassword);

    // ------------------------------------------------------------------ focus and text

    public static AutomationElement? Focused() => Safe(() => AutomationElement.FocusedElement);

    public static string? ReadText(AutomationElement e, int limit)
    {
        try
        {
            if (e.TryGetCurrentPattern(ValuePattern.Pattern, out var vp))
            {
                var v = ((ValuePattern)vp).Current.Value;
                // RichEdit controls (Windows 11 Notepad) answer an empty Value and keep their text in TextPattern.
                if (!string.IsNullOrEmpty(v)) return v.Length > limit ? v[..limit] : v;
            }
        }
        catch { }
        try
        {
            if (e.TryGetCurrentPattern(TextPattern.Pattern, out var tp))
            {
                var t = ((TextPattern)tp).DocumentRange.GetText(limit);
                return t;
            }
        }
        catch { }
        return null;
    }

    public static bool CanSetValue(AutomationElement e)
    {
        try { return e.TryGetCurrentPattern(ValuePattern.Pattern, out var vp) && !((ValuePattern)vp).Current.IsReadOnly; }
        catch { return false; }
    }

    public static bool TrySetValue(AutomationElement e, string value)
    {
        try
        {
            if (!e.TryGetCurrentPattern(ValuePattern.Pattern, out var vp)) return false;
            ((ValuePattern)vp).SetValue(value);
            return true;
        }
        catch { return false; }
    }

    private static string? SelectedText(AutomationElement e, int limit)
    {
        try
        {
            if (e.TryGetCurrentPattern(TextPattern.Pattern, out var tp))
            {
                var sel = ((TextPattern)tp).GetSelection();
                if (sel.Length > 0) return sel[0].GetText(limit);
            }
        }
        catch { }
        return null;
    }

    private static string? AppOf(AutomationElement e)
    {
        int pid = Safe(() => e.Current.ProcessId);
        return pid > 0 ? Windows.AppName(pid) : null;
    }

    private static object? FrameOf(AutomationElement e)
    {
        var r = Safe(() => e.Current.BoundingRectangle);
        return r.IsEmpty || double.IsInfinity(r.X) ? null : Json.Rect(r.X, r.Y, r.Width, r.Height);
    }

    public static string? FieldLabel(AutomationElement e)
    {
        string name = Safe(() => e.Current.Name) ?? "";
        string? app = AppOf(e);
        string kind = RoleOf(e, out _) == "AXTextArea" ? "text area" : "field";
        if (name.Length > 0 && app is not null) return $"the {name} {kind} in {app}";
        if (app is not null) return $"the {kind} in {app}";
        return null;
    }

    public static Dictionary<string, object?> OpFocusedText()
    {
        var e = Focused() ?? throw HandsException.NotFound("nothing has keyboard focus");
        bool secure = IsSecure(e);
        string role = RoleOf(e, out var subrole);
        string? name = Safe(() => e.Current.Name);
        return new Dictionary<string, object?>
        {
            ["role"] = role,
            ["subrole"] = subrole,
            ["title"] = string.IsNullOrEmpty(name) ? null : name,
            ["value"] = secure ? null : ReadText(e, 4000),
            ["selectedText"] = secure ? null : SelectedText(e, 4000),
            ["secure"] = secure,
            ["app"] = AppOf(e),
            ["frame"] = FrameOf(e),
            ["config"] = Screen.ConfigHash(),
            ["locked"] = false,
        };
    }

    public static Dictionary<string, object?> OpElementAt(Params p)
    {
        var (x, y) = p.RequireXY();
        AutomationElement? e = Safe(() => AutomationElement.FromPoint(new System.Windows.Point(x, y)));
        if (e is null) throw HandsException.NotFound($"no element at {x},{y}");
        string role = RoleOf(e, out var subrole);
        string? name = Safe(() => e.Current.Name), help = Safe(() => e.Current.HelpText);
        return new Dictionary<string, object?>
        {
            ["role"] = role,
            ["subrole"] = subrole,
            ["title"] = string.IsNullOrEmpty(name) ? null : name,
            ["description"] = string.IsNullOrEmpty(help) ? null : help,
            ["value"] = IsSecure(e) ? null : ReadText(e, 400),
            ["frame"] = FrameOf(e),
            ["app"] = AppOf(e),
            ["config"] = Screen.ConfigHash(),
            ["locked"] = false,
        };
    }

    // ------------------------------------------------------------------ tree

    private sealed class Node
    {
        public int I, Depth;
        public string Role = "", Title = "", Value = "";
        public string? Subrole, Description;
        public double X, Y, W, H;
        public bool HasFrame, Pressable, TextInput;

        public IEnumerable<string> Labels()
        {
            if (Title.Length > 0) yield return Title;
            if (Description is { Length: > 0 }) yield return Description;
            if (Value.Length > 0 && Value.Length <= 60 && !TextInput) yield return Value;
        }

        public Dictionary<string, object?> ToJson()
        {
            var o = new Dictionary<string, object?> { ["i"] = I, ["depth"] = Depth, ["role"] = Role };
            if (Subrole is not null) o["subrole"] = Subrole;
            if (Title.Length > 0) o["title"] = Title;
            if (Description is { Length: > 0 }) o["description"] = Description;
            if (Value.Length > 0) o["value"] = Value;
            if (HasFrame) { o["x"] = X; o["y"] = Y; o["w"] = W; o["h"] = H; }
            if (Pressable) o["pressable"] = true;
            return o;
        }
    }

    private sealed class Snapshot
    {
        public IntPtr Hwnd;
        public int Pid;
        public string App = "", Window = "";
        public List<Node> Nodes = new();
        public DateTime BuiltAt;
        public double BuildMs;
        public bool Truncated;
    }

    private static Snapshot? _cache;

    private static IntPtr TargetWindow(string? app)
    {
        if (string.IsNullOrEmpty(app))
        {
            var h = GetForegroundWindow();
            if (h == IntPtr.Zero) throw HandsException.NotFound("no foreground window");
            return h;
        }
        var w = Windows.Enumerate().FirstOrDefault(x => Windows.Matches(x.Pid, app));
        if (w is null) throw HandsException.NotFound($"no window for application {app}");
        return new IntPtr(w.Id);
    }

    private static Snapshot Current(double maxAgeMs, int maxNodes, int maxDepth, double maxMs, string? app, out bool cached)
    {
        var hwnd = TargetWindow(app);
        if (_cache is { } c && c.Hwnd == hwnd && (DateTime.UtcNow - c.BuiltAt).TotalMilliseconds <= maxAgeMs)
        {
            cached = true;
            return c;
        }
        cached = false;
        var snap = Build(hwnd, maxNodes, maxDepth, maxMs);
        _cache = snap;
        return snap;
    }

    private static CacheRequest MakeCache()
    {
        var cr = new CacheRequest { TreeScope = TreeScope.Element };
        foreach (var prop in new[]
        {
            AutomationElement.NameProperty, AutomationElement.ControlTypeProperty, AutomationElement.BoundingRectangleProperty,
            AutomationElement.IsOffscreenProperty, AutomationElement.IsPasswordProperty, AutomationElement.HelpTextProperty,
            AutomationElement.IsInvokePatternAvailableProperty, AutomationElement.IsTogglePatternAvailableProperty,
            AutomationElement.IsSelectionItemPatternAvailableProperty, AutomationElement.IsExpandCollapsePatternAvailableProperty,
            AutomationElement.IsValuePatternAvailableProperty,
        }) cr.Add(prop);
        return cr;
    }

    /// <summary>Depth-first walk of the window's control view, bounded by time and node count; `Truncated` says a bound cut it.</summary>
    private static Snapshot Build(IntPtr hwnd, int maxNodes, int maxDepth, double maxMs)
    {
        var sw = Stopwatch.StartNew();
        int pid = Windows.OwnerPid(hwnd);
        var snap = new Snapshot { Hwnd = hwnd, Pid = pid, App = Windows.AppName(pid), Window = WindowTitle(hwnd), BuiltAt = DateTime.UtcNow };
        var cr = MakeCache();
        var walker = TreeWalker.ControlViewWalker;
        using (cr.Activate())
        {
            AutomationElement root;
            try { root = AutomationElement.FromHandle(hwnd); }   // fetched under the active request, so it is cached like its children
            catch (Exception e) { throw HandsException.Internal($"UI Automation could not open the window: {e.Message}"); }
            void Visit(AutomationElement e, int depth)
            {
                if (snap.Truncated) return;
                if (snap.Nodes.Count >= maxNodes || sw.Elapsed.TotalMilliseconds > maxMs) { snap.Truncated = true; return; }
                snap.Nodes.Add(Describe(e, snap.Nodes.Count, depth));
                if (depth >= maxDepth) return;
                AutomationElement? child = Safe(() => walker.GetFirstChild(e, cr));
                while (child is not null)
                {
                    Visit(child, depth + 1);
                    if (snap.Truncated) return;
                    child = Safe(() => walker.GetNextSibling(child, cr));
                }
            }
            Visit(root, 0);
        }
        snap.BuildMs = sw.Elapsed.TotalMilliseconds;
        return snap;
    }

    private static Node Describe(AutomationElement e, int index, int depth)
    {
        // Every property read inside one guard: an AutomationElementInformation getter throws when its value was not cached.
        string role = "AXUnknown", name = "", help = ""; bool password = false; System.Windows.Rect r = System.Windows.Rect.Empty;
        try
        {
            var cur = e.Cached;
            role = RoleOf(cur.ControlType); name = cur.Name ?? ""; help = cur.HelpText ?? ""; password = cur.IsPassword; r = cur.BoundingRectangle;
        }
        catch
        {
            try
            {
                var cur = e.Current;
                role = RoleOf(cur.ControlType); name = cur.Name ?? ""; help = cur.HelpText ?? ""; password = cur.IsPassword; r = cur.BoundingRectangle;
            }
            catch { }
        }
        string? subrole = role == "AXTextField" && password ? "AXSecureTextField" : null;
        var n = new Node { I = index, Depth = depth, Role = role, Subrole = subrole };
        {
            n.Title = name;
            n.Description = string.IsNullOrEmpty(help) ? null : help;
            if (!r.IsEmpty && !double.IsInfinity(r.X) && !double.IsInfinity(r.Width))
            {
                n.HasFrame = true; n.X = r.X; n.Y = r.Y; n.W = r.Width; n.H = r.Height;
            }
            n.TextInput = role is "AXTextField" or "AXTextArea" or "AXComboBox";
            n.Pressable = Safe(() => (bool)e.GetCachedPropertyValue(AutomationElement.IsInvokePatternAvailableProperty)) ||
                          Safe(() => (bool)e.GetCachedPropertyValue(AutomationElement.IsTogglePatternAvailableProperty)) ||
                          Safe(() => (bool)e.GetCachedPropertyValue(AutomationElement.IsSelectionItemPatternAvailableProperty)) ||
                          Safe(() => (bool)e.GetCachedPropertyValue(AutomationElement.IsExpandCollapsePatternAvailableProperty));
        }
        if (n.TextInput && subrole is null)
        {
            // Values are read only for fields (a pattern call per node would blow the time bound).
            try { n.Value = ReadText(e, 400) ?? ""; } catch { }
        }
        else if (role == "AXStaticText" && n.Value.Length == 0 && n.Title.Length > 0) { n.Value = n.Title.Length <= 400 ? n.Title : n.Title[..400]; }
        return n;
    }

    public static Dictionary<string, object?> OpAxTree(Params p)
    {
        double maxAge = p.Double("maxAgeMs") ?? 500;
        bool summary = p.Bool("summary") ?? false;
        var snap = Current(maxAge, p.Int("maxNodes") ?? 1500, p.Int("maxDepth") ?? 14, p.Double("maxMs") ?? 250, p.String("app"), out bool cached);
        var o = new Dictionary<string, object?>
        {
            ["app"] = snap.App, ["pid"] = snap.Pid, ["window"] = snap.Window, ["count"] = snap.Nodes.Count, ["cached"] = cached,
            ["ageMs"] = (DateTime.UtcNow - snap.BuiltAt).TotalMilliseconds, ["treeMs"] = snap.BuildMs, ["truncated"] = snap.Truncated,
        };
        if (!summary) o["nodes"] = snap.Nodes.Select(n => (object?)n.ToJson()).ToList();
        return o;
    }

    // ------------------------------------------------------------------ find_element

    private static string Norm(string s) => string.Join(' ', s.ToLowerInvariant().Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));

    private static double Similarity(string a, string b)
    {
        if (a.Length == 0 || b.Length == 0) return 0;
        var prev = new int[b.Length + 1];
        var cur = new int[b.Length + 1];
        for (int j = 0; j <= b.Length; j++) prev[j] = j;
        for (int i = 1; i <= a.Length; i++)
        {
            cur[0] = i;
            for (int j = 1; j <= b.Length; j++)
                cur[j] = Math.Min(Math.Min(cur[j - 1] + 1, prev[j] + 1), prev[j - 1] + (a[i - 1] == b[j - 1] ? 0 : 1));
            (prev, cur) = (cur, prev);
        }
        return 1.0 - (double)prev[b.Length] / Math.Max(a.Length, b.Length);
    }

    private static string RoleKey(string r) => (r.StartsWith("AX", StringComparison.OrdinalIgnoreCase) ? r[2..] : r).ToLowerInvariant();

    public static Dictionary<string, object?> OpFindElement(Params p)
    {
        var sw = Stopwatch.StartNew();
        string name = p.RequireString("name");
        string? role = p.String("role");
        double maxAge = p.Double("maxAgeMs") ?? 500, threshold = p.Double("threshold") ?? 0.85;
        var snap = Current(maxAge, p.Int("maxNodes") ?? 1500, p.Int("maxDepth") ?? 14, p.Double("maxMs") ?? 250, p.String("app"), out bool cached);
        string want = Norm(name);
        var exact = new List<(Node N, double S, string L)>();
        var contains = new List<(Node N, double S, string L)>();
        var fuzzy = new List<(Node N, double S, string L)>();
        foreach (var n in snap.Nodes)
        {
            if (role is not null && RoleKey(n.Role) != RoleKey(role)) continue;
            (Node, double, string)? bestExact = null, bestContains = null, bestFuzzy = null;
            foreach (var label in n.Labels())
            {
                string l = Norm(label);
                if (l.Length == 0) continue;
                if (l == want) { bestExact = (n, 1.0, label); break; }
                if (l.Contains(want) && want.Length >= 2) bestContains ??= (n, 0.9, label);
                else
                {
                    double s = Similarity(l, want);
                    if (s >= threshold && (bestFuzzy is null || s > bestFuzzy.Value.Item2)) bestFuzzy = (n, s, label);
                }
            }
            if (bestExact is { } be) exact.Add(be);
            else if (bestContains is { } bc) contains.Add(bc);
            else if (bestFuzzy is { } bf) fuzzy.Add(bf);
        }
        List<(Node N, double S, string L)> Dedupe(List<(Node N, double S, string L)> list)
        {
            var outList = new List<(Node N, double S, string L)>();
            foreach (var m in list.OrderByDescending(x => x.S))
            {
                if (m.N.HasFrame && outList.Any(o => o.N.HasFrame && Math.Abs(o.N.X + o.N.W / 2 - (m.N.X + m.N.W / 2)) < 2 && Math.Abs(o.N.Y + o.N.H / 2 - (m.N.Y + m.N.H / 2)) < 2)) continue;
                outList.Add(m);
            }
            return outList;
        }
        string tier = "none";
        List<(Node N, double S, string L)> matches;
        if (Dedupe(exact) is { Count: > 0 } e1) { matches = e1; tier = "exact"; }
        else if (Dedupe(contains) is { Count: > 0 } e2) { matches = e2; tier = "contains"; }
        else { matches = Dedupe(fuzzy); tier = matches.Count == 0 ? "none" : "fuzzy"; }

        Dictionary<string, object?> NodeJson((Node N, double S, string L) m)
        {
            var o = m.N.ToJson();
            o["app"] = snap.App;
            o["score"] = m.S;
            o["label"] = m.L;
            if (m.N.HasFrame) o["center"] = Json.Point(m.N.X + m.N.W / 2, m.N.Y + m.N.H / 2);
            return o;
        }
        var result = new Dictionary<string, object?>
        {
            ["app"] = snap.App, ["window"] = snap.Window, ["found"] = matches.Count > 0, ["unique"] = matches.Count == 1,
            ["candidates"] = matches.Count, ["tier"] = tier, ["cached"] = cached, ["treeMs"] = snap.BuildMs,
            ["nodes"] = snap.Nodes.Count, ["truncated"] = snap.Truncated, ["ms"] = sw.Elapsed.TotalMilliseconds,
        };
        if (matches.Count > 0) result["element"] = NodeJson(matches[0]);
        if (matches.Count > 1) result["others"] = matches.Skip(1).Take(5).Select(m => (object?)NodeJson(m)).ToList();
        return result;
    }
}

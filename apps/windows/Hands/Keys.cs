using System;
using System.Collections.Generic;
using System.Linq;
using static Hormes.Hands.Native;

namespace Hormes.Hands;

/// <summary>A parsed combo: modifier virtual keys held around one final key (a VK, or a character sent as Unicode).</summary>
internal sealed record KeyStroke(List<ushort> Modifiers, ushort? Vk, bool Extended, string? Unicode);

internal static class Keys
{
    private const ushort Ctrl = 0x11, Alt = 0x12, Shift = 0x10, Win = 0x5B;

    // The macOS names the brain writes map to their Windows counterparts: cmd -> Ctrl, option -> Alt.
    private static readonly Dictionary<string, ushort> ModifierNames = new(StringComparer.OrdinalIgnoreCase)
    {
        ["cmd"] = Ctrl, ["command"] = Ctrl, ["meta"] = Ctrl, ["meta_l"] = Ctrl, ["meta_r"] = Ctrl,
        ["ctrl"] = Ctrl, ["control"] = Ctrl, ["control_l"] = Ctrl, ["control_r"] = Ctrl,
        ["alt"] = Alt, ["option"] = Alt, ["alt_l"] = Alt, ["alt_r"] = Alt,
        ["shift"] = Shift, ["shift_l"] = Shift, ["shift_r"] = Shift,
        ["super"] = Win, ["super_l"] = Win, ["super_r"] = Win, ["win"] = Win, ["windows"] = Win,
        ["fn"] = 0, ["function"] = 0,
    };

    private static readonly Dictionary<string, (ushort Vk, bool Ext)> Named = new(StringComparer.OrdinalIgnoreCase)
    {
        ["return"] = (0x0D, false), ["enter"] = (0x0D, false), ["kp_enter"] = (0x0D, false), ["tab"] = (0x09, false), ["space"] = (0x20, false),
        ["escape"] = (0x1B, false), ["esc"] = (0x1B, false), ["backspace"] = (0x08, false), ["delete"] = (0x2E, true),
        ["forwarddelete"] = (0x2E, true), ["forward_delete"] = (0x2E, true), ["kp_delete"] = (0x2E, true), ["insert"] = (0x2D, true),
        ["up"] = (0x26, true), ["down"] = (0x28, true), ["left"] = (0x25, true), ["right"] = (0x27, true),
        ["home"] = (0x24, true), ["end"] = (0x23, true), ["page_up"] = (0x21, true), ["pageup"] = (0x21, true), ["prior"] = (0x21, true),
        ["page_down"] = (0x22, true), ["pagedown"] = (0x22, true), ["next"] = (0x22, true),
        ["caps_lock"] = (0x14, false), ["capslock"] = (0x14, false), ["menu"] = (0x5D, true), ["print"] = (0x2C, true),
        ["minus"] = (0xBD, false), ["equal"] = (0xBB, false), ["plus"] = (0xBB, false), ["comma"] = (0xBC, false), ["period"] = (0xBE, false),
        ["slash"] = (0xBF, false), ["backslash"] = (0xDC, false), ["semicolon"] = (0xBA, false), ["quote"] = (0xDE, false),
        ["grave"] = (0xC0, false), ["bracketleft"] = (0xDB, false), ["bracketright"] = (0xDD, false),
    };

    private static List<string> Split(string combo)
    {
        // "ctrl+shift+t", and "ctrl++" / "plus" for the plus key itself.
        var parts = new List<string>();
        var cur = "";
        for (int i = 0; i < combo.Length; i++)
        {
            char c = combo[i];
            if (c == '+' && cur.Length > 0) { parts.Add(cur.Trim()); cur = ""; }
            else cur += c;
        }
        parts.Add(cur.Trim());
        return parts.Where(s => s.Length > 0).ToList();
    }

    public static KeyStroke Parse(string combo)
    {
        var parts = Split(combo);
        if (parts.Count == 0) throw HandsException.BadRequest("empty key combo");
        var mods = new List<ushort>();
        for (int i = 0; i < parts.Count - 1; i++)
        {
            if (!ModifierNames.TryGetValue(parts[i], out var vk)) throw HandsException.BadRequest($"unknown modifier '{parts[i]}' in '{combo}'");
            if (vk != 0 && !mods.Contains(vk)) mods.Add(vk);
        }
        string key = parts[^1];
        // A lone modifier is a legitimate key (press Shift, hold Ctrl).
        if (ModifierNames.TryGetValue(key, out var mvk) && mvk != 0 && parts.Count == 1) return new KeyStroke(new List<ushort>(), mvk, false, null);
        if (Named.TryGetValue(key, out var n))
        {
            if (key.Equals("plus", StringComparison.OrdinalIgnoreCase) && !mods.Contains(Shift)) mods.Add(Shift);
            return new KeyStroke(mods, n.Vk, n.Ext, null);
        }
        if (key.Length >= 2 && (key[0] == 'f' || key[0] == 'F') && int.TryParse(key.AsSpan(1), out var fn) && fn is >= 1 and <= 24)
            return new KeyStroke(mods, (ushort)(0x6F + fn), false, null);
        if (key.Length == 1 || (key.Length == 2 && char.IsHighSurrogate(key[0])))
        {
            char ch = key[0];
            if (key.Length == 1)
            {
                short scan = VkKeyScanW(ch);
                if (scan != -1)
                {
                    ushort vk = (ushort)(scan & 0xFF);
                    int state = (scan >> 8) & 0xFF;
                    if ((state & 1) != 0 && !mods.Contains(Shift)) mods.Add(Shift);
                    // Ctrl / Alt in the scan state mean AltGr on this layout: type it as a character instead.
                    if ((state & 6) == 0) return new KeyStroke(mods, vk, false, null);
                }
            }
            return new KeyStroke(mods, null, false, key);
        }
        throw HandsException.BadRequest($"unknown key '{key}'");
    }
}

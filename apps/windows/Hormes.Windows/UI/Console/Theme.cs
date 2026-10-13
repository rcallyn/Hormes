using System;
using System.Windows;
using System.Windows.Media;
using Microsoft.Win32;

namespace Hormes.Windows.UI.Console;

/// <summary>
/// The Console's colours: iOS's system palette (grouped backgrounds, labels, separators, the system tints), light or
/// dark with Windows' app mode, applied as brushes on the window's resources so every DynamicResource follows a change.
/// Category colours are stits' defaults (src/lib/itemColor.ts), so an item looks the same in both apps.
/// </summary>
public static class Theme
{
    public static bool IsDark()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
            return key?.GetValue("AppsUseLightTheme") is int v && v == 0;
        }
        catch (Exception) { return false; }
    }

    /// <summary>
    /// The palette on the window, and WPF's Windows 11 theme (date pickers, drop-downs) in the same mode: a light
    /// picker on a dark sheet, or the reverse, would draw its text in the background colour.
    /// </summary>
    public static void Apply(Window window, bool dark)
    {
        Apply(window.Resources, dark);
        window.ThemeMode = dark ? ThemeMode.Dark : ThemeMode.Light;
    }

    public static void Apply(ResourceDictionary r, bool dark)
    {
        void Set(string key, string hex) => r[key] = Brush(hex);
        if (dark)
        {
            // iOS's dark system palette: black, grouped cell, raised, separator, secondary label, the system tints.
            Set("Bg", "#000000");
            Set("Sidebar", "#0C0C0D");
            Set("Card", "#1C1C1E");
            Set("CardHover", "#2C2C2E");
            Set("Fill", "#2C2C2E");
            Set("Label", "#FFFFFF");
            Set("Secondary", "#8E8E93");
            Set("Tertiary", "#636366");
            Set("Separator", "#38383A");
            Set("Accent", "#0A84FF");
            Set("AccentSoft", "#2B0A84FF");
            Set("Red", "#FF453A");
            Set("Orange", "#FF9F0A");
            Set("Green", "#30D158");
            Set("Selection", "#2C2C2E");
            Set("Dim", "#99000000");
            Set("SegmentTrack", "#3D767680");
            Set("SegmentSelected", "#636366");
            Set("SwitchOff", "#51787880");
            Set("ControlFill", "#59787880");
            Set("ControlHover", "#8C787880");
        }
        else
        {
            Set("Bg", "#F2F2F7");
            Set("Sidebar", "#E9E9EE");
            Set("Card", "#FFFFFF");
            Set("CardHover", "#E5E5EA");
            Set("Fill", "#EEEEF0");
            Set("Label", "#000000");
            Set("Secondary", "#8A8A8E");
            Set("Tertiary", "#AEAEB2");
            Set("Separator", "#C6C6C8");
            Set("Accent", "#007AFF");
            Set("AccentSoft", "#1F007AFF");
            Set("Red", "#FF3B30");
            Set("Orange", "#FF9500");
            Set("Green", "#34C759");
            Set("Selection", "#DCDCE1");
            Set("Dim", "#59000000");
            Set("SegmentTrack", "#1F767680");
            Set("SegmentSelected", "#FFFFFF");
            Set("SwitchOff", "#29787880");
            Set("ControlFill", "#33787880");
            Set("ControlHover", "#59787880");
        }
    }

    /// <summary>stits' category colours (Tailwind 500s); an uncategorised item takes the accent.</summary>
    public static Brush Category(string? category) => Brush(category switch
    {
        "rush" => "#F43F5E",
        "career" => "#6366F1",
        "school" => "#0EA5E9",
        "house" => "#64748B",
        "other" => "#8B5CF6",
        "lloyd" => "#14B8A6",
        _ => "#0A84FF",
    });

    public static SolidColorBrush Brush(string hex)
    {
        var b = new SolidColorBrush((Color)ColorConverter.ConvertFromString(hex));
        b.Freeze();
        return b;
    }

    /// <summary>The colour at an opacity (a soft fill behind an event).</summary>
    public static SolidColorBrush Soft(Brush b, double opacity)
    {
        var c = ((SolidColorBrush)b).Color;
        var s = new SolidColorBrush(Color.FromArgb((byte)(opacity * 255), c.R, c.G, c.B));
        s.Freeze();
        return s;
    }

    /// <summary>Follow Windows' light/dark switch while the window is open.</summary>
    public static void Follow(Window window)
    {
        Apply(window, IsDark());
        UserPreferenceChangedEventHandler handler = (_, e) =>
        {
            if (e.Category == UserPreferenceCategory.General)
                window.Dispatcher.BeginInvoke(() => Apply(window, IsDark()));
        };
        SystemEvents.UserPreferenceChanged += handler;
        window.Unloaded += (_, _) => SystemEvents.UserPreferenceChanged -= handler;
    }
}

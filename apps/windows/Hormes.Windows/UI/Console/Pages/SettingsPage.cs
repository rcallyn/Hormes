using System;
using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using Hormes.Windows.Daemon;
using Hormes.Windows.Speech;

namespace Hormes.Windows.UI.Console.Pages;

/// <summary>
/// Settings, grouped like iOS: You; Calendar &amp; Todos (Hormes' own, or synced with stits); Voice (claps, spoken
/// replies, speech recognition); Hormes (the engine, its logs).
/// </summary>
public sealed class SettingsPage : PageFrame, IConsolePage
{
    private readonly TextBox name;
    private readonly RadioButton useLocal;
    private readonly RadioButton useStits;
    private readonly TextBlock stitsStatus;
    private readonly CheckBox clap;
    private readonly CheckBox speak;
    private readonly TextBlock keyStatus;
    private readonly TextBlock whisperStatus;
    private readonly TextBlock engineStatus;
    private bool updating;

    public SettingsPage(ConsoleServices services, ConsoleWindow window) : base(services, window, "Settings")
    {
        Subtitle.Text = "Hormes for Windows";

        // You
        Body.Children.Add(Ui.Text("You", "SectionHeader"));
        name = Ui.Field("What should Hormes call you?");
        name.Width = 260;
        name.LostFocus += (_, _) => SaveName();
        name.KeyDown += (_, e) => { if (e.Key == System.Windows.Input.Key.Enter) SaveName(); };
        Body.Children.Add(Ui.Group(Ui.Row(Ui.Text("Name", "Body"), name)));

        // Calendar & Todos: the choice between Hormes' own and stits.
        Body.Children.Add(Ui.Text("Calendar & Todos", "SectionHeader"));
        useLocal = Choice("Use Hormes' calendar and todos", "Kept on this PC, in ~/.hormes/planner.json.");
        useStits = Choice("Sync with stits", "Hormes reads and writes stits' own calendar and todos, so changes show up in both. Your PC's items are copied into stits once when you switch.");
        stitsStatus = Ui.Text("", "Caption");
        stitsStatus.TextWrapping = TextWrapping.Wrap;
        stitsStatus.Margin = new Thickness(16, 0, 16, 11);
        var syncNow = Ui.Button("Sync now", () => Window.Run(Services.Planner.Refresh(), "Up to date"), "LinkButton");
        var stitsBlock = new StackPanel();
        stitsBlock.Children.Add(Wrap(useStits));
        stitsBlock.Children.Add(stitsStatus);
        Body.Children.Add(Ui.Group(Wrap(useLocal), stitsBlock));
        syncNow.HorizontalAlignment = HorizontalAlignment.Left;
        syncNow.Margin = new Thickness(6, 4, 0, 0);
        Body.Children.Add(syncNow);
        useLocal.Checked += (_, _) => { if (!updating) Window.Run(Services.Planner.SetSync(false), "Using Hormes' own calendar and todos"); };
        useStits.Checked += (_, _) => { if (!updating) Window.Run(Services.Planner.SetSync(true), "Synced with stits"); };

        // Voice
        Body.Children.Add(Ui.Text("Voice", "SectionHeader"));
        clap = Switch(on => Services.SetClap(on));
        speak = Switch(on => Services.SetSpeak(on));
        keyStatus = Ui.Text("", "Caption");
        whisperStatus = Ui.Text("", "Caption");
        var speakText = new StackPanel();
        speakText.Children.Add(Ui.Text("Speak replies", "Body"));
        speakText.Children.Add(keyStatus);
        var clapText = new StackPanel();
        clapText.Children.Add(Ui.Text("Listen for a double clap", "Body"));
        clapText.Children.Add(Ui.Text("Keeps the microphone open; claps are detected on this PC.", "Caption"));
        var whisperText = new StackPanel();
        whisperText.Children.Add(Ui.Text("Speech recognition", "Body"));
        whisperText.Children.Add(whisperStatus);
        var openEnv = Ui.Button("Open key file", OpenEnvFile, "LinkButton");
        Body.Children.Add(Ui.Group(
            Ui.Row(clapText, clap),
            Ui.Row(speakText, Ui.HStack(8, openEnv, speak)),
            Ui.Row(whisperText)));

        // Hormes
        Body.Children.Add(Ui.Text("Hormes", "SectionHeader"));
        engineStatus = Ui.Text("", "Caption");
        var engineText = new StackPanel();
        engineText.Children.Add(Ui.Text("Engine", "Body"));
        engineText.Children.Add(engineStatus);
        Body.Children.Add(Ui.Group(
            Ui.Row(engineText, Ui.Button("Restart", () => { Services.Daemon.Restart(); Window.ShowToast("Restarting the engine…"); })),
            Ui.Row(Ui.Text("Engine log", "Body"), Ui.Button("Open", () => Open(DaemonProcess.LogPath), "LinkButton")),
            Ui.Row(Ui.Text("App log (voice, speech)", "Body"), Ui.Button("Open", () => Open(AppLog.PathName), "LinkButton"))));
    }

    private static RadioButton Choice(string title, string detail)
    {
        var text = new StackPanel();
        text.Children.Add(Ui.Text(title, "Body"));
        var d = Ui.Text(detail, "Caption");
        d.TextWrapping = TextWrapping.Wrap;
        d.TextTrimming = TextTrimming.None;
        text.Children.Add(d);
        var choice = new RadioButton { Content = text, GroupName = "plannerSource" };
        choice.SetResourceReference(StyleProperty, "CheckRow");
        return choice;
    }

    private static UIElement Wrap(RadioButton choice) => choice;

    private CheckBox Switch(Action<bool> changed)
    {
        var c = new CheckBox();
        c.SetResourceReference(StyleProperty, "Switch");
        c.Click += (_, _) => { if (!updating) changed(c.IsChecked == true); Refresh(); };
        return c;
    }

    private void SaveName()
    {
        var value = name.Text.Trim();
        if (value == Services.UserName || (value.Length == 0 && Services.UserName.Length == 0)) return;
        Services.SetEngineSetting("userName", value);
        Window.ShowToast(value.Length > 0 ? $"Hormes will call you {value}" : "Name cleared");
    }

    private static void Open(string path)
    {
        if (File.Exists(path)) Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
    }

    /// <summary>~/.hormes/env in Notepad, created empty with a hint line when missing: the key is typed by User, never by Hormes.</summary>
    private void OpenEnvFile()
    {
        var path = Path.Combine(Ipc.StateDir, "env");
        if (!File.Exists(path))
        {
            Directory.CreateDirectory(Ipc.StateDir);
            File.WriteAllText(path, "# Hormes keys, one per line. For spoken replies add:\n# ELEVENLABS_API_KEY=your-key\n");
        }
        Process.Start(new ProcessStartInfo("notepad.exe", $"\"{path}\"") { UseShellExecute = true });
        Window.ShowToast("Add ELEVENLABS_API_KEY=… and save; the next reply picks it up.");
    }

    public void Refresh()
    {
        updating = true;
        if (!name.IsKeyboardFocused) name.Text = Services.UserName;
        var p = Services.Planner.State;
        useLocal.IsChecked = !p.StitsSync;
        useStits.IsChecked = p.StitsSync;
        useStits.IsEnabled = p.StitsAvailable || p.StitsSync;
        stitsStatus.Text = !p.StitsAvailable
            ? "No stits found. Hormes looks for Documents\\Repositories\\stits\\.env.local (its DATABASE_URL), or set STITS_DATABASE_URL."
            : p.StitsSync
                ? (p.Error is { } err ? $"Problem: {err}" : $"Connected · {p.Todos.Count} todos, {p.Events.Count} events · checked {Ago(p.SyncedAt)} · refreshes every minute")
                : $"Found ({p.StitsOrigin}). Not in use.";
        stitsStatus.SetResourceReference(TextBlock.ForegroundProperty, p.StitsSync && p.Error is not null ? "Red" : "Secondary");

        clap.IsChecked = Services.Settings.Clap;
        speak.IsChecked = Services.Settings.SpeakReplies;
        keyStatus.Text = Services.Speaker.Available
            ? $"ElevenLabs · {ElevenLabsSpeaker.VoiceName} · key found"
            : "Needs ELEVENLABS_API_KEY in ~/.hormes/env";
        keyStatus.SetResourceReference(TextBlock.ForegroundProperty, Services.Speaker.Available ? "Secondary" : "Orange");
        whisperStatus.Text = $"Whisper large-v3-turbo on this PC{(Services.Voice.Runtime is { } r ? $" · {r}" : " · loading")}";
        var connected = Services.Client.Connected;
        engineStatus.Text = $"{Services.Daemon.State}{(connected ? $" · connected to pid {Services.Client.DaemonPid}" : " · not connected")}";
        updating = false;
    }

    private static string Ago(long? ms)
    {
        if (ms is not { } v) return "never";
        var span = DateTimeOffset.Now - DateTimeOffset.FromUnixTimeMilliseconds(v);
        return span.TotalSeconds < 60 ? "just now" : span.TotalMinutes < 60 ? $"{(int)span.TotalMinutes} min ago" : $"{(int)span.TotalHours} h ago";
    }
}

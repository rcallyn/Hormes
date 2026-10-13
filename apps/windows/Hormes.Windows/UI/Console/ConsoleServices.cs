using System;
using System.Text.Json;
using Hormes.Windows.Daemon;
using Hormes.Windows.Model;
using Hormes.Windows.Speech;

namespace Hormes.Windows.UI.Console;

/// <summary>What the Console's pages work with: the engine, the planner, the ears and voice, the app's settings.</summary>
public sealed class ConsoleServices
{
    public required EngineClient Client { get; init; }
    public required DaemonProcess Daemon { get; init; }
    public required Planner Planner { get; init; }
    public required VoiceInput Voice { get; init; }
    public required ElevenLabsSpeaker Speaker { get; init; }
    public required AppSettings Settings { get; init; }
    /// <summary>Turn clap listening on or off (and remember it).</summary>
    public required Action<bool> SetClap { get; init; }
    /// <summary>Turn spoken replies on or off (and remember it).</summary>
    public required Action<bool> SetSpeak { get; init; }

    /// <summary>The newest engine snapshot, for Home's conversation and status.</summary>
    public JsonElement? Snapshot { get; private set; }
    public event Action<JsonElement>? SnapshotChanged;

    public void OnSnapshot(JsonElement s)
    {
        Snapshot = s;
        SnapshotChanged?.Invoke(s);
    }

    /// <summary>Ask Hormes (Claude) something, as if typed in the notch.</summary>
    public void Ask(string text)
    {
        Asked?.Invoke();
        _ = Client.SendCommandAsync(new { type = "say-text", text });
    }

    /// <summary>A line was typed in the Console.</summary>
    public event Action? Asked;

    /// <summary>The name Hormes calls User (Settings › Your name); "" when unset.</summary>
    public string UserName =>
        Snapshot is { } s && s.TryGetProperty("settings", out var st) && st.TryGetProperty("userName", out var n) && n.GetString() is { Length: > 0 } name
            ? name.Split(' ')[0]
            : "";

    /// <summary>Change one engine setting (a SettingsPatch field).</summary>
    public void SetEngineSetting(string key, object value) =>
        _ = Client.SendCommandAsync(new { type = "set-settings", patch = new System.Collections.Generic.Dictionary<string, object> { [key] = value } });
}

/// <summary>A Console page: told when it is shown, and when the planner or the snapshot changes.</summary>
public interface IConsolePage
{
    void Refresh();
}

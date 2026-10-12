using System;
using System.Collections.Generic;
using System.Text.Json;

namespace Hormes.Windows.Speech;

/// <summary>
/// Picks the lines to say out of the snapshots: each final line of Hormes's that has not been seen before. What is
/// already on the transcript when the app connects is history, not something to read out.
/// </summary>
public sealed class RepliesToSpeak
{
    private readonly Action<string> say;
    private readonly HashSet<string> seen = new();
    private bool primed;

    public RepliesToSpeak(Action<string> say) => this.say = say;

    /// <summary>A snapshot (reader thread).</summary>
    public void OnSnapshot(JsonElement snapshot)
    {
        if (!snapshot.TryGetProperty("transcript", out var transcript) || transcript.ValueKind != JsonValueKind.Array) return;
        foreach (var item in transcript.EnumerateArray())
        {
            if (!item.TryGetProperty("id", out var idEl) || idEl.GetString() is not { } id) continue;
            if (!item.TryGetProperty("speaker", out var sp) || sp.GetString() != "hormes") continue;
            if (item.TryGetProperty("final", out var final) && final.ValueKind == JsonValueKind.False) continue;
            if (!seen.Add(id) || !primed) continue;
            if (item.TryGetProperty("text", out var text) && text.GetString() is { Length: > 0 } line) say(line);
        }
        primed = true;
    }
}

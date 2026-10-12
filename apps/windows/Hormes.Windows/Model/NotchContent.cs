using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;

namespace Hormes.Windows.Model;

/// <summary>
/// What the notch shows, built whole from one snapshot (apps/mac DockContent, the parts this app
/// draws so far). Parsed on the reader thread; handed to the UI as an immutable record.
/// </summary>
public sealed record NotchContent(
    string Phase,
    bool BrainReady,
    string? HeroSpeaker,
    string? Hero,
    IReadOnlyList<NotchThread> Threads,
    NotchProblem? Problem,
    NotchApproval? Approval)
{
    public static readonly NotchContent Disconnected = new("disconnected", false, null, null, Array.Empty<NotchThread>(), null, null);

    public bool Asleep => Phase is "asleep" or "disconnected";
    public bool Paused => Phase == "paused";

    /// <summary>The anchor's word: what Hormes is doing, in the island's grammar.</summary>
    public string PhaseWord => Phase switch
    {
        "asleep" => "Asleep",
        "connecting" => "Waking",
        "listening" => "Listening",
        "speaking" => "Speaking",
        "thinking" => "Thinking",
        "acting" => "Working",
        "muted" => "Muted",
        "paused" => "Paused",
        "error" => "Problem",
        "disconnected" => "Starting…",
        _ => Phase,
    };

    private static readonly HashSet<string> Terminal = new() { "done", "failed", "stopped" };

    public static NotchContent From(JsonElement snap)
    {
        var phase = Str(snap, "phase") ?? "asleep";
        var brainReady = snap.TryGetProperty("brainReady", out var br) && br.ValueKind == JsonValueKind.True;

        // The hero: the newest transcript line; else what the main thread is working on.
        string? heroSpeaker = null, hero = null;
        if (snap.TryGetProperty("transcript", out var transcript) && transcript.ValueKind == JsonValueKind.Array && transcript.GetArrayLength() > 0)
        {
            var last = transcript[transcript.GetArrayLength() - 1];
            hero = Str(last, "text")?.Trim();
            heroSpeaker = Str(last, "speaker");
        }

        var threads = new List<NotchThread>();
        if (snap.TryGetProperty("threads", out var ts) && ts.ValueKind == JsonValueKind.Array)
        {
            foreach (var t in ts.EnumerateArray())
            {
                var id = Str(t, "id") ?? "";
                var status = Str(t, "status") ?? "idle";
                if (Terminal.Contains(status)) continue;
                if (id == "main")
                {
                    if (string.IsNullOrEmpty(hero) && status != "idle") hero = Str(t, "detail") ?? Str(t, "task");
                    continue;
                }
                threads.Add(new NotchThread(id, Str(t, "name") ?? id, status, Str(t, "question")));
            }
        }

        NotchProblem? problem = null;
        if (snap.TryGetProperty("problems", out var ps) && ps.ValueKind == JsonValueKind.Array && ps.GetArrayLength() > 0)
        {
            var count = ps.GetArrayLength();
            var p = ps[count - 1];
            string? label = null, command = null;
            if (p.TryGetProperty("remedy", out var remedy) && remedy.ValueKind == JsonValueKind.Object)
            {
                label = Str(remedy, "label");
                if (remedy.TryGetProperty("command", out var cmd) && cmd.ValueKind == JsonValueKind.Object) command = cmd.GetRawText();
                else label = null; // an open/copy remedy needs the Mac's surfaces; not offered here yet
            }
            problem = new NotchProblem(Str(p, "kind") ?? "other", Str(p, "text") ?? "", label, command, count - 1);
        }

        NotchApproval? approval = null;
        if (snap.TryGetProperty("approval", out var a) && a.ValueKind == JsonValueKind.Object)
            approval = new NotchApproval(Str(a, "id") ?? "", Str(a, "threadId") ?? "main", Str(a, "description") ?? "", a.TryGetProperty("requiresOwner", out var ro) && ro.ValueKind == JsonValueKind.True);

        return new NotchContent(phase, brainReady, heroSpeaker, hero, threads, problem, approval);
    }

    private static string? Str(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
}

public sealed record NotchThread(string Id, string Name, string Status, string? Question)
{
    public string Word => Status switch
    {
        "waiting-user" => "asks",
        "waiting-screen" => "waits for the screen",
        "acting" => "working",
        _ => Status,
    };
}

public sealed record NotchProblem(string Kind, string Text, string? RemedyLabel, string? RemedyCommandJson, int More);

public sealed record NotchApproval(string Id, string ThreadId, string Description, bool RequiresOwner);

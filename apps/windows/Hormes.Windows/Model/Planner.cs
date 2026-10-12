using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using Hormes.Windows.Daemon;

namespace Hormes.Windows.Model;

// The planner as the daemon sends it (packages/protocol planner.ts): User's todos and calendar, this PC's own or
// stits'. Dates are local "yyyy-MM-dd", times "HH:mm".

public sealed record PlannerSubtask(string Id, string Title, bool Done);

public sealed record PlannerTodo
{
    public string Id { get; init; } = "";
    public string Title { get; init; } = "";
    public string? Description { get; init; }
    public bool Done { get; init; }
    public string? DueDate { get; init; }
    public string? Category { get; init; }
    public string? Priority { get; init; }
    public List<PlannerSubtask>? Subtasks { get; init; }
    public string? CompletedAt { get; init; }
    public string? CanvasId { get; init; }

    [JsonIgnore] public DateOnly? Due => Planner.ParseDate(DueDate);
}

public sealed record PlannerRecurrence(string Freq, int Interval, string? Until = null, List<string>? Exceptions = null);

public sealed record PlannerEvent
{
    public string Id { get; init; } = "";
    public string Title { get; init; } = "";
    public string Date { get; init; } = "";
    public string? EndDate { get; init; }
    public string Time { get; init; } = "";
    public string? EndTime { get; init; }
    public string? TodoId { get; init; }
    public string? Category { get; init; }
    public bool? Done { get; init; }
    public PlannerRecurrence? Recurrence { get; init; }
    public string? CanvasId { get; init; }
    public bool RecurringInstance { get; init; }

    [JsonIgnore] public DateOnly Day => Planner.ParseDate(Date) ?? DateOnly.MinValue;
    [JsonIgnore] public bool AllDay => string.IsNullOrEmpty(Time);
    [JsonIgnore] public TimeOnly? Start => Planner.ParseTime(Time);
    /// <summary>The end time; stits defaults an untimed end to an hour after the start.</summary>
    [JsonIgnore] public TimeOnly? End => Planner.ParseTime(EndTime) ?? Start?.AddHours(1);
}

public sealed record PlannerState
{
    public string Source { get; init; } = "local";
    public bool StitsSync { get; init; }
    public bool StitsAvailable { get; init; }
    public string? StitsOrigin { get; init; }
    public string? Error { get; init; }
    public long? SyncedAt { get; init; }
    public List<PlannerTodo> Todos { get; init; } = new();
    public List<PlannerEvent> Events { get; init; } = new();

    public static readonly PlannerState Empty = new();
}

/// <summary>
/// The Console's view of the planner: the latest state from the daemon, and the commands that change it. Each command
/// gets the daemon's answer (ok, or why not); the change itself arrives as the next broadcast state.
/// </summary>
public sealed class Planner
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    /// <summary>stits' categories and their labels, in its order.</summary>
    public static readonly (string Id, string Label)[] Categories =
    {
        ("school", "School"), ("career", "Career"), ("rush", "Rush"), ("house", "House"), ("lloyd", "Lloyd"), ("other", "Other"),
    };

    private readonly EngineClient client;
    private readonly ConcurrentDictionary<string, TaskCompletionSource<(bool Ok, string? Error, string? Id)>> pending = new();
    private long seq;

    public Planner(EngineClient client)
    {
        this.client = client;
        client.Message += OnMessage;
    }

    public PlannerState State { get; private set; } = PlannerState.Empty;

    /// <summary>The checks render the Console with sample data (apps/windows/Checks --render).</summary>
    internal void Load(PlannerState state)
    {
        State = state;
        Changed?.Invoke(state);
    }
    /// <summary>A new state (reader thread).</summary>
    public event Action<PlannerState>? Changed;

    private void OnMessage(string type, JsonElement root)
    {
        switch (type)
        {
            case "planner.state":
                if (!root.TryGetProperty("state", out var s)) return;
                try { State = s.Deserialize<PlannerState>(Json) ?? PlannerState.Empty; }
                catch (JsonException e) { AppLog.Write($"planner: unreadable state: {e.Message}"); return; }
                Changed?.Invoke(State);
                break;
            case "planner.reply":
                var id = root.TryGetProperty("id", out var i) ? i.GetString() ?? "" : "";
                if (!pending.TryRemove(id, out var tcs)) return;
                var ok = root.TryGetProperty("ok", out var o) && o.ValueKind == JsonValueKind.True;
                var error = root.TryGetProperty("error", out var e2) ? e2.GetString() : null;
                var itemId = root.TryGetProperty("itemId", out var it) ? it.GetString() : null;
                tcs.TrySetResult((ok, error, itemId));
                break;
        }
    }

    /// <summary>Send one planner command; the daemon's answer, or a timeout / disconnection as an error.</summary>
    public async Task<(bool Ok, string? Error, string? Id)> RunAsync(object command)
    {
        if (!client.Connected) return (false, "Hormes is not connected to its engine yet.", null);
        var id = $"pl{Interlocked.Increment(ref seq)}";
        var tcs = new TaskCompletionSource<(bool, string?, string?)>(TaskCreationOptions.RunContinuationsAsynchronously);
        pending[id] = tcs;
        await client.SendJsonAsync(new { type = "planner", id, command = JsonSerializer.SerializeToElement(command, Json) }).ConfigureAwait(false);
        var done = await Task.WhenAny(tcs.Task, Task.Delay(TimeSpan.FromSeconds(25))).ConfigureAwait(false);
        pending.TryRemove(id, out _);
        return done == tcs.Task ? tcs.Task.Result : (false, "The planner did not answer in time.", null);
    }

    public Task<(bool Ok, string? Error, string? Id)> AddTodo(object todo) => RunAsync(new { op = "todo.add", todo });
    public Task<(bool Ok, string? Error, string? Id)> UpdateTodo(string id, object patch) => RunAsync(new { op = "todo.update", id, patch });
    public Task<(bool Ok, string? Error, string? Id)> DeleteTodo(string id) => RunAsync(new { op = "todo.delete", id });
    public Task<(bool Ok, string? Error, string? Id)> AddEvent(object @event) => RunAsync(new { op = "event.add", @event });
    public Task<(bool Ok, string? Error, string? Id)> UpdateEvent(string id, object patch) => RunAsync(new { op = "event.update", id, patch });
    public Task<(bool Ok, string? Error, string? Id)> DeleteEvent(string id) => RunAsync(new { op = "event.delete", id });
    public Task<(bool Ok, string? Error, string? Id)> SetSync(bool enabled) => RunAsync(new { op = "sync.set", enabled });
    public Task<(bool Ok, string? Error, string? Id)> Refresh() => RunAsync(new { op = "refresh" });

    // ------------------------------------------------------------------ dates and occurrences

    public static string Iso(DateOnly d) => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
    public static string Hm(TimeOnly t) => t.ToString("HH:mm", CultureInfo.InvariantCulture);

    public static DateOnly? ParseDate(string? s) =>
        DateOnly.TryParseExact(s, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : null;

    public static TimeOnly? ParseTime(string? s) =>
        TimeOnly.TryParseExact(s, "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var t) ? t : null;

    public static DateOnly Today => DateOnly.FromDateTime(DateTime.Now);

    /// <summary>
    /// Events touching [from, to], recurring ones expanded to their days (ported from stits' expandRecurringEvents, as
    /// packages/protocol planner.ts is), sorted by day, all-day first, then time.
    /// </summary>
    public static List<PlannerEvent> Between(IEnumerable<PlannerEvent> events, DateOnly from, DateOnly to)
    {
        var result = new List<PlannerEvent>();
        foreach (var e in events)
        {
            if (e.Recurrence is not { } r)
            {
                var last = !string.IsNullOrEmpty(e.EndDate) && ParseDate(e.EndDate) is { } end ? end : e.Day;
                if (last >= from && e.Day <= to) result.Add(e);
                continue;
            }
            var step = Math.Max(1, r.Interval);
            var until = ParseDate(r.Until) is { } u && u < to ? u : to;
            var skip = r.Exceptions is { Count: > 0 } ex ? new HashSet<string>(ex) : null;
            var cursor = e.Day;
            if (r.Freq != "monthly" && from > cursor)
            {
                var per = r.Freq == "daily" ? step : step * 7;
                var jumps = (from.DayNumber - cursor.DayNumber) / per;
                if (jumps > 0) cursor = Advance(cursor, r.Freq, step * jumps);
            }
            for (var guard = 0; cursor <= until && guard < 500; guard++)
            {
                if (cursor >= from && !(skip?.Contains(Iso(cursor)) ?? false))
                    result.Add(e with { Id = $"{e.Id}::{Iso(cursor)}", Date = Iso(cursor), RecurringInstance = true });
                cursor = Advance(cursor, r.Freq, step);
            }
        }
        return result.OrderBy(e => e.Day).ThenBy(e => e.AllDay ? 0 : 1).ThenBy(e => e.Time, StringComparer.Ordinal).ToList();
    }

    private static DateOnly Advance(DateOnly d, string freq, int step) => freq switch
    {
        "daily" => d.AddDays(step),
        "weekly" => d.AddDays(step * 7),
        _ => d.AddMonths(step),
    };

    /// <summary>"Today", "Tomorrow", "Yesterday", the weekday within a week, else "Oct 21".</summary>
    public static string Friendly(DateOnly d)
    {
        var diff = d.DayNumber - Today.DayNumber;
        return diff switch
        {
            0 => "Today",
            1 => "Tomorrow",
            -1 => "Yesterday",
            > 1 and < 7 => d.ToString("dddd", CultureInfo.CurrentCulture),
            _ => d.ToString(d.Year == Today.Year ? "MMM d" : "MMM d, yyyy", CultureInfo.CurrentCulture),
        };
    }

    /// <summary>A 12-hour clock the way Apple writes it: "9:30 AM".</summary>
    public static string Clock(TimeOnly t) => t.ToString("h:mm tt", CultureInfo.CurrentCulture);

    public static string CategoryLabel(string? id) => Categories.FirstOrDefault(c => c.Id == id).Label ?? "";
}

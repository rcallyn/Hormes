using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Hormes.Windows;
using Hormes.Windows.Daemon;
using Hormes.Windows.Model;
using Hormes.Windows.Speech;
using Hormes.Windows.UI;
using Hormes.Windows.UI.Console;

namespace Hormes.Windows.Checks;

/// <summary>
/// The Console, rendered to PNGs with sample data (never anyone's real planner), light and dark: every page, plus the
/// todo and event sheets. For looking at the UI without a screen (a locked PC, CI):
///   dotnet run --project apps/windows/Checks -- --render &lt;dir&gt;
/// </summary>
public static class Render
{
    public static void Run(string dir)
    {
        Directory.CreateDirectory(dir);
        var thread = new Thread(() => RenderAll(dir));
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        thread.Join();
    }

    /// <summary>A courses.state as the daemon sends it, for the School page's Your classes.</summary>
    private const string SampleCourses = """
        {"type":"courses.state","courses":{"root":"C:/Users/you/Hormes/Courses","courses":[
          {"id":"econ-101","title":"Principles of Economics","code":"ECON 101","files":23,"byKind":{"lecture":12,"homework":5,"transcript":4,"syllabus":1,"exam":1},"due":[{"title":"ECON 101 problem set 4","dueDate":"2026-10-14"}],"unreadable":[]},
          {"id":"chem-110","title":"General Chemistry","code":"CHEM 110","files":9,"byKind":{"lecture":6,"lab":3},"due":[],"unreadable":[{"file":"CHEM 110/Lectures/scan-week2.pdf","error":"no text found (a scanned PDF)"}]}
        ]}}
        """;

    private static void RenderAll(string dir)
    {
        _ = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
        var client = new EngineClient("hormes-render-none");
        var planner = new Planner(client);
        var services = new ConsoleServices
        {
            Client = client,
            Daemon = new DaemonProcess("hormes-render-none"),
            Planner = planner,
            Voice = new VoiceInput(useMic: false),
            Recorder = new Hormes.Windows.Speech.LectureRecorder(new Hormes.Windows.Speech.WhisperTranscriber()),
            Speaker = new ElevenLabsSpeaker { Enabled = false },
            Settings = new AppSettings(),
            SetClap = _ => { },
            SetSpeak = _ => { },
        };
        services.OnSnapshot(JsonDocument.Parse("""
            {"phase":"asleep","brainReady":true,"settings":{"userName":"Alex Sample"},
             "transcript":[{"id":"1","speaker":"user","text":"What's due this week?","final":true},
                           {"id":"2","speaker":"hormes","text":"Two things: the ECON problem set on Wednesday and your lab report on Friday. Want me to block time for them?","final":true}]}
            """).RootElement.Clone());
        planner.Load(Sample());

        foreach (var dark in new[] { false, true })
        {
            var window = new ConsoleWindow(services) { Left = -12000, Top = 0, ShowActivated = false, ShowInTaskbar = false };
            window.Show();
            Theme.Apply(window, dark);
            var mode = dark ? "dark" : "light";
            foreach (var page in new[] { "Home", "Calendar", "Todos", "School", "Settings" })
            {
                window.Navigate(page);
                Settle(window, 450);
                if (window.CurrentPage is Hormes.Windows.UI.Console.Pages.SchoolPage school)
                {
                    school.RenderCourses(System.Text.Json.JsonDocument.Parse(SampleCourses).RootElement);
                    Settle(window, 200);
                }
                Save(window, Path.Combine(dir, $"{page.ToLowerInvariant()}-{mode}.png"));
            }
            window.Navigate("Calendar");
            if (window.CurrentPage is Hormes.Windows.UI.Console.Pages.CalendarPage cal)
            {
                cal.ShowView(2);
                Settle(window, 300);
                Save(window, Path.Combine(dir, $"calendar-month-{mode}.png"));
                cal.ShowView(0);
                Settle(window, 300);
                Save(window, Path.Combine(dir, $"calendar-day-{mode}.png"));
                cal.ShowView(1);
            }
            window.Navigate("Todos");
            Settle(window, 200);
            Editors.Todo(window, planner, planner.State.Todos.First(t => t.Priority == "high"));
            Settle(window, 400);
            Save(window, Path.Combine(dir, $"todo-sheet-{mode}.png"));
            window.CloseSheet();
            window.Navigate("Calendar");
            Editors.Event(window, planner, planner.State.Events.First(e => e.Recurrence is not null));
            Settle(window, 400);
            Save(window, Path.Combine(dir, $"event-sheet-{mode}.png"));
            window.CloseSheet();
            window.Hide();
        }
        Console.WriteLine($"     rendered the Console to {dir}");
    }

    /// <summary>Let layout, bindings and the page fade finish.</summary>
    private static void Settle(Window w, int ms)
    {
        var until = DateTime.UtcNow.AddMilliseconds(ms);
        while (DateTime.UtcNow < until)
        {
            var frame = new DispatcherFrame();
            w.Dispatcher.BeginInvoke(DispatcherPriority.Background, () => frame.Continue = false);
            Dispatcher.PushFrame(frame);
            Thread.Sleep(15);
        }
    }

    private static void Save(Window w, string path)
    {
        var root = (FrameworkElement)w.Content;
        var width = (int)root.ActualWidth;
        var height = (int)root.ActualHeight;
        var bmp = new RenderTargetBitmap(width, height, 96, 96, PixelFormats.Pbgra32);
        var bg = new DrawingVisual();
        using (var dc = bg.RenderOpen()) dc.DrawRectangle(w.Background, null, new Rect(0, 0, width, height));
        bmp.Render(bg);
        bmp.Render(root);
        var png = new PngBitmapEncoder();
        png.Frames.Add(BitmapFrame.Create(bmp));
        using var file = File.Create(path);
        png.Save(file);
    }

    /// <summary>A plausible student's week, relative to today.</summary>
    private static PlannerState Sample()
    {
        var today = Planner.Today;
        string D(int days) => Planner.Iso(today.AddDays(days));
        var monday = today.AddDays(-(((int)today.DayOfWeek + 6) % 7));
        var todos = new List<PlannerTodo>
        {
            new() { Id = "t1", Title = "ECON 101 problem set 4", DueDate = D(2), Category = "school", Priority = "high", CanvasId = "c1" },
            new() { Id = "t2", Title = "Lab report: titration", DueDate = D(4), Category = "school", CanvasId = "c2" },
            new() { Id = "t3", Title = "Call Tazeem about the internship", DueDate = D(0), Category = "career", Priority = "medium" },
            new() { Id = "t4", Title = "Rent", DueDate = D(-1), Category = "house", Priority = "high" },
            new() { Id = "t5", Title = "Groceries", Category = "house", Description = "eggs, oats, coffee" },
            new() { Id = "t6", Title = "Read chapter 7", DueDate = D(1), Category = "school" },
            new() { Id = "t7", Title = "Rush event signup", DueDate = D(9), Category = "rush" },
            new() { Id = "t8", Title = "Update resume", Category = "career", Done = true, CompletedAt = DateTime.UtcNow.ToString("o") },
        };
        var events = new List<PlannerEvent>
        {
            new() { Id = "e1", Title = "ECON 101", Date = Planner.Iso(monday.AddDays(-21)), Time = "10:00", EndTime = "11:15", Category = "school", Recurrence = new PlannerRecurrence("weekly", 1) },
            new() { Id = "e2", Title = "ECON 101", Date = Planner.Iso(monday.AddDays(-19)), Time = "10:00", EndTime = "11:15", Category = "school", Recurrence = new PlannerRecurrence("weekly", 1) },
            new() { Id = "e3", Title = "CHEM 110 Lab", Date = Planner.Iso(monday.AddDays(-20)), Time = "13:00", EndTime = "15:50", Category = "school", Recurrence = new PlannerRecurrence("weekly", 1) },
            new() { Id = "e4", Title = "Dentist", Date = D(0), Time = "15:00", EndTime = "15:45" },
            new() { Id = "e5", Title = "Coffee with Sam", Date = D(0), Time = "15:30", EndTime = "16:30", Category = "career" },
            new() { Id = "e6", Title = "Chapter meeting", Date = D(1), Time = "19:00", EndTime = "20:30", Category = "rush" },
            new() { Id = "e7", Title = "Mom's birthday", Date = D(3), Time = "" },
            new() { Id = "e8", Title = "Gym", Date = D(-1), Time = "07:30", EndTime = "08:30", Category = "other", Recurrence = new PlannerRecurrence("daily", 2) },
        };
        return new PlannerState { Source = "local", StitsAvailable = true, StitsOrigin = "C:/Users/you/Documents/Repositories/stits/.env.local", Todos = todos, Events = events, SyncedAt = DateTimeOffset.Now.ToUnixTimeMilliseconds() };
    }
}

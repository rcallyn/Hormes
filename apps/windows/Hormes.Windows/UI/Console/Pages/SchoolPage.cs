using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using Hormes.Windows.Model;
using Hormes.Windows.Speech;

namespace Hormes.Windows.UI.Console.Pages;

/// <summary>
/// School: the week's classes (school-category events: stits keeps a class schedule as recurring school events), the
/// assignments still open (school todos, and everything Canvas brought in), and ways to study with Hormes: each
/// assignment can be handed to Claude, which reads the planner itself.
/// </summary>
public sealed class SchoolPage : PageFrame, IConsolePage
{
    private readonly UniformGrid week = new() { Columns = 7 };
    private readonly StackPanel assignments = new();
    private DateOnly weekStart;
    private readonly Button record;
    private readonly CheckBox nudges = new() { IsChecked = true };
    private readonly System.Windows.Threading.DispatcherTimer recordTimer = new() { Interval = TimeSpan.FromSeconds(1) };

    public SchoolPage(ConsoleServices services, ConsoleWindow window) : base(services, window, "School")
    {
        Toolbar.Children.Add(SourceSwitch());
        Toolbar.Children.Add(ToolbarButton("", "New assignment", () => Editors.Todo(Window, Services.Planner, null, null, "school")));

        Body.Children.Add(Ui.Header("This week's classes"));
        Body.Children.Add(Ui.Card(week, new Thickness(8, 10, 8, 10)));

        Body.Children.Add(Ui.Header("Study with Hormes"));
        var actions = new WrapPanel();
        foreach (var (label, prompt) in new[]
        {
            ("Where was I?", "Catch me up so I can switch tasks fast: with the courses tool (list, then the newest files and transcripts) and the planner, tell me in a few sentences what I last worked on in each class, what is due next, and the one thing I should do right now."),
            ("Weekly review", "Run my weekly review: with the courses tool (each syllabus, recent lectures and transcripts) and the planner, tell me per class what we covered this week, what is coming next week, and what is due; then propose study blocks for next week and add them to my calendar only if I say yes."),
            ("Prep me for class", "My next class: find it in the planner, then use the courses tool to recap the most recent lecture slides for that course in a few sentences, say what is due next for it, and give me one good question to ask in class."),
            ("Help with homework", "Take the school assignment due soonest in the planner, find it in my course files with the courses tool, tell me what it asks, and point me to the lecture slides and pages that cover each part. Coach me toward my own answer; do not hand me the solutions."),
            ("Exam study guide", "For my next exam (planner events, or the syllabus in my course files), use the courses tool to build a one-page study guide from the lecture slides and homework, citing file and slide or page, then offer to quiz me."),
            ("Quiz me", "Pick the course with the work due soonest and quiz me from its lecture slides with the courses tool, one question at a time, telling me the slide each answer comes from."),
            ("Plan my week", "Look at my school assignments and classes for the next 7 days in the planner and my course files, and make me a realistic study plan, day by day. Add study blocks to my calendar only if I say yes."),
            ("What's due next?", "Using the planner and my course files, what school work is due next, and what should I start first?"),
        })
        {
            var b = Ui.Button(label, () => AskHormes(prompt), "PlainButton");
            b.Margin = new Thickness(0, 0, 8, 8);
            actions.Children.Add(b);
        }
        var folder = Ui.Button("Open course folder", OpenCourseFolder, "PlainButton");
        folder.Margin = new Thickness(0, 0, 8, 8);
        folder.ToolTip = "One folder per class (\"CS 161 - Operating Systems\"); put lecture slides, homework, exams and notes inside. Hormes reads PDF, PowerPoint, Word, notebooks, Markdown and code.";
        actions.Children.Add(folder);
        record = Ui.Button("Record lecture", ToggleRecording, "PlainButton");
        record.Margin = new Thickness(0, 0, 8, 8);
        record.ToolTip = "Transcribe a lecture or meeting on this PC into the course's Transcripts folder, so Hormes can answer from it. Ask before recording other people.";
        actions.Children.Add(record);
        recordTimer.Tick += (_, _) => record.Content = Services.Recorder.Recording ? $"Stop recording ({(int)Services.Recorder.Elapsed.TotalMinutes:00}:{Services.Recorder.Elapsed.Seconds:00})" : "Record lecture";
        Services.Recorder.Problem += p => Dispatcher.BeginInvoke(() => Window.ShowToast($"Recorder: {p}"));
        Body.Children.Add(actions);
        nudges.Content = "Class and homework reminders (morning brief, class in 15 minutes, homework due, exams ahead)";
        nudges.Margin = new Thickness(0, 4, 0, 8);
        nudges.Click += (_, _) => Services.SetEngineSetting("courseNudges", nudges.IsChecked == true);
        Body.Children.Add(nudges);

        Body.Children.Add(assignments);
    }

    private void AskHormes(string prompt)
    {
        Services.Ask(prompt);
        Window.ShowToast("Asked Hormes. The answer appears on Home and in the notch.");
    }

    /// <summary>Start: choose the course (or a meeting). Stop: write the last chunk, then ask Hormes for notes from it.</summary>
    private async void ToggleRecording()
    {
        var recorder = Services.Recorder;
        if (recorder.Recording)
        {
            recordTimer.Stop();
            record.Content = "Finishing transcript…";
            record.IsEnabled = false;
            var path = await recorder.StopAsync();
            record.IsEnabled = true;
            record.Content = "Record lecture";
            if (path is null) return;
            var name = System.IO.Path.GetFileName(path);
            AskHormes($"I just recorded {name}. Read it with the courses tool and give me clean notes: the main points, key definitions and formulas, and anything announced (deadlines, exams, changes). Offer to add any deadlines to my planner, only adding them if I say yes.");
            return;
        }
        var menu = new ContextMenu { PlacementTarget = record, Placement = PlacementMode.Bottom };
        void Item(string header, string? course, string title)
        {
            var item = new MenuItem { Header = header };
            item.Click += (_, _) =>
            {
                try
                {
                    recorder.Start(course, title);
                    recordTimer.Start();
                    Window.ShowToast($"Recording {title}. Transcribed on this PC; press Stop recording when it ends.");
                }
                catch (Exception ex) { Window.ShowToast($"Could not start recording: {ex.Message}"); }
            };
            menu.Items.Add(item);
        }
        foreach (var course in LectureRecorder.Courses()) Item(course, course, $"{course} lecture");
        if (menu.Items.Count > 0) menu.Items.Add(new Separator());
        Item("Meeting (no course)", null, "Meeting");
        menu.IsOpen = true;
    }

    /// <summary>The course library's root (the engine's default, or HORMES_COURSES_DIR), made on first use and opened in Explorer.</summary>
    private void OpenCourseFolder()
    {
        var root = Environment.GetEnvironmentVariable("HORMES_COURSES_DIR") is { Length: > 0 } custom
            ? custom
            : System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Hormes", "Courses");
        try
        {
            System.IO.Directory.CreateDirectory(root);
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("explorer.exe", $"\"{root}\"") { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            Window.ShowToast($"Could not open {root}: {ex.Message}");
        }
    }

    public void Refresh()
    {
        if (Services.Snapshot is { } snap && snap.TryGetProperty("settings", out var st) && st.TryGetProperty("courseNudges", out var on) && (on.ValueKind == System.Text.Json.JsonValueKind.True || on.ValueKind == System.Text.Json.JsonValueKind.False))
            nudges.IsChecked = on.GetBoolean();
        var s = Services.Planner.State;
        var today = Planner.Today;
        var first = CultureInfo.CurrentCulture.DateTimeFormat.FirstDayOfWeek;
        weekStart = today.AddDays(-(((int)today.DayOfWeek - (int)first + 7) % 7));
        var classes = Planner.Between(s.Events.Where(e => e.Category == "school"), weekStart, weekStart.AddDays(6)).Where(e => !e.AllDay || e.Recurrence is not null).ToList();

        var open = s.Todos.Where(t => !t.Done && (t.Category == "school" || t.CanvasId is not null)).OrderBy(t => t.Due ?? DateOnly.MaxValue).ThenBy(t => t.Title).ToList();
        var thisWeek = open.Count(t => t.Due is { } d && d <= today.AddDays(7));
        Subtitle.Text = $"{thisWeek} assignment{(thisWeek == 1 ? "" : "s")} due in the next 7 days · {classes.Count(c => c.Day >= today)} classes left this week";

        week.Children.Clear();
        for (var i = 0; i < 7; i++)
        {
            var day = weekStart.AddDays(i);
            var col = new StackPanel { Margin = new Thickness(6, 0, 6, 0) };
            var head = Ui.Text(day.ToString("ddd d", CultureInfo.CurrentCulture), "Headline");
            head.FontSize = 13;
            if (day == today) head.SetResourceReference(TextBlock.ForegroundProperty, "Red");
            else if (day < today) head.SetResourceReference(TextBlock.ForegroundProperty, "Tertiary");
            col.Children.Add(head);
            var todays = classes.Where(c => c.Day == day).ToList();
            if (todays.Count == 0) col.Children.Add(new TextBlock { Text = "—", Margin = new Thickness(0, 6, 0, 0), Foreground = (System.Windows.Media.Brush)FindResource("Tertiary") });
            foreach (var c in todays)
            {
                var block = new Border { CornerRadius = new CornerRadius(6), Padding = new Thickness(6, 4, 6, 4), Margin = new Thickness(0, 6, 0, 0), Background = Theme.Soft(Theme.Category("school"), day < today ? 0.10 : 0.22), Cursor = System.Windows.Input.Cursors.Hand };
                var stack = new StackPanel();
                var t = Ui.Text(c.Title, "Caption");
                t.FontWeight = FontWeights.SemiBold;
                t.SetResourceReference(TextBlock.ForegroundProperty, day < today ? "Secondary" : "Label");
                t.TextWrapping = TextWrapping.Wrap;
                stack.Children.Add(t);
                if (!c.AllDay) stack.Children.Add(Ui.Text(Planner.Clock(c.Start!.Value), "Caption"));
                block.Child = stack;
                var current = c;
                block.MouseLeftButtonUp += (_, _) => Editors.Event(Window, Services.Planner, current);
                col.Children.Add(block);
            }
            week.Children.Add(col);
        }

        assignments.Children.Clear();
        if (open.Count == 0)
        {
            assignments.Children.Add(Ui.Header("Assignments"));
            assignments.Children.Add(Ui.Card(Ui.Empty("No open assignments. School todos and Canvas assignments (synced through stits) show up here.")));
            return;
        }
        foreach (var (title, items) in new (string, List<PlannerTodo>)[]
        {
            ("Overdue", open.Where(t => t.Due < today).ToList()),
            ("Due this week", open.Where(t => t.Due >= today && t.Due <= today.AddDays(7)).ToList()),
            ("Later", open.Where(t => t.Due > today.AddDays(7)).ToList()),
            ("No due date", open.Where(t => t.Due is null).ToList()),
        })
        {
            if (items.Count == 0) continue;
            var header = Ui.Header(title);
            if (title == "Overdue") header.SetResourceReference(TextBlock.ForegroundProperty, "Red");
            assignments.Children.Add(header);
            assignments.Children.Add(Ui.Group(52, items.Take(40).Select(Row).ToArray()));
        }
    }

    private UIElement Row(PlannerTodo t)
    {
        var check = new CheckBox { IsChecked = t.Done, Foreground = Theme.Category("school"), Margin = new Thickness(0, 0, 14, 0), VerticalAlignment = VerticalAlignment.Center };
        check.SetResourceReference(StyleProperty, "RoundCheck");
        check.Click += (_, _) => Window.Run(Services.Planner.UpdateTodo(t.Id, new { done = check.IsChecked == true }), check.IsChecked == true ? $"Done: {t.Title}" : null);
        var text = new StackPanel();
        text.Children.Add(Ui.Text(t.Title, "Body"));
        var caption = Ui.Text(Editors.DueCaption(t), "Caption");
        if (t.Due < Planner.Today) caption.SetResourceReference(TextBlock.ForegroundProperty, "Red");
        text.Children.Add(caption);
        var due = t.Due is { } d ? $", due {Planner.Friendly(d).ToLowerInvariant()}" : "";
        var study = Ui.Button("Study", () => AskHormes($"Help me get started on \"{t.Title}\"{due}. Ask me what I already have, then give me the first concrete step."), "LinkButton");
        return Ui.Row(new DockPanel { Children = { check, text } }, study, () => Editors.Todo(Window, Services.Planner, t));
    }
}

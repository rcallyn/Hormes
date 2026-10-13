using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using Hormes.Windows.Model;

namespace Hormes.Windows.UI.Console;

/// <summary>The sheets that add and edit todos and events. Changes go to the planner; its broadcast redraws the pages.</summary>
public static class Editors
{
    private static readonly (string? Id, string Label)[] Priorities = { (null, "None"), ("low", "Low"), ("medium", "Medium"), ("high", "High") };

    public static void Todo(ConsoleWindow window, Planner planner, PlannerTodo? todo, DateOnly? defaultDue = null, string? defaultCategory = null)
    {
        var editing = todo is not null;
        var stack = new StackPanel();
        stack.Children.Add(Ui.Text(editing ? "Edit Todo" : "New Todo", "Title2"));

        var title = Ui.Field("Title");
        title.Text = todo?.Title ?? "";
        title.Margin = new Thickness(0, 14, 0, 8);
        stack.Children.Add(title);

        var notes = Ui.Field("Notes");
        notes.Text = todo?.Description ?? "";
        notes.AcceptsReturn = true;
        notes.TextWrapping = TextWrapping.Wrap;
        notes.MinHeight = 64;
        notes.VerticalContentAlignment = VerticalAlignment.Top;
        stack.Children.Add(notes);

        var due = Ui.Picker(new DatePicker { SelectedDate = (todo?.Due ?? defaultDue)?.ToDateTime(TimeOnly.MinValue), Width = 170 });
        var hasDue = new CheckBox { IsChecked = todo?.Due is not null || defaultDue is not null };
        hasDue.SetResourceReference(FrameworkElement.StyleProperty, "Switch");
        due.IsEnabled = hasDue.IsChecked == true;
        hasDue.Checked += (_, _) => { due.IsEnabled = true; due.SelectedDate ??= DateTime.Today; };
        hasDue.Unchecked += (_, _) => due.IsEnabled = false;

        var priority = Segmented(Priorities.Select(p => p.Label).ToArray(), Array.FindIndex(Priorities, p => p.Id == todo?.Priority) is var pi and >= 0 ? pi : 0);
        var category = CategoryPicker(todo?.Category ?? defaultCategory);

        stack.Children.Add(Labeled("Due date", Ui.HStack(10, hasDue, due)));
        stack.Children.Add(Labeled("Priority", priority.Bar));
        stack.Children.Add(Labeled("Category", category));
        if (todo?.CanvasId is not null) stack.Children.Add(Note("From Canvas: stits' Canvas sync keeps this one up to date."));

        var error = Ui.Text("", "Caption");
        error.SetResourceReference(TextBlock.ForegroundProperty, "Red");
        stack.Children.Add(error);

        async void Save()
        {
            var t = title.Text.Trim();
            if (t.Length == 0) { error.Text = "Give it a title."; return; }
            var dueDate = hasDue.IsChecked == true && due.SelectedDate is { } d ? Planner.Iso(DateOnly.FromDateTime(d)) : null;
            var prio = Priorities[priority.Index].Id;
            var cat = category.SelectedValue as string;
            var desc = notes.Text.Trim();
            (bool Ok, string? Error, string? Id) r;
            if (todo is null)
            {
                var input = new Dictionary<string, object> { ["title"] = t };
                if (desc.Length > 0) input["description"] = desc;
                if (dueDate is not null) input["dueDate"] = dueDate;
                if (prio is not null) input["priority"] = prio;
                if (cat is not null) input["category"] = cat;
                r = await planner.AddTodo(input);
            }
            else
            {
                r = await planner.UpdateTodo(todo.Id, new Dictionary<string, object?>
                {
                    ["title"] = t, ["description"] = desc.Length > 0 ? desc : null, ["dueDate"] = dueDate, ["priority"] = prio, ["category"] = cat,
                });
            }
            if (r.Ok) window.CloseSheet();
            else error.Text = r.Error ?? "Could not save.";
        }

        stack.Children.Add(Buttons(window, Save, editing ? () => { window.Run(planner.DeleteTodo(todo!.Id), "Deleted"); window.CloseSheet(); } : null));
        title.KeyDown += (_, e) => { if (e.Key == System.Windows.Input.Key.Enter) Save(); };
        window.ShowSheet(stack);
        title.Loaded += (_, _) => { title.Focus(); title.SelectAll(); };
    }

    private static readonly (string? Freq, string Label)[] Repeats = { (null, "Never"), ("daily", "Daily"), ("weekly", "Weekly"), ("monthly", "Monthly") };

    public static void Event(ConsoleWindow window, Planner planner, PlannerEvent? ev, DateOnly? day = null, TimeOnly? at = null)
    {
        // An occurrence edits its series, as in stits.
        var editing = ev is not null;
        var baseId = ev?.Id.Split("::")[0];
        var series = ev is null ? null : planner.State.Events.FirstOrDefault(e => e.Id == baseId) ?? ev;
        var stack = new StackPanel();
        stack.Children.Add(Ui.Text(editing ? (series?.Recurrence is not null ? "Edit Repeating Event" : "Edit Event") : "New Event", "Title2"));

        var title = Ui.Field("Title");
        title.Text = series?.Title ?? "";
        title.Margin = new Thickness(0, 14, 0, 8);
        stack.Children.Add(title);

        var date = Ui.Picker(new DatePicker { SelectedDate = (series?.Day ?? day ?? Planner.Today).ToDateTime(TimeOnly.MinValue), Width = 170 });
        var allDay = new CheckBox { IsChecked = series is not null ? series.AllDay : at is null };
        allDay.SetResourceReference(FrameworkElement.StyleProperty, "Switch");
        var start = TimePicker(series?.Start ?? at ?? new TimeOnly(9, 0));
        var end = TimePicker(series?.End ?? (at ?? new TimeOnly(9, 0)).AddHours(1));
        var times = Ui.HStack(8, start, Ui.Text("to", "Caption"), end);
        void Show() => times.Visibility = allDay.IsChecked == true ? Visibility.Collapsed : Visibility.Visible;
        allDay.Checked += (_, _) => Show();
        allDay.Unchecked += (_, _) => Show();
        Show();
        start.SelectionChanged += (_, _) =>
        {
            if (start.SelectedValue is TimeOnly s && end.SelectedValue is TimeOnly e && e <= s) end.SelectedValue = Round(s.AddHours(1));
        };

        var repeat = Segmented(Repeats.Select(r => r.Label).ToArray(), Array.FindIndex(Repeats, r => r.Freq == series?.Recurrence?.Freq) is var ri and >= 0 ? ri : 0);
        var until = Ui.Picker(new DatePicker { SelectedDate = Planner.ParseDate(series?.Recurrence?.Until)?.ToDateTime(TimeOnly.MinValue), Width = 170 });
        var untilRow = Labeled("Until", until);
        void ShowUntil() => untilRow.Visibility = repeat.Index == 0 ? Visibility.Collapsed : Visibility.Visible;
        repeat.Changed += ShowUntil;
        ShowUntil();
        var category = CategoryPicker(series?.Category);

        stack.Children.Add(Labeled("Date", date));
        stack.Children.Add(Labeled("All day", allDay));
        stack.Children.Add(Labeled("Time", times));
        stack.Children.Add(Labeled("Repeat", repeat.Bar));
        stack.Children.Add(untilRow);
        stack.Children.Add(Labeled("Category", category));
        if (series?.Recurrence is not null) stack.Children.Add(Note("Changes apply to every occurrence."));
        if (series?.TodoId is not null) stack.Children.Add(Note("Scheduled from a todo."));

        var error = Ui.Text("", "Caption");
        error.SetResourceReference(TextBlock.ForegroundProperty, "Red");
        stack.Children.Add(error);

        async void Save()
        {
            var t = title.Text.Trim();
            if (t.Length == 0) { error.Text = "Give it a title."; return; }
            if (date.SelectedDate is not { } d) { error.Text = "Pick a date."; return; }
            var timed = allDay.IsChecked != true;
            var s = start.SelectedValue as TimeOnly?;
            var e2 = end.SelectedValue as TimeOnly?;
            if (timed && (s is null || e2 is null)) { error.Text = "Pick a start and end time."; return; }
            var freq = Repeats[repeat.Index].Freq;
            Dictionary<string, object>? recurrence = null;
            if (freq is not null)
            {
                recurrence = new Dictionary<string, object> { ["freq"] = freq, ["interval"] = series?.Recurrence?.Interval ?? 1 };
                if (until.SelectedDate is { } u) recurrence["until"] = Planner.Iso(DateOnly.FromDateTime(u));
                // Skipped days (holidays) stay skipped when the series is edited.
                if (series?.Recurrence?.Exceptions is { Count: > 0 } skipped) recurrence["exceptions"] = skipped;
            }
            var fields = new Dictionary<string, object?>
            {
                ["title"] = t,
                ["date"] = Planner.Iso(DateOnly.FromDateTime(d)),
                ["time"] = timed ? Planner.Hm(s!.Value) : "",
                ["endTime"] = timed ? Planner.Hm(e2!.Value) : null,
                ["category"] = category.SelectedValue as string,
                ["recurrence"] = recurrence,
            };
            (bool Ok, string? Error, string? Id) r;
            if (series is null)
            {
                foreach (var k in fields.Where(kv => kv.Value is null).Select(kv => kv.Key).ToList()) fields.Remove(k);
                r = await planner.AddEvent(fields);
            }
            else r = await planner.UpdateEvent(series.Id, fields);
            if (r.Ok) window.CloseSheet();
            else error.Text = r.Error ?? "Could not save.";
        }

        stack.Children.Add(Buttons(window, Save, editing ? () => { window.Run(planner.DeleteEvent(series!.Id), "Deleted"); window.CloseSheet(); } : null));
        title.KeyDown += (_, e) => { if (e.Key == System.Windows.Input.Key.Enter) Save(); };
        window.ShowSheet(stack);
        title.Loaded += (_, _) => { title.Focus(); title.SelectAll(); };
    }

    // ------------------------------------------------------------------ pieces

    public sealed class SegmentedChoice
    {
        public required Border Bar { get; init; }
        public int Index { get; set; }
        public event Action? Changed;
        internal void Raise() => Changed?.Invoke();
        internal List<RadioButton> Buttons { get; } = new();
        private bool quiet;

        /// <summary>Show a choice made elsewhere, without raising Changed.</summary>
        public void Select(int index)
        {
            if (index == Index) return;
            quiet = true;
            Buttons[index].IsChecked = true;
            Index = index;
            quiet = false;
        }

        internal void Pick(int index)
        {
            Index = index;
            if (!quiet) Raise();
        }
    }

    public static SegmentedChoice Segmented(string[] labels, int selected)
    {
        var bar = new Border { HorizontalAlignment = HorizontalAlignment.Left };
        bar.SetResourceReference(FrameworkElement.StyleProperty, "SegmentBar");
        var stack = new StackPanel { Orientation = Orientation.Horizontal };
        var choice = new SegmentedChoice { Bar = bar, Index = selected };
        var group = $"seg{Guid.NewGuid():N}";
        for (var i = 0; i < labels.Length; i++)
        {
            var index = i;
            var rb = new RadioButton { Content = labels[i], GroupName = group, IsChecked = i == selected };
            rb.SetResourceReference(FrameworkElement.StyleProperty, "Segment");
            rb.Checked += (_, _) => choice.Pick(index);
            choice.Buttons.Add(rb);
            stack.Children.Add(rb);
        }
        bar.Child = stack;
        return choice;
    }

    private static ComboBox CategoryPicker(string? selected)
    {
        var box = Ui.Picker(new ComboBox { Width = 170, HorizontalAlignment = HorizontalAlignment.Left, DisplayMemberPath = "Label", SelectedValuePath = "Id" });
        box.Items.Add(new { Id = (string?)null, Label = "None" });
        foreach (var (id, label) in Planner.Categories) box.Items.Add(new { Id = (string?)id, Label = label });
        box.SelectedValue = selected;
        if (box.SelectedIndex < 0) box.SelectedIndex = 0;
        return box;
    }

    private static ComboBox TimePicker(TimeOnly value)
    {
        var box = Ui.Picker(new ComboBox { Width = 120, IsEditable = false, MaxDropDownHeight = 300 });
        for (var m = 0; m < 24 * 60; m += 15)
        {
            var t = new TimeOnly(m / 60, m % 60);
            box.Items.Add(new ComboBoxItem { Content = Planner.Clock(t), Tag = t });
        }
        box.SelectedValuePath = "Tag";
        box.SelectedValue = Round(value);
        return box;
    }

    private static TimeOnly Round(TimeOnly t) => new(t.Hour, t.Minute / 15 * 15);

    private static FrameworkElement Labeled(string label, UIElement control)
    {
        var grid = new Grid { Margin = new Thickness(0, 10, 0, 0) };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(100) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        var l = Ui.Text(label, "Body");
        l.VerticalAlignment = VerticalAlignment.Center;
        l.SetResourceReference(TextBlock.ForegroundProperty, "Secondary");
        grid.Children.Add(l);
        Grid.SetColumn(control, 1);
        if (control is FrameworkElement fe) fe.HorizontalAlignment = HorizontalAlignment.Left;
        grid.Children.Add(control);
        return grid;
    }

    private static TextBlock Note(string text)
    {
        var t = Ui.Text(text, "Caption");
        t.Margin = new Thickness(0, 12, 0, 0);
        t.TextWrapping = TextWrapping.Wrap;
        return t;
    }

    private static FrameworkElement Buttons(ConsoleWindow window, Action save, Action? delete)
    {
        var grid = new Grid { Margin = new Thickness(0, 20, 0, 0) };
        if (delete is not null)
        {
            var del = Ui.Button("Delete", delete, "LinkButton");
            del.SetResourceReference(Control.ForegroundProperty, "Red");
            del.HorizontalAlignment = HorizontalAlignment.Left;
            grid.Children.Add(del);
        }
        var right = Ui.HStack(8, Ui.Button("Cancel", window.CloseSheet), Ui.Button("Save", save, "AccentButton"));
        right.HorizontalAlignment = HorizontalAlignment.Right;
        grid.Children.Add(right);
        return grid;
    }

    public static string DueCaption(PlannerTodo t)
    {
        var parts = new List<string>();
        if (t.Due is { } d) parts.Add(Planner.Friendly(d));
        if (t.Category is { } c) parts.Add(Planner.CategoryLabel(c));
        if (t.CanvasId is not null) parts.Add("Canvas");
        if (t.Subtasks is { Count: > 0 } subs) parts.Add($"{subs.Count(s => s.Done)}/{subs.Count} subtasks");
        return string.Join(" · ", parts);
    }

    public static string PriorityMark(string? p) => p switch { "high" => "!!! ", "medium" => "!! ", "low" => "! ", _ => "" };

    public static string TimeRange(PlannerEvent e) =>
        e.AllDay ? "All day" : $"{Planner.Clock(e.Start!.Value)} – {Planner.Clock(e.End!.Value)}";

    public static CultureInfo Culture => CultureInfo.CurrentCulture;
}

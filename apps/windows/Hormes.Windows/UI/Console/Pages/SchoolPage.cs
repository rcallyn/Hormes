using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using Hormes.Windows.Model;

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
            ("Plan my week", "Look at my school assignments and classes for the next 7 days in the planner and make me a realistic study plan, day by day. Add study blocks to my calendar only if I say yes."),
            ("What's due next?", "Using the planner, what school work is due next, and what should I start first?"),
            ("Quiz me", "Pick the assignment due soonest in my planner and quiz me on its topic, one question at a time."),
        })
        {
            var b = Ui.Button(label, () => AskHormes(prompt), "PlainButton");
            b.Margin = new Thickness(0, 0, 8, 8);
            actions.Children.Add(b);
        }
        Body.Children.Add(actions);

        Body.Children.Add(assignments);
    }

    private void AskHormes(string prompt)
    {
        Services.Ask(prompt);
        Window.ShowToast("Asked Hormes. The answer appears on Home and in the notch.");
    }

    public void Refresh()
    {
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

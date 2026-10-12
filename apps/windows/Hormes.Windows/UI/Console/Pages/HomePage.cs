using System;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using Hormes.Windows.Model;

namespace Hormes.Windows.UI.Console.Pages;

/// <summary>Home: a greeting, today's schedule, what is due, and a place to ask Hormes with the conversation so far.</summary>
public sealed class HomePage : PageFrame, IConsolePage
{
    private readonly StackPanel today = new();
    private readonly StackPanel due = new();
    private readonly StackPanel conversation = new();
    private readonly TextBox ask;

    public HomePage(ConsoleServices services, ConsoleWindow window) : base(services, window, "Home")
    {
        var columns = new Grid();
        columns.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        columns.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(18) });
        columns.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        var left = Section("Today", today, "Calendar");
        var right = Section("Due", due, "Todos");
        Grid.SetColumn(right, 2);
        columns.Children.Add(left);
        columns.Children.Add(right);
        Body.Children.Add(columns);

        // Ask Hormes: typed here, answered by Claude (and spoken, when replies are on).
        Body.Children.Add(Ui.Text("Ask Hormes", "SectionHeader"));
        ask = Ui.Field("Ask anything, or say \"remind me to…\"");
        ask.KeyDown += (_, e) => { if (e.Key == System.Windows.Input.Key.Enter) Send(); };
        var mic = Ui.Button("", () => Services.Voice.Toggle(), "IconButton");
        mic.ToolTip = "Talk (or clap twice)";
        var send = Ui.Button("Send", Send, "AccentButton");
        var bar = new Grid();
        bar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        bar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        bar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        bar.Children.Add(ask);
        Grid.SetColumn(mic, 1);
        mic.Margin = new Thickness(8, 0, 0, 0);
        bar.Children.Add(mic);
        Grid.SetColumn(send, 2);
        send.Margin = new Thickness(8, 0, 0, 0);
        bar.Children.Add(send);
        var card = new StackPanel();
        card.Children.Add(bar);
        conversation.Margin = new Thickness(0, 10, 0, 0);
        card.Children.Add(conversation);
        Body.Children.Add(Ui.Card(card));
    }

    private FrameworkElement Section(string title, StackPanel list, string page)
    {
        var stack = new StackPanel();
        var head = new Grid();
        var t = Ui.Text(title, "SectionHeader");
        head.Children.Add(t);
        var more = Ui.Button("Show all", () => Window.Navigate(page), "LinkButton");
        more.HorizontalAlignment = HorizontalAlignment.Right;
        more.Margin = new Thickness(0, 12, 0, 4);
        head.Children.Add(more);
        stack.Children.Add(head);
        stack.Children.Add(Ui.Card(list, new Thickness(0, 4, 0, 4)));
        return stack;
    }

    private void Send()
    {
        var text = ask.Text.Trim();
        if (text.Length == 0) return;
        ask.Clear();
        Services.Ask(text);
    }

    public void Refresh()
    {
        var hour = DateTime.Now.Hour;
        var greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
        TitleText.Text = Services.UserName is { Length: > 0 } name ? $"{greeting}, {name}" : greeting;
        var state = Services.Planner.State;
        var todayDate = Planner.Today;
        var events = Planner.Between(state.Events, todayDate, todayDate);
        var open = state.Todos.Where(t => !t.Done).ToList();
        var dueSoon = open.Where(t => t.Due is { } d && d <= todayDate.AddDays(1)).OrderBy(t => t.Due).ThenBy(t => PriorityRank(t.Priority)).ToList();
        var overdue = dueSoon.Count(t => t.Due < todayDate);
        Subtitle.Text = $"{DateTime.Now.ToString("dddd, MMMM d", CultureInfo.CurrentCulture)} · {Count(events.Count, "event")} · {Count(dueSoon.Count, "todo")} due{(overdue > 0 ? $" ({overdue} overdue)" : "")}";

        today.Children.Clear();
        if (events.Count == 0) today.Children.Add(Ui.Empty("Nothing on the calendar today."));
        foreach (var e in events.Take(9))
        {
            var bar = new Border { Width = 4, CornerRadius = new CornerRadius(2), Background = Theme.Category(e.Category), Margin = new Thickness(0, 1, 10, 1) };
            var text = new StackPanel();
            text.Children.Add(Ui.Text(e.Title, "Body"));
            text.Children.Add(Ui.Text(Editors.TimeRange(e) + (e.Category is { } c ? " · " + Planner.CategoryLabel(c) : ""), "Caption"));
            var current = e;
            today.Children.Add(Ui.Row(new DockPanel { Children = { bar, text } }, null, () => Editors.Event(Window, Services.Planner, current)));
        }
        if (events.Count > 9) today.Children.Add(Ui.Empty($"+{events.Count - 9} more"));

        due.Children.Clear();
        if (dueSoon.Count == 0) due.Children.Add(Ui.Empty("Nothing due today or tomorrow."));
        foreach (var t in dueSoon.Take(9)) due.Children.Add(TodoRow(t));
        if (dueSoon.Count > 9) due.Children.Add(Ui.Empty($"+{dueSoon.Count - 9} more"));

        RenderConversation();
    }

    private UIElement TodoRow(PlannerTodo t)
    {
        var check = new CheckBox { IsChecked = t.Done, Foreground = Theme.Category(t.Category), Margin = new Thickness(0, 0, 12, 0), VerticalAlignment = VerticalAlignment.Center };
        check.SetResourceReference(StyleProperty, "RoundCheck");
        check.Click += (_, _) => Window.Run(Services.Planner.UpdateTodo(t.Id, new { done = check.IsChecked == true }));
        var text = new StackPanel();
        text.Children.Add(Ui.Text(Editors.PriorityMark(t.Priority) + t.Title, "Body"));
        var caption = Ui.Text(Editors.DueCaption(t), "Caption");
        if (t.Due < Planner.Today) caption.SetResourceReference(TextBlock.ForegroundProperty, "Red");
        text.Children.Add(caption);
        return Ui.Row(new DockPanel { Children = { check, text } }, null, () => Editors.Todo(Window, Services.Planner, t));
    }

    private void RenderConversation()
    {
        conversation.Children.Clear();
        if (Services.Snapshot is not { } s || !s.TryGetProperty("transcript", out var tr) || tr.ValueKind != JsonValueKind.Array || tr.GetArrayLength() == 0)
        {
            conversation.Children.Add(Ui.Text("Ask about your day, add a todo (\"remind me to call Tazeem at five\"), or anything else. Clap twice to talk.", "Caption"));
            return;
        }
        var items = tr.EnumerateArray().TakeLast(6).ToList();
        foreach (var item in items)
        {
            var mine = item.TryGetProperty("speaker", out var sp) && sp.GetString() == "user";
            var text = item.TryGetProperty("text", out var tx) ? tx.GetString() ?? "" : "";
            if (text.Length == 0) continue;
            var bubble = new Border
            {
                CornerRadius = new CornerRadius(14),
                Padding = new Thickness(12, 7, 12, 7),
                Margin = new Thickness(mine ? 80 : 0, 4, mine ? 0 : 80, 0),
                HorizontalAlignment = mine ? HorizontalAlignment.Right : HorizontalAlignment.Left,
            };
            bubble.SetResourceReference(Border.BackgroundProperty, mine ? "Accent" : "Fill");
            var body = Ui.Text(text, "Body");
            body.TextWrapping = TextWrapping.Wrap;
            body.TextTrimming = TextTrimming.None;
            if (mine) body.Foreground = System.Windows.Media.Brushes.White;
            bubble.Child = body;
            conversation.Children.Add(bubble);
        }
    }

    private static int PriorityRank(string? p) => p switch { "high" => 0, "medium" => 1, "low" => 2, _ => 3 };
    private static string Count(int n, string noun) => $"{n} {noun}{(n == 1 ? "" : "s")}";
}

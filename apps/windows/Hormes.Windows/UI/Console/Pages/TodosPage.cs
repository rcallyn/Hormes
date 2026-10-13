using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using Hormes.Windows.Model;

namespace Hormes.Windows.UI.Console.Pages;

/// <summary>
/// Todos, the way Reminders lays them out: four smart lists (Today, Scheduled, All, Completed) as tiles with counts,
/// category chips, sections by date, round checkboxes in the category's colour, and a quick-add field.
/// </summary>
public sealed class TodosPage : PageFrame, IConsolePage
{
    private enum Filter { Today, Scheduled, All, Completed }

    private Filter filter = Filter.Today;
    private string? category;
    private readonly UniformGrid tiles = new() { Columns = 4, Margin = new Thickness(-5, 0, -5, 0) };
    private readonly WrapPanel chips = new() { Margin = new Thickness(0, 12, 0, 0) };
    private readonly StackPanel list = new();
    private readonly TextBox quick;

    public TodosPage(ConsoleServices services, ConsoleWindow window) : base(services, window, "Todos")
    {
        Toolbar.Children.Add(SourceSwitch());
        Toolbar.Children.Add(ToolbarButton("", "Refresh", () => Window.Run(Services.Planner.Refresh())));
        Toolbar.Children.Add(ToolbarButton("", "New todo", () => Editors.Todo(Window, Services.Planner, null, filter == Filter.Today ? Planner.Today : null, category)));

        Body.Children.Add(tiles);
        Body.Children.Add(chips);
        quick = Ui.Field("New todo — press Enter");
        quick.Margin = new Thickness(0, 16, 0, 0);
        quick.KeyDown += (_, e) =>
        {
            if (e.Key != System.Windows.Input.Key.Enter) return;
            var title = quick.Text.Trim();
            if (title.Length == 0) return;
            quick.Clear();
            var todo = new Dictionary<string, object> { ["title"] = title };
            if (filter == Filter.Today) todo["dueDate"] = Planner.Iso(Planner.Today);
            if (category is not null) todo["category"] = category;
            Window.Run(Services.Planner.AddTodo(todo));
        };
        Body.Children.Add(quick);
        Body.Children.Add(list);
    }

    public void Refresh()
    {
        var s = Services.Planner.State;
        var today = Planner.Today;
        var open = s.Todos.Where(t => !t.Done).ToList();
        Subtitle.Text = (s.Source == "stits" ? "Synced with stits" : "On this PC") + (s.Error is { } e ? " · " + e : $" · {open.Count} open");

        tiles.Children.Clear();
        tiles.Children.Add(Tile(Filter.Today, "", "Accent", open.Count(t => t.Due is { } d && d <= today)));
        tiles.Children.Add(Tile(Filter.Scheduled, "", "Red", open.Count(t => t.Due is not null)));
        tiles.Children.Add(Tile(Filter.All, "", "Secondary", open.Count));
        tiles.Children.Add(Tile(Filter.Completed, "", "Green", s.Todos.Count(t => t.Done)));

        chips.Children.Clear();
        chips.Children.Add(Chip(null, "All categories"));
        foreach (var (id, label) in Planner.Categories)
            if (s.Todos.Any(t => t.Category == id)) chips.Children.Add(Chip(id, label));

        var shown = (filter switch
        {
            Filter.Today => open.Where(t => t.Due is { } d && d <= today),
            Filter.Scheduled => open.Where(t => t.Due is not null),
            Filter.Completed => s.Todos.Where(t => t.Done).OrderByDescending(t => t.CompletedAt),
            _ => open,
        }).Where(t => category is null || t.Category == category).ToList();

        list.Children.Clear();
        if (shown.Count == 0)
        {
            list.Children.Add(Ui.Card(Ui.Empty(filter switch
            {
                Filter.Today => "Nothing due today. Enjoy it.",
                Filter.Completed => "Nothing completed yet.",
                _ => "No todos here.",
            })));
            list.Children[0].SetValue(MarginProperty, new Thickness(0, 16, 0, 0));
            return;
        }
        foreach (var (title, items) in Sections(shown, filter, today))
        {
            var header = Ui.Header(title);
            if (title == "Overdue") header.SetResourceReference(TextBlock.ForegroundProperty, "Red");
            list.Children.Add(header);
            list.Children.Add(Ui.Group(52, items.Select(Row).ToArray()));
        }
    }

    private static IEnumerable<(string, List<PlannerTodo>)> Sections(List<PlannerTodo> todos, Filter filter, DateOnly today)
    {
        if (filter == Filter.Completed)
        {
            yield return ("Completed", todos.Take(150).ToList());
            yield break;
        }
        static int Rank(string? p) => p switch { "high" => 0, "medium" => 1, "low" => 2, _ => 3 };
        var ordered = todos.OrderBy(t => t.Due ?? DateOnly.MaxValue).ThenBy(t => Rank(t.Priority)).ThenBy(t => t.Title).ToList();
        var groups = new (string Title, Func<PlannerTodo, bool> In)[]
        {
            ("Overdue", t => t.Due < today),
            ("Today", t => t.Due == today),
            ("Tomorrow", t => t.Due == today.AddDays(1)),
            ("This week", t => t.Due > today.AddDays(1) && t.Due <= today.AddDays(7)),
            ("Later", t => t.Due > today.AddDays(7)),
            ("No date", t => t.Due is null),
        };
        foreach (var (title, test) in groups)
        {
            var items = ordered.Where(test).ToList();
            if (items.Count > 0) yield return (title, items);
        }
    }

    private UIElement Row(PlannerTodo t)
    {
        var check = new CheckBox { IsChecked = t.Done, Foreground = Theme.Category(t.Category), Margin = new Thickness(0, 0, 14, 0), VerticalAlignment = VerticalAlignment.Center };
        check.SetResourceReference(StyleProperty, "RoundCheck");
        check.Click += (_, _) => Window.Run(Services.Planner.UpdateTodo(t.Id, new { done = check.IsChecked == true }));
        var text = new StackPanel();
        var title = Ui.Text(Editors.PriorityMark(t.Priority) + t.Title, "Body");
        if (t.Done) title.SetResourceReference(TextBlock.ForegroundProperty, "Secondary");
        text.Children.Add(title);
        var captionText = Editors.DueCaption(t);
        if (t.Description is { Length: > 0 } d) captionText = (captionText.Length > 0 ? captionText + " · " : "") + d.Split('\n')[0];
        if (captionText.Length > 0)
        {
            var caption = Ui.Text(captionText, "Caption");
            if (!t.Done && t.Due < Planner.Today) caption.SetResourceReference(TextBlock.ForegroundProperty, "Red");
            text.Children.Add(caption);
        }
        var info = Ui.Button("", () => Editors.Todo(Window, Services.Planner, t), "IconButton");
        info.ToolTip = "Details";
        return Ui.Row(new DockPanel { Children = { check, text } }, info, () => Editors.Todo(Window, Services.Planner, t));
    }

    private UIElement Tile(Filter f, string glyph, string brush, int count)
    {
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var icon = new Border { Width = 30, Height = 30, CornerRadius = new CornerRadius(15), HorizontalAlignment = HorizontalAlignment.Left };
        icon.SetResourceReference(Border.BackgroundProperty, brush);
        var g = Ui.Glyph(glyph, 14);
        g.Foreground = System.Windows.Media.Brushes.White;
        g.HorizontalAlignment = HorizontalAlignment.Center;
        icon.Child = g;
        var left = new StackPanel();
        left.Children.Add(icon);
        var label = Ui.Text(f.ToString(), "Headline");
        label.Margin = new Thickness(0, 8, 0, 0);
        label.SetResourceReference(TextBlock.ForegroundProperty, "Secondary");
        left.Children.Add(label);
        grid.Children.Add(left);
        var n = Ui.Text(count.ToString(), "LargeTitle");
        n.FontSize = 26;
        Grid.SetColumn(n, 1);
        grid.Children.Add(n);
        var card = Ui.Card(grid, new Thickness(14, 12, 14, 10));
        card.Margin = new Thickness(5, 0, 5, 0);
        card.Cursor = System.Windows.Input.Cursors.Hand;
        if (filter == f)
        {
            card.SetResourceReference(Border.BorderBrushProperty, brush);
            card.BorderThickness = new Thickness(2);
        }
        card.MouseLeftButtonUp += (_, _) => { filter = f; Refresh(); };
        return card;
    }

    private UIElement Chip(string? id, string label)
    {
        var selected = category == id;
        var b = new Border { CornerRadius = new CornerRadius(14), Padding = new Thickness(12, 5, 12, 5), Margin = new Thickness(0, 0, 8, 8), Cursor = System.Windows.Input.Cursors.Hand };
        b.SetResourceReference(Border.BackgroundProperty, selected ? "Accent" : "Card");
        var row = new StackPanel { Orientation = Orientation.Horizontal };
        if (id is not null) row.Children.Add(new System.Windows.Shapes.Ellipse { Width = 8, Height = 8, Fill = Theme.Category(id), Margin = new Thickness(0, 0, 6, 0), VerticalAlignment = VerticalAlignment.Center });
        var t = Ui.Text(label, "Body");
        t.FontSize = 13;
        if (selected) t.Foreground = System.Windows.Media.Brushes.White;
        row.Children.Add(t);
        b.Child = row;
        b.MouseLeftButtonUp += (_, _) => { category = id; Refresh(); };
        return b;
    }
}

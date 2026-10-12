using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shapes;
using System.Windows.Threading;
using Hormes.Windows.Model;

namespace Hormes.Windows.UI.Console.Pages;

/// <summary>
/// Calendar, the way Apple's lays it out: Day, Week and Month. Day and Week are a time grid (an all-day strip on top,
/// overlapping events side by side, a red line at the current time); Month is a grid of days with event pills. Click
/// an event to edit it; double-click an empty slot (or a day in Month) to add one there.
/// </summary>
public sealed class CalendarPage : PageFrame, IConsolePage
{
    private enum View { Day, Week, Month }

    private const double HourHeight = 48;
    private const double Gutter = 58;
    private View view = View.Week;
    private DateOnly anchor = Planner.Today;
    private readonly Grid content = new();
    private readonly DispatcherTimer minute = new() { Interval = TimeSpan.FromMinutes(1) };
    private ScrollViewer? gridScroll;
    private readonly Editors.SegmentedChoice viewChoice;
    private double? keepScroll;

    public CalendarPage(ConsoleServices services, ConsoleWindow window) : base(services, window, "Calendar", scroll: false)
    {
        var seg = viewChoice = Editors.Segmented(new[] { "Day", "Week", "Month" }, 1);
        seg.Bar.Margin = new Thickness(0, 0, 12, 0);
        seg.Changed += () => { view = (View)seg.Index; keepScroll = null; Refresh(); };
        Toolbar.Children.Add(seg.Bar);
        Toolbar.Children.Add(SourceSwitch());
        Toolbar.Children.Add(ToolbarButton("", "Previous", () => Step(-1)));
        var todayButton = Ui.Button("Today", () => { anchor = Planner.Today; Refresh(); });
        todayButton.Margin = new Thickness(4, 0, 4, 0);
        Toolbar.Children.Add(todayButton);
        Toolbar.Children.Add(ToolbarButton("", "Next", () => Step(1)));
        Toolbar.Children.Add(ToolbarButton("", "New event", () => Editors.Event(Window, Services.Planner, null, anchor)));

        content.Margin = new Thickness(0, 0, 0, 20);
        Grid.SetRow(content, 1);
        Root.Children.Add(content);
        minute.Tick += (_, _) => { if (IsVisible) Refresh(); };
        IsVisibleChanged += (_, _) => { if (IsVisible) minute.Start(); else minute.Stop(); };
    }

    /// <summary>The checks render each view: 0 Day, 1 Week, 2 Month.</summary>
    internal void ShowView(int index)
    {
        view = (View)index;
        Refresh();
    }

    private void Step(int dir)
    {
        anchor = view switch
        {
            View.Day => anchor.AddDays(dir),
            View.Week => anchor.AddDays(7 * dir),
            _ => anchor.AddMonths(dir),
        };
        Refresh();
    }

    private static DateOnly WeekStart(DateOnly d)
    {
        var first = CultureInfo.CurrentCulture.DateTimeFormat.FirstDayOfWeek;
        var diff = ((int)d.DayOfWeek - (int)first + 7) % 7;
        return d.AddDays(-diff);
    }

    public void Refresh()
    {
        var s = Services.Planner.State;
        if (gridScroll is not null) keepScroll = gridScroll.VerticalOffset;
        content.Children.Clear();
        gridScroll = null;
        viewChoice.Select((int)view);
        switch (view)
        {
            case View.Month:
                TitleText.Text = anchor.ToString("MMMM yyyy", CultureInfo.CurrentCulture);
                content.Children.Add(Month(s));
                break;
            case View.Day:
                TitleText.Text = anchor.ToString("MMMM d, yyyy", CultureInfo.CurrentCulture);
                content.Children.Add(TimeGrid(s, new[] { anchor }));
                break;
            default:
                var start = WeekStart(anchor);
                var end = start.AddDays(6);
                TitleText.Text = start.Month == end.Month ? start.ToString("MMMM yyyy", CultureInfo.CurrentCulture) : $"{start:MMM} – {end:MMM yyyy}";
                content.Children.Add(TimeGrid(s, Enumerable.Range(0, 7).Select(i => start.AddDays(i)).ToArray()));
                break;
        }
        Subtitle.Text = (s.Source == "stits" ? "Synced with stits" : "On this PC") + (s.Error is { } e ? " · " + e : "");
    }

    // ------------------------------------------------------------------ day and week

    private FrameworkElement TimeGrid(PlannerState s, DateOnly[] days)
    {
        var events = Planner.Between(s.Events, days[0], days[^1]);
        var outer = new Grid();
        outer.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        outer.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        outer.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

        Grid Columns()
        {
            var g = new Grid();
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(Gutter) });
            foreach (var _ in days) g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            return g;
        }

        // Day headers: "Mon 12", today's number in a red circle.
        var head = Columns();
        for (var i = 0; i < days.Length; i++)
        {
            var d = days[i];
            var isToday = d == Planner.Today;
            var label = Ui.Text(d.ToString("ddd", CultureInfo.CurrentCulture), "Caption");
            label.HorizontalAlignment = HorizontalAlignment.Center;
            var number = new Border { Width = 30, Height = 30, CornerRadius = new CornerRadius(15), HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 2, 0, 6) };
            if (isToday) number.SetResourceReference(Border.BackgroundProperty, "Red");
            var n = Ui.Text(d.Day.ToString(CultureInfo.CurrentCulture), "Title2");
            n.FontSize = 17;
            n.HorizontalAlignment = HorizontalAlignment.Center;
            n.VerticalAlignment = VerticalAlignment.Center;
            if (isToday) n.Foreground = Brushes.White;
            number.Child = n;
            var cell = new StackPanel { Cursor = Cursors.Hand };
            cell.Children.Add(label);
            cell.Children.Add(number);
            var day = d;
            cell.MouseLeftButtonUp += (_, _) => { if (view == View.Week) { anchor = day; view = View.Day; Refresh(); } };
            Grid.SetColumn(cell, i + 1);
            head.Children.Add(cell);
        }
        outer.Children.Add(head);

        // All-day strip.
        var allDay = Columns();
        allDay.Margin = new Thickness(0, 0, 0, 4);
        var allDayLabel = Ui.Text("all-day", "Caption");
        allDayLabel.VerticalAlignment = VerticalAlignment.Top;
        allDayLabel.Margin = new Thickness(0, 3, 0, 0);
        allDay.Children.Add(allDayLabel);
        for (var i = 0; i < days.Length; i++)
        {
            var stack = new StackPanel { Margin = new Thickness(2, 0, 2, 0) };
            foreach (var e in events.Where(e => e.AllDay && Covers(e, days[i])).Take(4)) stack.Children.Add(Pill(e, solid: true));
            Grid.SetColumn(stack, i + 1);
            allDay.Children.Add(stack);
        }
        Grid.SetRow(allDay, 1);
        outer.Children.Add(allDay);

        // The time grid.
        var body = Columns();
        body.Height = HourHeight * 24;
        var hours = new Canvas();
        for (var h = 1; h < 24; h++)
        {
            var t = Ui.Text(new TimeOnly(h, 0).ToString("h tt", CultureInfo.CurrentCulture), "Caption");
            t.FontSize = 11;
            Canvas.SetTop(t, h * HourHeight - 8);
            Canvas.SetRight(t, 8);
            hours.Children.Add(t);
        }
        hours.Width = Gutter;
        body.Children.Add(hours);
        for (var i = 0; i < days.Length; i++)
        {
            var day = days[i];
            var canvas = new Canvas { Background = Brushes.Transparent, ClipToBounds = true };
            for (var h = 0; h < 24; h++)
            {
                var line = new Border { Height = 1, Width = 4000 };
                line.SetResourceReference(Border.BackgroundProperty, "Separator");
                Canvas.SetTop(line, h * HourHeight);
                canvas.Children.Add(line);
            }
            var leftEdge = new Border { Width = 1, Height = HourHeight * 24 };
            leftEdge.SetResourceReference(Border.BackgroundProperty, "Separator");
            canvas.Children.Add(leftEdge);
            canvas.MouseLeftButtonDown += (_, e) =>
            {
                if (e.ClickCount != 2 || e.OriginalSource != canvas) return;
                var y = e.GetPosition(canvas).Y;
                var minutes = (int)(y / HourHeight * 60) / 30 * 30;
                Editors.Event(Window, Services.Planner, null, day, new TimeOnly(Math.Clamp(minutes, 0, 23 * 60 + 30) / 60, minutes % 60));
            };
            var timed = events.Where(e => !e.AllDay && e.Day == day).ToList();
            canvas.SizeChanged += (_, _) => Place(canvas, timed);
            Place(canvas, timed);
            if (day == Planner.Today) NowLine(canvas);
            Grid.SetColumn(canvas, i + 1);
            body.Children.Add(canvas);
        }
        gridScroll = new ScrollViewer { Content = body, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Focusable = false };
        var scroll = gridScroll;
        var target = keepScroll ?? Math.Max(0, (DateTime.Now.Hour - 1.5) * HourHeight);
        if (keepScroll is null && !days.Contains(Planner.Today)) target = 7.5 * HourHeight;
        scroll.Loaded += (_, _) => scroll.ScrollToVerticalOffset(target);
        var frame = new Border { Child = scroll, CornerRadius = new CornerRadius(12), ClipToBounds = true, Padding = new Thickness(0, 8, 8, 0) };
        frame.SetResourceReference(Border.BackgroundProperty, "Card");
        Grid.SetRow(frame, 2);
        outer.Children.Add(frame);
        return outer;
    }

    private static bool Covers(PlannerEvent e, DateOnly d) =>
        e.Day <= d && (e.Recurrence is null && Planner.ParseDate(e.EndDate) is { } end ? end : e.Day) >= d;

    /// <summary>Lay timed events out in their day: overlapping ones share the width in columns, as Calendar does.</summary>
    private void Place(Canvas canvas, List<PlannerEvent> timed)
    {
        foreach (var old in canvas.Children.OfType<Border>().Where(b => b.Tag is PlannerEvent).ToList()) canvas.Children.Remove(old);
        var width = canvas.ActualWidth > 0 ? canvas.ActualWidth : 120;
        var sorted = timed.OrderBy(e => e.Start).ThenByDescending(e => e.End).ToList();
        var columnEnds = new List<TimeOnly>();
        var cluster = new List<(PlannerEvent E, int Col)>();
        TimeOnly clusterEnd = TimeOnly.MinValue;
        void Flush()
        {
            var cols = Math.Max(1, cluster.Select(c => c.Col).DefaultIfEmpty(0).Max() + 1);
            foreach (var (e, col) in cluster) Draw(canvas, e, width / cols * col + 2, width / cols - 4);
            cluster.Clear();
            columnEnds.Clear();
        }
        foreach (var e in sorted)
        {
            var start = e.Start!.Value;
            var end = Max(e.End!.Value, start.AddMinutes(15));
            if (cluster.Count > 0 && start >= clusterEnd) Flush();
            var col = columnEnds.FindIndex(x => x <= start);
            if (col < 0) { columnEnds.Add(end); col = columnEnds.Count - 1; }
            else columnEnds[col] = end;
            cluster.Add((e, col));
            clusterEnd = cluster.Count == 1 ? end : Max(clusterEnd, end);
        }
        Flush();
    }

    private static TimeOnly Max(TimeOnly a, TimeOnly b) => a > b ? a : b;

    private void Draw(Canvas canvas, PlannerEvent e, double x, double w)
    {
        var start = e.Start!.Value;
        var end = e.End!.Value <= start ? start.AddMinutes(30) : e.End.Value;
        var minutes = Math.Max(20, (end - start).TotalMinutes);
        var color = Theme.Category(e.Category);
        var block = new Border
        {
            Tag = e,
            Width = Math.Max(10, w),
            Height = Math.Max(18, minutes / 60 * HourHeight - 2),
            CornerRadius = new CornerRadius(6),
            Background = Theme.Soft(color, 0.22),
            BorderBrush = color,
            BorderThickness = new Thickness(3, 0, 0, 0),
            Padding = new Thickness(6, 3, 4, 2),
            Cursor = Cursors.Hand,
            ToolTip = $"{e.Title}\n{Editors.TimeRange(e)}",
        };
        var stack = new StackPanel();
        var title = Ui.Text(e.Title, "Caption");
        title.FontWeight = FontWeights.SemiBold;
        title.SetResourceReference(TextBlock.ForegroundProperty, "Label");
        stack.Children.Add(title);
        if (minutes >= 45) stack.Children.Add(Ui.Text(Planner.Clock(start), "Caption"));
        block.Child = stack;
        block.MouseLeftButtonUp += (_, _) => Editors.Event(Window, Services.Planner, e);
        Canvas.SetLeft(block, x);
        Canvas.SetTop(block, start.ToTimeSpan().TotalHours * HourHeight + 1);
        canvas.Children.Add(block);
    }

    private static void NowLine(Canvas canvas)
    {
        var y = DateTime.Now.TimeOfDay.TotalHours * HourHeight;
        var line = new Border { Height = 2, Width = 4000 };
        line.SetResourceReference(Border.BackgroundProperty, "Red");
        Canvas.SetTop(line, y - 1);
        var dot = new Ellipse { Width = 10, Height = 10 };
        dot.SetResourceReference(Shape.FillProperty, "Red");
        Canvas.SetTop(dot, y - 5);
        Canvas.SetLeft(dot, -5);
        Panel.SetZIndex(line, 50);
        Panel.SetZIndex(dot, 50);
        canvas.Children.Add(line);
        canvas.Children.Add(dot);
    }

    private Border Pill(PlannerEvent e, bool solid)
    {
        var color = Theme.Category(e.Category);
        var pill = new Border
        {
            CornerRadius = new CornerRadius(4),
            Padding = new Thickness(5, 1, 5, 1),
            Margin = new Thickness(0, 1, 0, 1),
            Background = solid ? Theme.Soft(color, 0.85) : Brushes.Transparent,
            Cursor = Cursors.Hand,
            ToolTip = $"{e.Title}\n{Editors.TimeRange(e)}",
        };
        var row = new StackPanel { Orientation = Orientation.Horizontal };
        if (!solid) row.Children.Add(Ui.Dot(color, 7));
        var t = Ui.Text((solid || e.AllDay ? "" : Planner.Clock(e.Start!.Value) + "  ") + e.Title, "Caption");
        t.Margin = new Thickness(solid ? 0 : 5, 0, 0, 0);
        if (solid) t.Foreground = Brushes.White;
        else t.SetResourceReference(TextBlock.ForegroundProperty, "Label");
        row.Children.Add(t);
        pill.Child = row;
        pill.MouseLeftButtonUp += (_, args) => { args.Handled = true; Editors.Event(Window, Services.Planner, e); };
        return pill;
    }

    // ------------------------------------------------------------------ month

    private FrameworkElement Month(PlannerState s)
    {
        var first = new DateOnly(anchor.Year, anchor.Month, 1);
        var start = WeekStart(first);
        var events = Planner.Between(s.Events, start, start.AddDays(41));
        var outer = new Grid();
        outer.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        outer.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        var names = new UniformGrid { Columns = 7, Margin = new Thickness(0, 0, 0, 6) };
        for (var i = 0; i < 7; i++)
        {
            var t = Ui.Text(start.AddDays(i).ToString("ddd", CultureInfo.CurrentCulture), "Caption");
            t.HorizontalAlignment = HorizontalAlignment.Right;
            t.Margin = new Thickness(0, 0, 10, 0);
            names.Children.Add(t);
        }
        outer.Children.Add(names);
        var cells = new UniformGrid { Columns = 7, Rows = 6 };
        for (var i = 0; i < 42; i++)
        {
            var day = start.AddDays(i);
            var inMonth = day.Month == anchor.Month;
            var cell = new Border { BorderThickness = new Thickness(0, 1, 0, 0), Padding = new Thickness(4, 4, 4, 2), Background = Brushes.Transparent, Cursor = Cursors.Hand };
            cell.SetResourceReference(Border.BorderBrushProperty, "Separator");
            var stack = new StackPanel();
            var number = new Border { Width = 26, Height = 26, CornerRadius = new CornerRadius(13), HorizontalAlignment = HorizontalAlignment.Right };
            var n = Ui.Text(day.Day.ToString(CultureInfo.CurrentCulture), "Body");
            n.HorizontalAlignment = HorizontalAlignment.Center;
            n.VerticalAlignment = VerticalAlignment.Center;
            if (day == Planner.Today) { number.SetResourceReference(Border.BackgroundProperty, "Red"); n.Foreground = Brushes.White; n.FontWeight = FontWeights.SemiBold; }
            else if (!inMonth) n.SetResourceReference(TextBlock.ForegroundProperty, "Tertiary");
            number.Child = n;
            stack.Children.Add(number);
            var dayEvents = events.Where(e => Covers(e, day)).ToList();
            foreach (var e in dayEvents.Take(3)) stack.Children.Add(Pill(e, solid: e.AllDay));
            if (dayEvents.Count > 3) stack.Children.Add(Ui.Text($"{dayEvents.Count - 3} more", "Caption"));
            cell.Child = stack;
            cell.MouseLeftButtonDown += (_, e) =>
            {
                if (e.ClickCount == 2) Editors.Event(Window, Services.Planner, null, day);
                else { anchor = day; view = View.Day; Refresh(); }
            };
            cells.Children.Add(cell);
        }
        var frame = Ui.Card(cells, new Thickness(6, 0, 6, 6));
        Grid.SetRow(frame, 1);
        outer.Children.Add(frame);
        return outer;
    }
}

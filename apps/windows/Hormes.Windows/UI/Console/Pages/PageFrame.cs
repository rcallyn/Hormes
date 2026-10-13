using System;
using System.Windows;
using System.Windows.Controls;

namespace Hormes.Windows.UI.Console.Pages;

/// <summary>
/// A page's frame: a large title with a subtitle, a toolbar on the right, and a scrolling body, inset like an iPad
/// app's content. <see cref="Fixed"/> pages (Calendar) manage their own scrolling.
/// </summary>
public class PageFrame : UserControl
{
    protected readonly ConsoleServices Services;
    protected readonly ConsoleWindow Window;
    protected readonly TextBlock TitleText;
    protected readonly TextBlock Subtitle;
    protected readonly StackPanel Toolbar;
    protected readonly StackPanel Body;
    protected readonly Grid Root;

    protected PageFrame(ConsoleServices services, ConsoleWindow window, string title, bool scroll = true)
    {
        Services = services;
        Window = window;
        Root = new Grid { Margin = new Thickness(32, 46, 32, 0) };
        Root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        Root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

        var header = new Grid { Margin = new Thickness(0, 0, 0, 14) };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var titles = new StackPanel();
        TitleText = Ui.Text(title, "LargeTitle");
        Subtitle = Ui.Text("", "Caption");
        Subtitle.FontSize = 15;
        Subtitle.Margin = new Thickness(2, 0, 0, 0);
        titles.Children.Add(TitleText);
        titles.Children.Add(Subtitle);
        header.Children.Add(titles);
        Toolbar = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Bottom };
        Grid.SetColumn(Toolbar, 1);
        header.Children.Add(Toolbar);
        Root.Children.Add(header);

        Body = new StackPanel { Margin = new Thickness(0, 0, 0, 36) };
        if (scroll)
        {
            var scroller = new ScrollViewer { Content = Body, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Focusable = false, Margin = new Thickness(0, 0, -32, 0), Padding = new Thickness(0, 0, 32, 0) };
            Grid.SetRow(scroller, 1);
            Root.Children.Add(scroller);
        }
        Content = Root;
    }

    /// <summary>
    /// "Hormes | stits": where the calendar and todos live (the planner's sync switch). Shown only while stits is linked
    /// (Settings › Calendar &amp; Todos › Sync with stits); without stits there is nothing to switch to.
    /// </summary>
    protected FrameworkElement SourceSwitch()
    {
        var bar = new Border { Margin = new Thickness(0, 0, 10, 0), ToolTip = "Use Hormes' own calendar and todos on this PC, or sync with stits" };
        bar.SetResourceReference(StyleProperty, "SegmentBar");
        var stack = new StackPanel { Orientation = Orientation.Horizontal };
        var group = $"src{Guid.NewGuid():N}";
        var local = new RadioButton { Content = "Hormes", GroupName = group };
        var stits = new RadioButton { Content = "stits", GroupName = group };
        local.SetResourceReference(StyleProperty, "Segment");
        stits.SetResourceReference(StyleProperty, "Segment");
        stack.Children.Add(local);
        stack.Children.Add(stits);
        bar.Child = stack;
        var updating = false;
        void Sync()
        {
            updating = true;
            var s = Services.Planner.State;
            bar.Visibility = s.StitsSync ? Visibility.Visible : Visibility.Collapsed;
            local.IsChecked = !s.StitsSync;
            stits.IsChecked = s.StitsSync;
            stits.IsEnabled = s.StitsAvailable || s.StitsSync;
            stits.ToolTip = s.StitsAvailable ? "Read and write stits' own calendar and todos" : "No stits found (Documents\\Repositories\\stits\\.env.local, or STITS_DATABASE_URL)";
            updating = false;
        }
        Sync();
        Services.Planner.Changed += _ => Dispatcher.BeginInvoke(Sync);
        local.Checked += (_, _) => { if (!updating) Window.Run(Services.Planner.SetSync(false), "Using Hormes' own calendar and todos"); };
        stits.Checked += (_, _) => { if (!updating) Window.Run(Services.Planner.SetSync(true), "Synced with stits"); };
        return bar;
    }

    protected static Button ToolbarButton(string glyph, string tip, Action click)
    {
        var b = new Button { Content = glyph, ToolTip = tip, Margin = new Thickness(4, 0, 0, 0) };
        b.SetResourceReference(StyleProperty, "IconButton");
        b.FontSize = 17;
        b.Click += (_, _) => click();
        return b;
    }
}

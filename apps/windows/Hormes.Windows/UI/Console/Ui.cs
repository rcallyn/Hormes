using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Shapes;

namespace Hormes.Windows.UI.Console;

/// <summary>Small builders for the Console's Apple-style pieces, so pages read as layout rather than plumbing.</summary>
public static class Ui
{
    public static TextBlock Text(string text, string style = "Body", Brush? color = null)
    {
        var t = new TextBlock { Text = text };
        t.SetResourceReference(FrameworkElement.StyleProperty, style);
        if (color is not null) t.Foreground = color;
        return t;
    }

    public static TextBlock Glyph(string glyph, double size = 14, string brushKey = "Accent")
    {
        var t = new TextBlock { Text = glyph, FontSize = size, VerticalAlignment = VerticalAlignment.Center };
        t.SetResourceReference(TextBlock.FontFamilyProperty, "Glyphs");
        t.SetResourceReference(TextBlock.ForegroundProperty, brushKey);
        return t;
    }

    public static Border Card(UIElement child, Thickness? padding = null)
    {
        var b = new Border { Child = child };
        b.SetResourceReference(FrameworkElement.StyleProperty, "CardPanel");
        if (padding is { } p) b.Padding = p;
        return b;
    }

    /// <summary>A section header: small grey capitals, inset to the text of the cells below it.</summary>
    public static TextBlock Header(string text) => Text(text.ToUpperInvariant(), "SectionHeader");

    /// <summary>
    /// An inset grouped list: rows separated by hairlines that start at the text's left edge (<paramref name="inset"/>:
    /// 16 for plain rows, past the leading check or bar otherwise), the cells clipped to the card's rounded corners.
    /// </summary>
    public static Border Group(params UIElement[] rows) => Group(16, rows);

    public static Border Group(double inset, params UIElement[] rows)
    {
        var stack = new StackPanel();
        for (var i = 0; i < rows.Length; i++)
        {
            if (i > 0) stack.Children.Add(Hairline(new Thickness(inset, 0, 0, 0)));
            stack.Children.Add(rows[i]);
        }
        return Rounded(Card(stack, new Thickness(0)));
    }

    /// <summary>Fill a grouped card's stack (one a page redraws) with rows and inset hairlines between them.</summary>
    public static void Fill(Panel list, double inset, params UIElement[] rows)
    {
        list.Children.Clear();
        for (var i = 0; i < rows.Length; i++)
        {
            if (i > 0) list.Children.Add(Hairline(new Thickness(inset, 0, 0, 0)));
            list.Children.Add(rows[i]);
        }
    }

    /// <summary>Clip a card's children to its corner radius (a Border does not), so a row's hover reaches the corners.</summary>
    public static Border Rounded(Border card)
    {
        card.SizeChanged += (_, e) =>
        {
            var r = card.CornerRadius.TopLeft;
            card.Clip = new RectangleGeometry(new Rect(0, 0, e.NewSize.Width, e.NewSize.Height), r, r);
        };
        return card;
    }

    /// <summary>The disclosure chevron at a navigating row's trailing edge.</summary>
    public static TextBlock Chevron()
    {
        var t = Glyph("", 12, "Tertiary");
        t.FontWeight = FontWeights.Bold;
        t.Margin = new Thickness(8, 0, 0, 0);
        return t;
    }

    public static Border Hairline(Thickness? margin = null)
    {
        var b = new Border { Height = 1, Margin = margin ?? new Thickness(0) };
        b.SetResourceReference(Border.BackgroundProperty, "Separator");
        return b;
    }

    public static Ellipse Dot(Brush fill, double size = 9) =>
        new() { Width = size, Height = size, Fill = fill, VerticalAlignment = VerticalAlignment.Center };

    /// <summary>
    /// A cell: content, optional trailing element, click handler. A tappable row with nothing trailing gets the
    /// disclosure chevron (<paramref name="chevron"/> overrides), and fades a highlight in under the pointer.
    /// </summary>
    public static Border Row(UIElement content, UIElement? trailing = null, Action? click = null, bool? chevron = null)
    {
        var grid = new Grid { Margin = new Thickness(16, 9, 16, 9) };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        if (content is FrameworkElement c) c.VerticalAlignment = VerticalAlignment.Center;
        grid.Children.Add(content);
        if (trailing is null && (chevron ?? click is not null)) trailing = Chevron();
        if (trailing is not null)
        {
            Grid.SetColumn(trailing, 1);
            if (trailing is FrameworkElement fe) fe.VerticalAlignment = VerticalAlignment.Center;
            grid.Children.Add(trailing);
        }
        var hover = new Border { IsHitTestVisible = false, Opacity = 0 };
        hover.SetResourceReference(Border.BackgroundProperty, "CardHover");
        var layers = new Grid();
        layers.Children.Add(hover);
        layers.Children.Add(grid);
        var row = new Border { Child = layers };
        row.SetResourceReference(FrameworkElement.StyleProperty, "Row");
        if (click is not null)
        {
            row.MouseEnter += (_, _) => hover.BeginAnimation(UIElement.OpacityProperty, new System.Windows.Media.Animation.DoubleAnimation(1, TimeSpan.FromMilliseconds(110)));
            row.MouseLeave += (_, _) => hover.BeginAnimation(UIElement.OpacityProperty, new System.Windows.Media.Animation.DoubleAnimation(0, TimeSpan.FromMilliseconds(220)));
            row.Cursor = System.Windows.Input.Cursors.Hand;
            row.MouseLeftButtonUp += (_, e) =>
            {
                if (e.OriginalSource is DependencyObject d && IsInsideButton(d, row)) return;
                click();
            };
        }
        return row;
    }

    private static bool IsInsideButton(DependencyObject d, DependencyObject stop)
    {
        for (var x = d; x is not null && x != stop; x = VisualTreeHelper.GetParent(x) ?? LogicalTreeHelper.GetParent(x))
            if (x is System.Windows.Controls.Primitives.ButtonBase) return true;
        return false;
    }

    public static Button Button(string label, Action click, string style = "PlainButton")
    {
        var b = new Button { Content = label };
        b.SetResourceReference(FrameworkElement.StyleProperty, style);
        b.Click += (_, _) => click();
        return b;
    }

    /// <summary>A Fluent picker (ComboBox, DatePicker) on the Console's grey fill with no outline.</summary>
    public static T Picker<T>(T picker) where T : Control
    {
        picker.SetResourceReference(Control.BackgroundProperty, "Fill");
        picker.BorderBrush = Brushes.Transparent;
        picker.BorderThickness = new Thickness(0);
        return picker;
    }

    public static StackPanel HStack(double spacing, params UIElement[] children)
    {
        var s = new StackPanel { Orientation = Orientation.Horizontal };
        for (var i = 0; i < children.Length; i++)
        {
            if (children[i] is FrameworkElement fe)
            {
                if (i > 0) fe.Margin = new Thickness(spacing, fe.Margin.Top, fe.Margin.Right, fe.Margin.Bottom);
                fe.VerticalAlignment = VerticalAlignment.Center;
            }
            s.Children.Add(children[i]);
        }
        return s;
    }

    public static TextBlock Empty(string text)
    {
        var t = Text(text, "Caption");
        t.Margin = new Thickness(16, 10, 16, 10);
        return t;
    }

    /// <summary>A grey-filled field; the placeholder shows while it is empty (the Field style shows its Tag).</summary>
    public static TextBox Field(string placeholder = "")
    {
        var t = new TextBox { Tag = placeholder };
        t.SetResourceReference(FrameworkElement.StyleProperty, "Field");
        return t;
    }
}

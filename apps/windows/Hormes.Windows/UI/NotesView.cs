using System;
using System.Collections.Generic;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using WpfMath.Controls;

namespace Hormes.Windows.UI;

/// <summary>
/// Notes the brain wrote for User to read (the explain tool): a title, then paragraphs; $inline$ TeX sits in the line,
/// $$display$$ TeX gets its own centred line. Handwriting (Ink Free, else Segoe Print) for math-heavy classes; the
/// formulas are typeset either way. TeX that does not parse is shown as written.
/// </summary>
public sealed class NotesView : StackPanel
{
    public static readonly FontFamily Handwriting = new("Ink Free, Segoe Print, Segoe UI");
    public static readonly FontFamily Plain = new("Segoe UI");

    public event Action? DoneClicked;

    public NotesView(string title, string text, bool handwriting, Style? buttonStyle)
    {
        var font = handwriting ? Handwriting : Plain;
        var size = handwriting ? 18.0 : 14.5;

        var head = new DockPanel { Margin = new Thickness(0, 0, 0, 8), LastChildFill = true };
        var done = new Button { Content = "Done", Padding = new Thickness(10, 4, 10, 4) };
        if (buttonStyle is not null) done.Style = buttonStyle;
        done.Click += (_, _) => DoneClicked?.Invoke();
        DockPanel.SetDock(done, Dock.Right);
        head.Children.Add(done);
        head.Children.Add(new TextBlock { Text = title, FontFamily = font, FontSize = size + 5, FontWeight = handwriting ? FontWeights.Normal : FontWeights.SemiBold, Foreground = Brushes.White, TextWrapping = TextWrapping.Wrap, VerticalAlignment = VerticalAlignment.Center });
        Children.Add(head);

        WrapPanel? line = null;
        void NewLine() { line = null; }
        WrapPanel Line()
        {
            if (line is null) { line = new WrapPanel { Margin = new Thickness(0, 2, 0, 6) }; Children.Add(line); }
            return line;
        }
        foreach (var (kind, s) in Tokens(text))
        {
            if (kind == "display")
            {
                NewLine();
                Children.Add(Formula(s, size * 1.25, HorizontalAlignment.Center, new Thickness(0, 4, 0, 10)));
                continue;
            }
            if (kind == "math")
            {
                Line().Children.Add(Formula(s, size * 1.05, HorizontalAlignment.Left, new Thickness(2, 0, 4, 0)));
                continue;
            }
            var parts = s.Replace("\r\n", "\n").Split('\n');
            for (var p = 0; p < parts.Length; p++)
            {
                if (p > 0) NewLine();
                var words = parts[p].Split(' ');
                for (var w = 0; w < words.Length; w++)
                {
                    var word = words[w];
                    if (word.Length == 0) continue;
                    // ", " or "." straight after a formula: pull it up to the formula instead of leaving a gap.
                    if (w == 0 && p == 0 && line is { Children.Count: > 0 } && char.IsPunctuation(word[0]) && line.Children[^1] is Border prev) prev.Margin = new Thickness(prev.Margin.Left, 0, 0, 0);
                    Line().Children.Add(new TextBlock { Text = word + " ", FontFamily = font, FontSize = size, Foreground = Brushes.White, VerticalAlignment = VerticalAlignment.Center });
                }
            }
        }
    }

    private static UIElement Formula(string tex, double size, HorizontalAlignment align, Thickness margin)
    {
        try
        {
            // Commands models write that the typesetter lacks, as the ones it has.
            tex = tex.Replace(@"\dfrac", @"\frac").Replace(@"\tfrac", @"\frac").Replace(@"\displaystyle", "").Replace(@"\tag", @"\quad");
            var f = new FormulaControl { Formula = tex, Scale = size, Foreground = Brushes.White, VerticalAlignment = VerticalAlignment.Center };
            // The control stretches; a box sized to it is what centres a display formula.
            if (!f.HasError) return new Border { Child = f, HorizontalAlignment = align, VerticalAlignment = VerticalAlignment.Center, Margin = margin };
        }
        catch { /* shown as written below */ }
        return new TextBlock { Text = tex, FontFamily = new FontFamily("Cascadia Mono, Consolas"), FontSize = size * 0.8, Foreground = Brushes.White, Margin = margin, HorizontalAlignment = align, TextWrapping = TextWrapping.Wrap };
    }

    /// <summary>Text, $inline$ and $$display$$ pieces in order; \$ is a literal dollar.</summary>
    public static IEnumerable<(string Kind, string Text)> Tokens(string text)
    {
        var i = 0;
        var buf = new System.Text.StringBuilder();
        while (i < text.Length)
        {
            if (text[i] == '\\' && i + 1 < text.Length && text[i + 1] == '$') { buf.Append('$'); i += 2; continue; }
            if (text[i] != '$') { buf.Append(text[i++]); continue; }
            var display = i + 1 < text.Length && text[i + 1] == '$';
            var open = display ? 2 : 1;
            var close = text.IndexOf(display ? "$$" : "$", i + open, StringComparison.Ordinal);
            if (close < 0) { buf.Append(text, i, text.Length - i); break; }
            if (buf.Length > 0) { yield return ("text", buf.ToString()); buf.Clear(); }
            var tex = text.Substring(i + open, close - i - open).Trim();
            if (tex.Length > 0) yield return (display ? "display" : "math", tex);
            i = close + open;
        }
        if (buf.Length > 0) yield return ("text", buf.ToString());
    }
}

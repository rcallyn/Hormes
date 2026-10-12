using System.Collections.Generic;
using System.ComponentModel;
using System.Linq;
using System.Text.Json;
using System.Windows;
using System.Windows.Input;
using Hormes.Windows.Daemon;

namespace Hormes.Windows.UI;

/// <summary>
/// A first Console: status, problems, the conversation so far and a composer. The Mac Console's
/// rails (agents, threads, tasks, ledger, settings) come later; closing only hides the window.
/// </summary>
public partial class ConsoleWindow : Window
{
    public sealed record Line(string Who, string Text);

    private readonly EngineClient client;
    private readonly DaemonProcess daemon;
    private JsonElement? last;

    public ConsoleWindow(EngineClient client, DaemonProcess daemon)
    {
        this.client = client;
        this.daemon = daemon;
        InitializeComponent();
        daemon.StateChanged += _ => Dispatcher.BeginInvoke(Render);
        client.ConnectionChanged += _ => Dispatcher.BeginInvoke(Render);
        Render();
    }

    public void OnSnapshot(JsonElement snapshot) => Dispatcher.BeginInvoke(() =>
    {
        last = snapshot;
        if (IsVisible) Render();
    });

    protected override void OnClosing(CancelEventArgs e)
    {
        e.Cancel = true;
        Hide();
    }

    public void ShowAndFocus()
    {
        Render();
        Show();
        if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
        Activate();
        Composer.Focus();
    }

    private void Render()
    {
        var connection = client.Connected ? $"connected to pid {client.DaemonPid}" : "not connected";
        var phase = last is { } s && s.TryGetProperty("phase", out var p) ? p.GetString() : "unknown";
        StatusText.Text = $"daemon: {daemon.State} · {connection} · phase {phase}";

        var lines = new List<Line>();
        var problems = new List<string>();
        if (last is { } snap)
        {
            if (snap.TryGetProperty("transcript", out var t) && t.ValueKind == JsonValueKind.Array)
                foreach (var item in t.EnumerateArray())
                {
                    var who = item.TryGetProperty("speaker", out var sp) && sp.GetString() == "user" ? "You" : "Hormes";
                    var text = item.TryGetProperty("text", out var tx) ? tx.GetString() ?? "" : "";
                    if (text.Length > 0) lines.Add(new Line(who, text));
                }
            if (snap.TryGetProperty("problems", out var ps) && ps.ValueKind == JsonValueKind.Array)
                problems.AddRange(ps.EnumerateArray().Select(x => x.TryGetProperty("text", out var tx) ? tx.GetString() ?? "" : ""));
        }
        ProblemsText.Text = string.Join("\n", problems.Where(x => x.Length > 0).Select(x => "• " + x));
        ProblemsText.Visibility = problems.Count > 0 ? Visibility.Visible : Visibility.Collapsed;

        var atBottom = Scroller.VerticalOffset >= Scroller.ScrollableHeight - 4;
        Transcript.ItemsSource = lines;
        if (atBottom) Scroller.ScrollToEnd();
    }

    private void Send()
    {
        var text = Composer.Text.Trim();
        if (text.Length == 0) return;
        Composer.Clear();
        _ = client.SendCommandAsync(new { type = "say-text", text });
    }

    private void Send_Click(object sender, RoutedEventArgs e) => Send();

    private void Composer_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Enter) return;
        Send();
        e.Handled = true;
    }
}

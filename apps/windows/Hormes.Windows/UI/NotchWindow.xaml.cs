using System;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media.Animation;
using System.Windows.Threading;
using Hormes.Windows.Daemon;
using Hormes.Windows.Model;

namespace Hormes.Windows.UI;

/// <summary>
/// The notch, Windows edition (apps/mac NotchPanel.swift). PCs have no hardware notch, so the
/// tab hangs from the top edge of the primary display, centred where the Mac's would be. At rest
/// it is a small black tab with the voice bars; hover opens the island beneath it: what Hormes is
/// doing, the last line, an approval or problem, live threads, the Say field, Stop and Console.
/// It closes again when the pointer leaves, unless the Say field holds a draft.
///
/// The window never takes focus on hover (WS_EX_NOACTIVATE until the Say field is clicked) and
/// stays out of Alt+Tab (WS_EX_TOOLWINDOW). Its transparent pixels pass the mouse through, so it
/// only ever covers the tab, or the island while open.
/// </summary>
public partial class NotchWindow : Window
{
    private const double RestWidth = 150, RestHeight = 22;
    private const double OpenWidth = 440, OpenHeight = 196;
    private static readonly Duration OpenDuration = new(TimeSpan.FromMilliseconds(220));
    private static readonly Duration CloseDuration = new(TimeSpan.FromMilliseconds(180));

    private readonly EngineClient client;
    private readonly DispatcherTimer openDelay = new() { Interval = TimeSpan.FromMilliseconds(90) };
    private readonly DispatcherTimer closeDelay = new() { Interval = TimeSpan.FromMilliseconds(380) };
    private readonly DispatcherTimer pillTimer = new() { Interval = TimeSpan.FromSeconds(4) };
    private NotchContent content = NotchContent.Disconnected;
    private bool isOpen;
    private IntPtr hwnd;

    public event Action? ConsoleRequested;

    public NotchWindow(EngineClient client)
    {
        this.client = client;
        InitializeComponent();
        openDelay.Tick += (_, _) => { openDelay.Stop(); SetOpen(true); };
        closeDelay.Tick += (_, _) => { closeDelay.Stop(); if (!HoldOpen) SetOpen(false); };
        pillTimer.Tick += (_, _) => { pillTimer.Stop(); FadePill(false); };

        HitZone.MouseEnter += (_, _) => PointerIn();
        Island.MouseEnter += (_, _) => PointerIn();
        MouseLeave += (_, _) => PointerOut();
        SayBox.PreviewMouseDown += (_, _) => TakeFocus();

        SourceInitialized += (_, _) => InitWindow();
        Loaded += (_, _) => Place();
        Microsoft.Win32.SystemEvents.DisplaySettingsChanged += (_, _) => Dispatcher.BeginInvoke(Place);

        Apply(content);
    }

    // ------------------------------------------------------------------ content

    /// <summary>A new snapshot (any thread): parsed here, applied on the UI thread.</summary>
    public void OnSnapshot(JsonElement snapshot)
    {
        var next = NotchContent.From(snapshot);
        Dispatcher.BeginInvoke(() => Apply(next));
    }

    public void OnConnection(bool connected)
    {
        if (!connected) Dispatcher.BeginInvoke(() => Apply(NotchContent.Disconnected));
    }

    public void OnLevels(double input, double output) => Dispatcher.BeginInvoke(() =>
    {
        PeekBars.Input = OpenBars.Input = input;
        PeekBars.Output = OpenBars.Output = output;
    });

    public void ShowToast(string text, string tone) => Dispatcher.BeginInvoke(() =>
    {
        if (string.IsNullOrWhiteSpace(text)) return;
        PillText.Text = text;
        PillText.Foreground = tone == "error" ? System.Windows.Media.Brushes.Tomato : tone == "warn" ? (System.Windows.Media.Brush)FindResource("Warn") : System.Windows.Media.Brushes.White;
        FadePill(true);
        pillTimer.Stop();
        pillTimer.Start();
    });

    private void Apply(NotchContent c)
    {
        content = c;
        PeekBars.Phase = OpenBars.Phase = c.Phase;
        PhaseText.Text = c.PhaseWord;
        BrainText.Text = c.Phase == "disconnected" ? "connecting to the daemon" : c.BrainReady ? "brain ready" : "brain starting";

        if (!string.IsNullOrEmpty(c.Hero))
        {
            HeroText.Text = c.HeroSpeaker == "user" ? $"You: {c.Hero}" : c.Hero;
            HeroText.Foreground = System.Windows.Media.Brushes.White;
        }
        else
        {
            HeroText.Text = c.Phase == "disconnected" ? "Waiting for hormesd…" : "Nothing yet. Type below to ask Hormes.";
            HeroText.Foreground = (System.Windows.Media.Brush)FindResource("Dim");
        }

        if (c.Approval is { } a)
        {
            ApprovalRow.Visibility = Visibility.Visible;
            ApprovalText.Text = a.Description;
            // Owner authentication needs the platform prompt the Windows app does not have yet: Deny only.
            AllowButton.IsEnabled = !a.RequiresOwner;
            AllowButton.ToolTip = a.RequiresOwner ? "Needs device-owner authentication, which the Windows app does not support yet" : null;
        }
        else ApprovalRow.Visibility = Visibility.Collapsed;

        if (c.Problem is { } p && c.Approval is null)
        {
            ProblemRow.Visibility = Visibility.Visible;
            ProblemText.Text = p.More > 0 ? $"{p.Text} (+{p.More} more)" : p.Text;
            RemedyButton.Visibility = p.RemedyCommandJson is null ? Visibility.Collapsed : Visibility.Visible;
            RemedyButton.Content = p.RemedyLabel ?? "Retry";
        }
        else ProblemRow.Visibility = Visibility.Collapsed;

        if (c.Threads.Count > 0)
        {
            ThreadsText.Visibility = Visibility.Visible;
            ThreadsText.Text = string.Join("   ", c.Threads.Take(3).Select(t => $"● {t.Name} · {t.Word}")) + (c.Threads.Count > 3 ? $"   +{c.Threads.Count - 3}" : "");
        }
        else ThreadsText.Visibility = Visibility.Collapsed;

        StopButton.IsEnabled = c.Phase != "disconnected";
        SayBox.IsEnabled = c.Phase != "disconnected";
        PeekDot.Visibility = c.Approval is not null || c.Problem is not null ? Visibility.Visible : Visibility.Collapsed;
    }

    // ------------------------------------------------------------------ hover

    /// <summary>A draft in the Say field, or the field focused: the island stays open.</summary>
    private bool HoldOpen => SayBox.IsKeyboardFocused && SayBox.Text.Length > 0;

    private void PointerIn()
    {
        closeDelay.Stop();
        if (!isOpen && !openDelay.IsEnabled) openDelay.Start();
    }

    private void PointerOut()
    {
        openDelay.Stop();
        if (isOpen && !HoldOpen) closeDelay.Start();
    }

    private void SetOpen(bool open)
    {
        if (open == isOpen) return;
        isOpen = open;
        var duration = open ? OpenDuration : CloseDuration;
        var ease = new CubicEase { EasingMode = open ? EasingMode.EaseOut : EasingMode.EaseIn };
        Island.BeginAnimation(WidthProperty, new DoubleAnimation(open ? OpenWidth : RestWidth, duration) { EasingFunction = ease });
        Island.BeginAnimation(HeightProperty, new DoubleAnimation(open ? OpenHeight : RestHeight, duration) { EasingFunction = ease });
        Island.CornerRadius = open ? new CornerRadius(0, 0, 22, 22) : new CornerRadius(0, 0, 11, 11);
        IslandShadow.BeginAnimation(System.Windows.Media.Effects.DropShadowEffect.OpacityProperty, new DoubleAnimation(open ? 0.55 : 0, duration));

        if (open)
        {
            Open.Visibility = Visibility.Visible;
            Open.BeginAnimation(OpacityProperty, new DoubleAnimation(1, duration) { BeginTime = TimeSpan.FromMilliseconds(70) });
            Peek.BeginAnimation(OpacityProperty, new DoubleAnimation(0, CloseDuration));
        }
        else
        {
            var fade = new DoubleAnimation(0, TimeSpan.FromMilliseconds(90));
            fade.Completed += (_, _) => { if (!isOpen) Open.Visibility = Visibility.Collapsed; };
            Open.BeginAnimation(OpacityProperty, fade);
            Peek.BeginAnimation(OpacityProperty, new DoubleAnimation(1, duration) { BeginTime = TimeSpan.FromMilliseconds(80) });
            if (SayBox.IsKeyboardFocused) Keyboard.ClearFocus();
            ReleaseFocus();
        }
    }

    private void FadePill(bool show)
    {
        if (show) Pill.Visibility = Visibility.Visible;
        var anim = new DoubleAnimation(show ? 1 : 0, TimeSpan.FromMilliseconds(show ? 140 : 260));
        if (!show) anim.Completed += (_, _) => { if (Pill.Opacity == 0) Pill.Visibility = Visibility.Collapsed; };
        Pill.BeginAnimation(OpacityProperty, anim);
    }

    // ------------------------------------------------------------------ actions

    private void SayBox_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter)
        {
            var text = SayBox.Text.Trim();
            if (text.Length == 0) return;
            SayBox.Clear();
            _ = client.SendCommandAsync(new { type = "say-text", text });
            e.Handled = true;
        }
        else if (e.Key == Key.Escape)
        {
            SayBox.Clear();
            SetOpen(false);
            e.Handled = true;
        }
    }

    private void SayBox_TextChanged(object sender, System.Windows.Controls.TextChangedEventArgs e) =>
        SayHint.Visibility = SayBox.Text.Length == 0 ? Visibility.Visible : Visibility.Collapsed;

    private void SayBox_FocusChanged(object sender, KeyboardFocusChangedEventArgs e)
    {
        if (!SayBox.IsKeyboardFocused && !IsMouseOver) PointerOut();
    }

    private void Stop_Click(object sender, RoutedEventArgs e) => _ = client.SendCommandAsync(new { type = "stop" });

    private void Console_Click(object sender, RoutedEventArgs e)
    {
        SetOpen(false);
        ConsoleRequested?.Invoke();
    }

    private void Allow_Click(object sender, RoutedEventArgs e) => Answer(true);
    private void Deny_Click(object sender, RoutedEventArgs e) => Answer(false);

    private void Answer(bool yes)
    {
        if (content.Approval is not { } a) return;
        _ = client.SendCommandAsync(new { type = "thread.answer", threadId = a.ThreadId, yes, pendingId = a.Id });
    }

    private void Remedy_Click(object sender, RoutedEventArgs e)
    {
        if (content.Problem?.RemedyCommandJson is not { } json) return;
        using var doc = JsonDocument.Parse(json);
        _ = client.SendCommandAsync(doc.RootElement.Clone());
    }

    // ------------------------------------------------------------------ window plumbing

    /// <summary>Top edge of the primary display, centred: where the notch would be.</summary>
    private void Place()
    {
        Left = (SystemParameters.PrimaryScreenWidth - Width) / 2;
        Top = 0;
    }

    private void InitWindow()
    {
        hwnd = new WindowInteropHelper(this).Handle;
        var ex = GetWindowLong(hwnd, GWL_EXSTYLE);
        SetWindowLong(hwnd, GWL_EXSTYLE, ex | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE);
    }

    /// <summary>The Say field was clicked: let the window take keyboard focus.</summary>
    private void TakeFocus()
    {
        if (hwnd == IntPtr.Zero) return;
        SetWindowLong(hwnd, GWL_EXSTYLE, GetWindowLong(hwnd, GWL_EXSTYLE) & ~WS_EX_NOACTIVATE);
        Activate();
        SayBox.Focus();
    }

    /// <summary>Closed again: back to never taking focus.</summary>
    private void ReleaseFocus()
    {
        if (hwnd == IntPtr.Zero) return;
        SetWindowLong(hwnd, GWL_EXSTYLE, GetWindowLong(hwnd, GWL_EXSTYLE) | WS_EX_NOACTIVATE);
    }

    private const int GWL_EXSTYLE = -20;
    private const int WS_EX_TOOLWINDOW = 0x00000080;
    private const int WS_EX_NOACTIVATE = 0x08000000;

    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")]
    private static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongW")]
    private static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
}

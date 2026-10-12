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
using Hormes.Windows.Speech;

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
    /// <summary>The tab while a browser is in front at the top of the screen: a strip that leaves the tabs clear.</summary>
    private const double SlimHeight = 4, SlimHitHeight = 4;
    private const double OpenWidth = 440, OpenHeight = 280;
    private static readonly Duration OpenDuration = new(TimeSpan.FromMilliseconds(220));
    private static readonly Duration CloseDuration = new(TimeSpan.FromMilliseconds(180));

    private readonly EngineClient client;
    private readonly DispatcherTimer openDelay = new() { Interval = TimeSpan.FromMilliseconds(90) };
    private readonly DispatcherTimer closeDelay = new() { Interval = TimeSpan.FromMilliseconds(380) };
    private readonly DispatcherTimer pillTimer = new() { Interval = TimeSpan.FromSeconds(4) };
    /// <summary>Text inserted in one go (a dictation app's paste) sends itself once the field has been still this long.</summary>
    private readonly DispatcherTimer dictationSend = new() { Interval = TimeSpan.FromMilliseconds(700) };
    /// <summary>How long an answer keeps the island open when the pointer is elsewhere.</summary>
    private readonly DispatcherTimer replyHold = new() { Interval = TimeSpan.FromSeconds(12) };
    private readonly DispatcherTimer replyGiveUp = new() { Interval = TimeSpan.FromMinutes(3) };
    private NotchContent content = NotchContent.Disconnected;
    private bool isOpen;
    private bool awaitingReply;
    private VoiceInput? voice;
    private VoiceInput.State voiceState = VoiceInput.State.Idle;
    private bool speaking;
    /// <summary>The ring the island opened for, so it opens once per ring.</summary>
    private string? shownRing;
    private IntPtr hwnd;
    /// <summary>A browser is frontmost and reaches the top edge where the tab hangs: the tab shrinks to a strip.</summary>
    private bool slim;
    private readonly DispatcherTimer foregroundWatch = new() { Interval = TimeSpan.FromMilliseconds(400) };
    private static readonly string[] Browsers = { "chrome", "msedge", "firefox", "brave", "opera", "opera_gx", "vivaldi", "arc", "zen", "librewolf", "waterfox", "thorium", "chromium", "floorp" };

    public event Action? ConsoleRequested;
    /// <summary>Stop was pressed: whatever Hormes is saying stops too.</summary>
    public event Action? StopPressed;
    /// <summary>The speaker button was pressed: the new value of Speak replies.</summary>
    public event Action<bool>? SpeakToggled;
    private bool speakOn;

    /// <summary>Show Speak replies on or off (the tray and the Console change it too).</summary>
    public void SetSpeak(bool on) => Dispatcher.BeginInvoke(() =>
    {
        speakOn = on;
        SpeakGlyph.Text = on ? "" : "";
        SpeakGlyph.Foreground = on ? System.Windows.Media.Brushes.White : (System.Windows.Media.Brush)FindResource("Dim");
        SpeakButton.ToolTip = on ? "Speaking short replies (not while Windows is muted). Click to stop speaking." : "Replies are not spoken. Click to speak short replies.";
    });

    private void Speak_Click(object sender, RoutedEventArgs e) => SpeakToggled?.Invoke(!speakOn);

    public NotchWindow(EngineClient client)
    {
        this.client = client;
        InitializeComponent();
        openDelay.Tick += (_, _) => { openDelay.Stop(); SetOpen(true); };
        closeDelay.Tick += (_, _) => { closeDelay.Stop(); if (!HoldOpen) SetOpen(false); };
        pillTimer.Tick += (_, _) => { pillTimer.Stop(); FadePill(false); };
        dictationSend.Tick += (_, _) => { dictationSend.Stop(); Send(); };
        replyHold.Tick += (_, _) => { replyHold.Stop(); if (!IsMouseOver && !HoldOpen) SetOpen(false); };
        replyGiveUp.Tick += (_, _) => { replyGiveUp.Stop(); awaitingReply = false; if (!IsMouseOver) SetOpen(false); };

        HitZone.MouseEnter += (_, _) => PointerIn();
        Island.MouseEnter += (_, _) => PointerIn();
        MouseLeave += (_, _) => PointerOut();
        SayBox.PreviewMouseDown += (_, _) => TakeFocus();

        SourceInitialized += (_, _) => { InitWindow(); Place(); };
        Loaded += (_, _) => Place();
        // A monitor plugged in or out, the primary changed, a resolution or scale changed: place again.
        Microsoft.Win32.SystemEvents.DisplaySettingsChanged += (_, _) => Dispatcher.BeginInvoke(Place);
        // Moving onto a monitor of another DPI resizes the window by Windows' suggestion; settle it once that is done.
        DpiChanged += (_, _) => Dispatcher.BeginInvoke(Place, DispatcherPriority.Background);

        foregroundWatch.Tick += (_, _) => WatchForeground();
        foregroundWatch.Start();

        Apply(content);
    }

    // ------------------------------------------------------------------ slim over a browser

    /// <summary>Slim while a browser's window in front reaches the top of the primary display, under the tab.</summary>
    private void WatchForeground()
    {
        if (hwnd == IntPtr.Zero) return;
        var next = false;
        var fg = GetForegroundWindow();
        if (fg != IntPtr.Zero && fg != hwnd && GetWindowRect(fg, out var r) && GetWindowRect(hwnd, out var mine))
        {
            GetWindowThreadProcessId(fg, out var pid);
            string? name = null;
            try { using var proc = System.Diagnostics.Process.GetProcessById((int)pid); name = proc.ProcessName.ToLowerInvariant(); } catch { }
            // Its top within a few pixels of the screen's top (maximized windows sit a little above it), across the tab.
            next = name is not null && Browsers.Contains(name) && r.Top <= mine.Top + 12 && r.Left < mine.Right && r.Right > mine.Left;
        }
        if (next != slim) SetSlim(next);
    }

    private void SetSlim(bool on)
    {
        slim = on;
        HitZone.Height = on ? SlimHitHeight : 20;
        HitZone.Width = on ? RestWidth : 260;
        // A pass across the tabs should not open it: a longer dwell while slim.
        openDelay.Interval = TimeSpan.FromMilliseconds(on ? 350 : 90);
        if (isOpen) return;
        var duration = new Duration(TimeSpan.FromMilliseconds(160));
        Island.BeginAnimation(HeightProperty, new DoubleAnimation(RestTabHeight, duration));
        Island.CornerRadius = on ? new CornerRadius(0, 0, 2, 2) : new CornerRadius(0, 0, 11, 11);
        Peek.BeginAnimation(OpacityProperty, new DoubleAnimation(on ? 0 : 1, duration));
    }

    private double RestTabHeight => slim ? SlimHeight : RestHeight;

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

        var dim = (System.Windows.Media.Brush)FindResource("Dim");
        if (c.Phase == "disconnected" || string.IsNullOrEmpty(c.Hero))
        {
            AskedText.Visibility = Visibility.Collapsed;
            HeroText.Text = c.Phase == "disconnected" ? "Waiting for hormesd…" : "Nothing yet. Clap twice or press the mic to talk, or type.";
            HeroText.Foreground = dim;
        }
        else if (c.HeroSpeaker == "user")
        {
            // Asked, not answered yet.
            AskedText.Text = $"You: {c.Hero}";
            AskedText.Visibility = Visibility.Visible;
            HeroText.Text = c.Phase == "thinking" ? "Thinking…" : "";
            HeroText.Foreground = dim;
        }
        else
        {
            AskedText.Text = c.Asked is { Length: > 0 } asked ? $"You: {asked}" : "";
            AskedText.Visibility = AskedText.Text.Length > 0 ? Visibility.Visible : Visibility.Collapsed;
            var fresh = HeroText.Text != c.Hero;
            HeroText.Text = c.Hero;
            HeroText.Foreground = System.Windows.Media.Brushes.White;
            if (fresh)
            {
                HeroScroll.ScrollToTop();
                if (awaitingReply) ShowReply();
            }
        }

        if (c.Ring is { } ring)
        {
            RingRow.Visibility = Visibility.Visible;
            RingText.Text = "⏰  " + ring.Line;
            RingCalm.Text = ring.Calm ?? "";
            RingCalm.Visibility = ring.Calm is null ? Visibility.Collapsed : Visibility.Visible;
            RingSnooze.Visibility = ring.SnoozeMinutes is null ? Visibility.Collapsed : Visibility.Visible;
            RingSnooze.Content = $"Snooze {ring.SnoozeMinutes} min";
            RingDone.Visibility = ring.OffersDone ? Visibility.Visible : Visibility.Collapsed;
            // A new ring opens the island, as on the Mac: the ring is the one thing to deal with.
            if (ring.Id != shownRing) { shownRing = ring.Id; SetOpen(true); closeDelay.Stop(); }
        }
        else
        {
            RingRow.Visibility = Visibility.Collapsed;
            if (shownRing is not null) { shownRing = null; if (!IsMouseOver && !HoldOpen) closeDelay.Start(); }
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
        PeekDot.Visibility = c.Approval is not null || c.Problem is not null || c.Ring is not null ? Visibility.Visible : Visibility.Collapsed;
        ShowVoice();
    }

    // ------------------------------------------------------------------ hover

    /// <summary>A draft in the Say field, or a line sent and not answered yet: the island stays open.</summary>
    private bool HoldOpen => (SayBox.IsKeyboardFocused && SayBox.Text.Length > 0) || awaitingReply || voiceState != VoiceInput.State.Idle || speaking || content.Ring is not null;

    /// <summary>The answer to a line sent from here landed: hold the island open long enough to read it.</summary>
    private void ShowReply()
    {
        awaitingReply = false;
        SetOpen(true);
        closeDelay.Stop();
        replyHold.Stop();
        replyHold.Start();
    }

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
        Island.BeginAnimation(HeightProperty, new DoubleAnimation(open ? OpenHeight : RestTabHeight, duration) { EasingFunction = ease });
        Island.CornerRadius = open ? new CornerRadius(0, 0, 22, 22) : slim ? new CornerRadius(0, 0, 2, 2) : new CornerRadius(0, 0, 11, 11);
        IslandShadow.BeginAnimation(System.Windows.Media.Effects.DropShadowEffect.OpacityProperty, new DoubleAnimation(open ? 0.55 : 0, duration));

        if (open)
        {
            Open.Visibility = Visibility.Visible;
            Open.BeginAnimation(OpacityProperty, new DoubleAnimation(1, duration) { BeginTime = TimeSpan.FromMilliseconds(70) });
            Peek.BeginAnimation(OpacityProperty, new DoubleAnimation(0, CloseDuration));
        }
        else
        {
            replyHold.Stop();
            var fade = new DoubleAnimation(0, TimeSpan.FromMilliseconds(90));
            fade.Completed += (_, _) => { if (!isOpen) Open.Visibility = Visibility.Collapsed; };
            Open.BeginAnimation(OpacityProperty, fade);
            Peek.BeginAnimation(OpacityProperty, new DoubleAnimation(slim ? 0 : 1, duration) { BeginTime = TimeSpan.FromMilliseconds(80) });
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
            Send();
            e.Handled = true;
        }
        else if (e.Key == Key.Escape)
        {
            dictationSend.Stop();
            SayBox.Clear();
            SetOpen(false);
            e.Handled = true;
        }
    }

    private void SayBox_TextChanged(object sender, System.Windows.Controls.TextChangedEventArgs e)
    {
        SayHint.Visibility = SayBox.Text.Length == 0 ? Visibility.Visible : Visibility.Collapsed;
        // Dictation, not typing: several characters at once (a dictation app such as Wispr Flow pastes its
        // transcript). It sends itself once the field is still; a keystroke after it is an edit, and then Enter sends.
        var added = e.Changes.Sum(c => c.AddedLength);
        if (added == 0 || SayBox.Text.Trim().Length == 0) return;
        if (added >= 2)
        {
            dictationSend.Stop();
            dictationSend.Start();
        }
        else dictationSend.Stop();
    }

    /// <summary>Send the Say field to Hormes: Claude answers it (text mode) and the island shows the answer.</summary>
    private void Send()
    {
        dictationSend.Stop();
        var text = SayBox.Text.Trim();
        if (text.Length == 0) return;
        SayBox.Clear();
        SendText(text);
    }

    /// <summary>A line to Claude, typed or heard; the island waits open for the answer.</summary>
    private void SendText(string text)
    {
        awaitingReply = true;
        replyGiveUp.Stop();
        replyGiveUp.Start();
        _ = client.SendCommandAsync(new { type = "say-text", text });
    }

    /// <summary>From anywhere (Ctrl+Alt+Space): start listening, or end the turn now; the island opens either way.</summary>
    public void Summon()
    {
        SetOpen(true);
        closeDelay.Stop();
        if (voice is null) TakeFocus();
        else voice.Toggle();
    }

    // ------------------------------------------------------------------ voice

    /// <summary>The ears: a turn (a double clap, the mic button, Ctrl+Alt+Space) shows here and its words go to Claude.</summary>
    public void AttachVoice(VoiceInput v)
    {
        voice = v;
        v.StateChanged += s => Dispatcher.BeginInvoke(() => OnVoiceState(s));
        v.Level += rms => Dispatcher.BeginInvoke(() => { PeekBars.Input = OpenBars.Input = rms; });
        v.Heard += text => Dispatcher.BeginInvoke(() =>
        {
            AskedText.Text = $"You: {text}";
            AskedText.Visibility = Visibility.Visible;
            SendText(text);
        });
        v.Notice += text => ShowToast(text, "info");
        var lastShown = -1;
        v.ModelDownloadProgress += p =>
        {
            var pct = (int)(p * 100);
            if (pct == lastShown) return;
            lastShown = pct;
            ShowToast($"Downloading the speech model… {pct}%", "info");
        };
    }

    private void OnVoiceState(VoiceInput.State s)
    {
        voiceState = s;
        MicGlyph.Foreground = s == VoiceInput.State.Listening ? (System.Windows.Media.Brush)FindResource("Warn") : System.Windows.Media.Brushes.White;
        if (s == VoiceInput.State.Idle)
        {
            Apply(content);
            if (!awaitingReply && !IsMouseOver) closeDelay.Start();
            return;
        }
        SetOpen(true);
        closeDelay.Stop();
        ShowVoice();
    }

    /// <summary>Hormes is saying an answer aloud (ElevenLabs): the bars follow its voice and the island stays up.</summary>
    public void OnSpeaking(bool on) => Dispatcher.BeginInvoke(() =>
    {
        speaking = on;
        if (on) { closeDelay.Stop(); replyHold.Stop(); }
        else
        {
            PeekBars.Output = OpenBars.Output = 0;
            replyHold.Stop();
            replyHold.Start();
        }
        Apply(content);
    });

    public void OnSpeakerLevel(double rms) => Dispatcher.BeginInvoke(() => { PeekBars.Output = OpenBars.Output = rms; });

    /// <summary>A turn in progress overrides the anchor and the hero: what Hormes is doing is listening to User.</summary>
    private void ShowVoice()
    {
        if (voiceState == VoiceInput.State.Idle)
        {
            if (speaking)
            {
                PeekBars.Phase = OpenBars.Phase = "speaking";
                PhaseText.Text = "Speaking";
            }
            return;
        }
        var listening = voiceState == VoiceInput.State.Listening;
        PeekBars.Phase = OpenBars.Phase = listening ? "listening" : "thinking";
        PhaseText.Text = listening ? "Listening" : "Transcribing";
        AskedText.Visibility = Visibility.Collapsed;
        HeroText.Text = listening ? "Go ahead, I'm listening. I'll stop when you're done." : "Writing down what you said…";
        HeroText.Foreground = (System.Windows.Media.Brush)FindResource("Dim");
    }

    private void Mic_Click(object sender, RoutedEventArgs e) => voice?.Toggle();

    private void SayBox_FocusChanged(object sender, KeyboardFocusChangedEventArgs e)
    {
        if (!SayBox.IsKeyboardFocused && !IsMouseOver) PointerOut();
    }

    private void Stop_Click(object sender, RoutedEventArgs e)
    {
        awaitingReply = false;
        voice?.Cancel();
        StopPressed?.Invoke();
        _ = client.SendCommandAsync(new { type = "stop" });
    }

    private void Console_Click(object sender, RoutedEventArgs e)
    {
        SetOpen(false);
        ConsoleRequested?.Invoke();
    }

    private void RingSnooze_Click(object sender, RoutedEventArgs e)
    {
        if (content.Ring is { SnoozeMinutes: { } minutes } r) _ = client.SendCommandAsync(new { type = "automation.snooze", id = r.Id, minutes });
    }

    private void RingDone_Click(object sender, RoutedEventArgs e)
    {
        if (content.Ring is { } r) _ = client.SendCommandAsync(new { type = "automation.done", id = r.Id });
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

    /// <summary>The window's size in XAML (DIPs) before scaling.</summary>
    private const double BaseWidth = 480, BaseHeight = 360;

    /// <summary>Top edge of the primary monitor, centred and scaled to it: where the notch would be (NotchPlacement).</summary>
    private void Place()
    {
        if (hwnd == IntPtr.Zero) return;
        var (bounds, dpi) = NotchPlacement.Primary();
        var p = NotchPlacement.For(bounds, dpi, BaseWidth, BaseHeight);
        RootScale.ScaleX = RootScale.ScaleY = p.Scale;
        SetWindowPos(hwnd, IntPtr.Zero, p.X, p.Y, p.Width, p.Height, SWP_NOZORDER | SWP_NOACTIVATE);
    }

    private void InitWindow()
    {
        hwnd = new WindowInteropHelper(this).Handle;
        var ex = GetWindowLong(hwnd, GWL_EXSTYLE);
        SetWindowLong(hwnd, GWL_EXSTYLE, ex | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE);
        // Ctrl+Alt+Space from anywhere: the island opens with the caret in the Say field (Summon).
        HwndSource.FromHwnd(hwnd)?.AddHook(WndProc);
        if (!RegisterHotKey(hwnd, SummonHotkeyId, MOD_CONTROL | MOD_ALT | MOD_NOREPEAT, VK_SPACE))
            ShowToast("Ctrl+Alt+Space is taken by another app; hover the notch instead", "warn");
        Closed += (_, _) => UnregisterHotKey(hwnd, SummonHotkeyId);
    }

    /// <summary>The Say field was clicked: let the window take keyboard focus.</summary>
    private void TakeFocus()
    {
        if (hwnd == IntPtr.Zero) return;
        SetWindowLong(hwnd, GWL_EXSTYLE, GetWindowLong(hwnd, GWL_EXSTYLE) & ~WS_EX_NOACTIVATE);
        // Windows lets only the foreground thread hand the foreground over: share its input queue for the moment it
        // takes, or the keyboard would stay with the app underneath.
        var foreground = GetForegroundWindow();
        var theirs = GetWindowThreadProcessId(foreground, IntPtr.Zero);
        var mine = GetCurrentThreadId();
        var attached = foreground != hwnd && theirs != mine && AttachThreadInput(mine, theirs, true);
        SetForegroundWindow(hwnd);
        if (attached) AttachThreadInput(mine, theirs, false);
        Activate();
        SayBox.Focus();
        Keyboard.Focus(SayBox);
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

    private const uint SWP_NOZORDER = 0x0004;
    private const uint SWP_NOACTIVATE = 0x0010;

    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint uFlags);

    private const int WM_HOTKEY = 0x0312, SummonHotkeyId = 1;
    private const uint MOD_ALT = 0x1, MOD_CONTROL = 0x2, MOD_NOREPEAT = 0x4000, VK_SPACE = 0x20;

    private IntPtr WndProc(IntPtr h, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (msg == WM_HOTKEY && wParam.ToInt32() == SummonHotkeyId)
        {
            Summon();
            handled = true;
        }
        return IntPtr.Zero;
    }

    [DllImport("user32.dll")]
    private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

    [DllImport("user32.dll")]
    private static extern bool UnregisterHotKey(IntPtr hWnd, int id);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr processId);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int Left, Top, Right, Bottom; }

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")]
    private static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongW")]
    private static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
}

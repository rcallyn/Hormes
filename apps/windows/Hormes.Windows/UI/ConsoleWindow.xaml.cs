using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Threading;
using Hormes.Windows.Model;
using Hormes.Windows.UI.Console;
using Hormes.Windows.UI.Console.Pages;

namespace Hormes.Windows.UI;

/// <summary>
/// The Console: an iPadOS-style window (no title bar; its own small window controls) with a sidebar (Home, Calendar, Todos, School, Settings). Pages are built once and
/// refreshed when the planner or the engine snapshot changes, at most every 120 ms; an editor opens as a sheet over the
/// window. Closing only hides it: the tray icon and the notch reopen it.
/// </summary>
public partial class ConsoleWindow : Window
{
    private readonly ConsoleServices services;
    private readonly Dictionary<string, FrameworkElement> pages = new();
    private readonly DispatcherTimer refresh = new() { Interval = TimeSpan.FromMilliseconds(120) };
    private readonly DispatcherTimer toastTimer = new() { Interval = TimeSpan.FromSeconds(3.5) };
    private string current = "Home";

    public ConsoleWindow(ConsoleServices services)
    {
        this.services = services;
        InitializeComponent();
        Theme.Follow(this);
        refresh.Tick += (_, _) => { refresh.Stop(); RefreshNow(); };
        toastTimer.Tick += (_, _) => { toastTimer.Stop(); Toast.Visibility = Visibility.Collapsed; };
        services.Planner.Changed += _ => Dispatcher.BeginInvoke(ScheduleRefresh);
        services.SnapshotChanged += _ => Dispatcher.BeginInvoke(ScheduleRefresh);
        services.Client.ConnectionChanged += _ => Dispatcher.BeginInvoke(ScheduleRefresh);
        services.Daemon.StateChanged += _ => Dispatcher.BeginInvoke(ScheduleRefresh);
        KeyDown += (_, e) => { if (e.Key == Key.Escape && SheetHost.Visibility == Visibility.Visible) CloseSheet(); };
        StateChanged += (_, _) => UpdateWindowState();
        NavHome.IsChecked = true;
    }

    // ------------------------------------------------------------------ chrome

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);
    [DllImport("user32.dll")] private static extern IntPtr MonitorFromWindow(IntPtr hwnd, int flags);
    [DllImport("user32.dll")] private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);

    [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] private struct MonitorInfo { public int Size; public Rect Monitor, Work; public int Flags; }
    [StructLayout(LayoutKind.Sequential)] private struct MinMaxInfo { public Point Reserved, MaxSize, MaxPosition, MinTrackSize, MaxTrackSize; }

    private const int DwmWindowCornerPreference = 33;
    private const int DwmcpRound = 2;
    private const int WmGetMinMaxInfo = 0x0024;

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        var hwnd = new WindowInteropHelper(this).Handle;
        // WindowChrome with no glass frame would otherwise lose Windows 11's rounded corners.
        try
        {
            var corner = DwmcpRound;
            DwmSetWindowAttribute(hwnd, DwmWindowCornerPreference, ref corner, sizeof(int));
        }
        catch (Exception) { /* older Windows: square corners */ }
        HwndSource.FromHwnd(hwnd)?.AddHook(WndProc);
        UpdateWindowState();
    }

    /// <summary>A chromeless window maximizes over the taskbar; keep it to the monitor's work area.</summary>
    private static IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (msg != WmGetMinMaxInfo) return IntPtr.Zero;
        var monitor = MonitorFromWindow(hwnd, 2);
        var info = new MonitorInfo { Size = Marshal.SizeOf<MonitorInfo>() };
        if (monitor == IntPtr.Zero || !GetMonitorInfo(monitor, ref info)) return IntPtr.Zero;
        var mmi = Marshal.PtrToStructure<MinMaxInfo>(lParam);
        mmi.MaxPosition = new Point { X = info.Work.Left - info.Monitor.Left, Y = info.Work.Top - info.Monitor.Top };
        mmi.MaxSize = new Point { X = info.Work.Right - info.Work.Left, Y = info.Work.Bottom - info.Work.Top };
        Marshal.StructureToPtr(mmi, lParam, true);
        return IntPtr.Zero;
    }

    /// <summary>Maximized, pad the content by however far the window still overhangs the work area, so nothing is cut off.</summary>
    private void UpdateWindowState()
    {
        var maximized = WindowState == WindowState.Maximized;
        Shell.Margin = maximized ? MaximizedInset() : new Thickness(0);
        MaximizeButton.Content = maximized ? "" : "";
        MaximizeButton.ToolTip = maximized ? "Restore" : "Maximize";
    }

    private Thickness MaximizedInset()
    {
        var hwnd = new WindowInteropHelper(this).Handle;
        var monitor = MonitorFromWindow(hwnd, 2);
        var info = new MonitorInfo { Size = Marshal.SizeOf<MonitorInfo>() };
        if (hwnd == IntPtr.Zero || monitor == IntPtr.Zero || !GetMonitorInfo(monitor, ref info) || !GetWindowRect(hwnd, out var r)) return new Thickness(0);
        var scale = VisualTreeHelper.GetDpi(this).DpiScaleX;
        double Over(int v) => Math.Max(0, v) / scale;
        return new Thickness(Over(info.Work.Left - r.Left), Over(info.Work.Top - r.Top), Over(r.Right - info.Work.Right), Over(r.Bottom - info.Work.Bottom));
    }

    private void Minimize_Click(object sender, RoutedEventArgs e) => SystemCommands.MinimizeWindow(this);

    private void Maximize_Click(object sender, RoutedEventArgs e)
    {
        if (WindowState == WindowState.Maximized) SystemCommands.RestoreWindow(this);
        else SystemCommands.MaximizeWindow(this);
    }

    private void Close_Click(object sender, RoutedEventArgs e) => Close();

    protected override void OnClosing(CancelEventArgs e)
    {
        e.Cancel = true;
        Hide();
    }

    public void ShowAndFocus(string? page = null)
    {
        if (page is not null) Navigate(page);
        Show();
        if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
        Activate();
        RefreshNow();
    }

    public void Navigate(string page)
    {
        var button = page switch
        {
            "Calendar" => NavCalendar,
            "Todos" => NavTodos,
            "School" => NavSchool,
            "Settings" => NavSettings,
            _ => NavHome,
        };
        button.IsChecked = true;
    }

    private void Nav_Checked(object sender, RoutedEventArgs e)
    {
        if (sender is not RadioButton { Content: string name }) return;
        current = name;
        if (!pages.TryGetValue(name, out var page))
        {
            page = name switch
            {
                "Calendar" => new CalendarPage(services, this),
                "Todos" => new TodosPage(services, this),
                "School" => new SchoolPage(services, this),
                "Settings" => new SettingsPage(services, this),
                _ => new HomePage(services, this),
            };
            pages[name] = page;
        }
        Page.Content = page;
        page.Opacity = 0;
        page.BeginAnimation(OpacityProperty, new DoubleAnimation(1, TimeSpan.FromMilliseconds(160)));
        (page as IConsolePage)?.Refresh();
    }

    /// <summary>The page shown now (the checks drive it).</summary>
    internal object? CurrentPage => Page.Content;

    private void ScheduleRefresh()
    {
        if (!refresh.IsEnabled) refresh.Start();
    }

    private void RefreshNow()
    {
        UpdateStatus();
        if (IsVisible && pages.TryGetValue(current, out var page)) (page as IConsolePage)?.Refresh();
    }

    private void UpdateStatus()
    {
        var connected = services.Client.Connected;
        var brainReady = services.Snapshot is { } s && s.TryGetProperty("brainReady", out var b) && b.ValueKind == JsonValueKind.True;
        StatusDot.SetResourceReference(System.Windows.Shapes.Shape.FillProperty, !connected ? "Tertiary" : brainReady ? "Green" : "Orange");
        StatusText.Text = !connected ? "Starting Hormes…" : brainReady ? "Hormes is ready" : "Brain starting…";
        var p = services.Planner.State;
        SourceText.Text = p.Error is { } err ? "Calendar & todos: " + Short(err)
            : p.Source == "stits" ? "Calendar & todos synced with stits" : "Calendar & todos on this PC";
        SourceText.SetResourceReference(TextBlock.ForegroundProperty, p.Error is null ? "Secondary" : "Red");
    }

    private static string Short(string s) => s.Length > 60 ? s[..60] + "…" : s;

    // ------------------------------------------------------------------ sheets and toasts

    /// <summary>Open an editor over the window; Esc or a click outside closes it.</summary>
    public void ShowSheet(FrameworkElement content, double width = 460)
    {
        SheetContent.Content = content;
        Sheet.Width = width;
        SheetHost.Visibility = Visibility.Visible;
        SheetHost.Opacity = 0;
        SheetHost.BeginAnimation(OpacityProperty, new DoubleAnimation(1, TimeSpan.FromMilliseconds(140)));
        var lift = new System.Windows.Media.TranslateTransform(0, 12);
        Sheet.RenderTransform = lift;
        lift.BeginAnimation(System.Windows.Media.TranslateTransform.YProperty, new DoubleAnimation(0, TimeSpan.FromMilliseconds(180)) { EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut } });
    }

    public void CloseSheet()
    {
        SheetHost.Visibility = Visibility.Collapsed;
        SheetContent.Content = null;
    }

    private void Dim_MouseDown(object sender, MouseButtonEventArgs e) => CloseSheet();

    public void ShowToast(string text)
    {
        ToastText.Text = text;
        Toast.Visibility = Visibility.Visible;
        toastTimer.Stop();
        toastTimer.Start();
    }

    /// <summary>Run a planner change; a refusal or failure shows as a toast.</summary>
    public async void Run(System.Threading.Tasks.Task<(bool Ok, string? Error, string? Id)> change, string? done = null)
    {
        var (ok, error, _) = await change;
        if (!ok) ShowToast(error ?? "That didn't work.");
        else if (done is not null) ShowToast(done);
    }
}

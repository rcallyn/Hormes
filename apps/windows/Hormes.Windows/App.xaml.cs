using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using Hormes.Windows.Daemon;
using Hormes.Windows.UI;

namespace Hormes.Windows;

/// <summary>
/// Hormes for Windows: the tray icon, the notch and the Console over hormesd, which the app
/// spawns (or attaches to) and talks to over a named pipe. One instance per user session.
/// </summary>
public partial class App : Application
{
    private Mutex? single;
    private DaemonProcess? daemon;
    private EngineClient? client;
    private NotchWindow? notch;
    private ConsoleWindow? console;
    private TrayIcon? tray;
    private bool quitting;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        single = new Mutex(true, @"Local\Hormes.Windows.App", out var first);
        if (!first)
        {
            System.Windows.MessageBox.Show("Hormes is already running. Its icon is in the notification area.", "Hormes");
            Shutdown();
            return;
        }

        var pipe = Ipc.PipeName(Ipc.SocketPath);
        daemon = new DaemonProcess(pipe);
        client = new EngineClient(pipe);
        notch = new NotchWindow(client);
        console = new ConsoleWindow(client, daemon);
        tray = new TrayIcon(OpenConsole, () => daemon.Restart(), OpenLog, Quit);

        client.Snapshot += notch.OnSnapshot;
        client.Snapshot += console.OnSnapshot;
        client.Levels += notch.OnLevels;
        client.Toast += notch.ShowToast;
        client.ConnectionChanged += notch.OnConnection;
        client.ConnectionChanged += _ => Dispatcher.BeginInvoke(UpdateTray);
        daemon.StateChanged += _ => Dispatcher.BeginInvoke(UpdateTray);
        notch.ConsoleRequested += OpenConsole;

        notch.Show();
        daemon.Start();
        client.Start();
        UpdateTray();
    }

    private void UpdateTray()
    {
        if (tray is null || daemon is null || client is null) return;
        tray.Status = client.Connected ? $"connected · {daemon.State}" : daemon.State;
    }

    private void OpenConsole() => Dispatcher.BeginInvoke(() => console?.ShowAndFocus());

    private static void OpenLog()
    {
        var path = DaemonProcess.LogPath;
        if (File.Exists(path)) Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
    }

    private async void Quit()
    {
        if (quitting) return;
        quitting = true;
        tray?.Dispose();
        notch?.Hide();
        if (client is not null) await client.ByeAsync(TimeSpan.FromMilliseconds(600));
        await Task.Run(() => daemon?.Stop(TimeSpan.FromSeconds(7)));
        client?.Dispose();
        daemon?.Dispose();
        Shutdown();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        tray?.Dispose();
        single?.Dispose();
        base.OnExit(e);
    }
}

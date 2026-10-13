using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using Hormes.Windows.Audio;
using Hormes.Windows.Daemon;
using Hormes.Windows.Model;
using Hormes.Windows.Speech;
using Hormes.Windows.UI;
using Hormes.Windows.UI.Console;

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
    private VoiceInput? voice;
    private ElevenLabsSpeaker? speaker;
    private RepliesToSpeak? replies;
    private Planner? planner;
    private AppSettings settings = new();
    private bool quitting;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        // What goes wrong goes in windows-app.log. A UI error is shown and survived; anything else is logged before the end.
        DispatcherUnhandledException += (_, ex) =>
        {
            AppLog.Write($"ui error: {ex.Exception}");
            System.Windows.MessageBox.Show($"Something went wrong in Hormes: {ex.Exception.Message}\n\nDetails are in ~/.hormes/windows-app.log.", "Hormes");
            ex.Handled = true;
        };
        AppDomain.CurrentDomain.UnhandledException += (_, ex) => AppLog.Write($"fatal: {ex.ExceptionObject}");
        System.Threading.Tasks.TaskScheduler.UnobservedTaskException += (_, ex) => { AppLog.Write($"task error: {ex.Exception}"); ex.SetObserved(); };
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
        settings = AppSettings.Load();
        voice = new VoiceInput();
        notch.AttachVoice(voice);
        speaker = new ElevenLabsSpeaker { Enabled = settings.SpeakReplies };
        // Only short, conversational answers are spoken; anything meant for reading stays on screen.
        replies = new RepliesToSpeak(line =>
        {
            if (SpokenReply.Pick(line) is { } spoken) speaker.Say(spoken);
            Dispatcher.BeginInvoke(() => { if (followUp.ReplyLine()) ListenAgainSoon(); });
        });
        planner = new Planner(client);

        // One place changes the voice switches; the tray menu and the Console show the same state.
        void SetClap(bool on)
        {
            settings.Clap = on;
            settings.Save();
            voice.ClapEnabled = on;
            tray?.SetChecks(settings.Clap, settings.SpeakReplies);
        }
        void SetSpeak(bool on)
        {
            settings.SpeakReplies = on;
            settings.Save();
            speaker.Enabled = on;
            if (!on) speaker.Stop();
            tray?.SetChecks(settings.Clap, settings.SpeakReplies);
            notch.SetSpeak(on);
        }
        notch.SetSpeak(settings.SpeakReplies);
        notch.SpeakToggled += on => Dispatcher.BeginInvoke(() => SetSpeak(on));
        var services = new ConsoleServices
        {
            Client = client, Daemon = daemon, Planner = planner, Voice = voice, Speaker = speaker, Settings = settings,
            SetClap = SetClap, SetSpeak = SetSpeak,
        };
        console = new ConsoleWindow(services);
        client.Snapshot += services.OnSnapshot;
        tray = new TrayIcon(OpenConsole, () => daemon.Restart(client?.DaemonPid), OpenLog, Quit, settings.Clap, SetClap, settings.SpeakReplies, SetSpeak);

        // Hormes speaks its answers; its own voice never wakes the clap detector, and a new turn or Stop cuts it off.
        client.Snapshot += replies.OnSnapshot;
        speaker.Speaking += on => { voice.SpeakerActive = on; notch.OnSpeaking(on); };
        speaker.Level += notch.OnSpeakerLevel;
        speaker.Problem += text => notch.ShowToast(text, "warn");
        voice.StateChanged += st => { if (st == VoiceInput.State.Listening) speaker.Stop(); };
        notch.StopPressed += speaker.Stop;

        // A spoken conversation keeps going: once Hormes has answered, it listens again for the reply.
        voice.Heard += _ => Dispatcher.BeginInvoke(followUp.Heard);
        voice.StateChanged += st => Dispatcher.BeginInvoke(() =>
        {
            if (st == VoiceInput.State.Listening) followUp.ListeningStarted();
            else if (st == VoiceInput.State.Idle) followUp.ListeningEnded();
        });
        speaker.Speaking += on => Dispatcher.BeginInvoke(() => { if (followUp.Speaking(on)) ListenAgainSoon(); });
        client.Snapshot += snap =>
        {
            var phase = snap.TryGetProperty("phase", out var p) ? p.GetString() : null;
            var busy = phase is "thinking" or "acting";
            Dispatcher.BeginInvoke(() => { if (followUp.EngineBusy(busy)) ListenAgainSoon(); });
        };
        notch.StopPressed += followUp.End;
        notch.Typed += followUp.End;
        services.Asked += followUp.End;
        speaker.KeyReady.ContinueWith(_ =>
        {
            if (settings.SpeakReplies && !speaker.Available) notch.ShowToast("For spoken replies, add ELEVENLABS_API_KEY to ~/.hormes/env", "info");
        });

        client.Snapshot += notch.OnSnapshot;
        client.Levels += notch.OnLevels;
        client.Toast += notch.ShowToast;
        client.ConnectionChanged += notch.OnConnection;
        client.ConnectionChanged += _ => Dispatcher.BeginInvoke(UpdateTray);
        daemon.StateChanged += _ => Dispatcher.BeginInvoke(UpdateTray);
        notch.ConsoleRequested += OpenConsole;

        // Automations ring here too (alarms, timers, reminders the brain set): the sound, the line said aloud when
        // replies are on, a Windows notification; the notch shows the ring with Snooze and Done from the snapshot.
        client.Message += (type, msg) =>
        {
            string? Field(string name) => msg.TryGetProperty(name, out var v) && v.ValueKind == System.Text.Json.JsonValueKind.String ? v.GetString() : null;
            switch (type)
            {
                case "local.say":
                    // A named sound when this app has it; macOS system sounds ("Ping") fall back to the ring's own.
                    var sound = Field("sound") is { } named && Earcons.Has(named) ? named : Field("ring") ?? Field("sound");
                    if (sound is not null) Earcons.Play(Earcons.Has(sound) ? sound : "chime");
                    if (Field("text") is { Length: > 0 } line) speaker.Say(line);
                    break;
                case "notify":
                    Dispatcher.BeginInvoke(() => tray?.Notify(Field("title") ?? "Hormes", Field("body")));
                    break;
            }
        };

        notch.Show();
        daemon.Start();
        client.Start();
        voice.ClapEnabled = settings.Clap;
        _ = voice.WarmUpAsync();
        UpdateTray();
        // Hormes.exe --console [Home|Calendar|Todos|School|Settings]: open the Console at start.
        var at = Array.IndexOf(e.Args, "--console");
        if (at >= 0) console.ShowAndFocus(at + 1 < e.Args.Length ? e.Args[at + 1] : null);
    }

    private readonly FollowUp followUp = new();

    private async void ListenAgainSoon()
    {
        await Task.Delay(FollowUp.Pause);
        if (voice is { Current: VoiceInput.State.Idle } && followUp.StillDue()) voice.Begin();
    }

    private void UpdateTray()
    {
        if (tray is null || daemon is null || client is null) return;
        tray.Status = client.Connected ? $"connected Â· {daemon.State}" : daemon.State;
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
        if (speaker is not null) await speaker.DisposeAsync();
        if (voice is not null) await voice.DisposeAsync();
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

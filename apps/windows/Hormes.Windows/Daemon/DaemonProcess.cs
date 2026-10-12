using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace Hormes.Windows.Daemon;

/// <summary>
/// Spawns and supervises hormesd (apps/mac DaemonProcess.swift, Windows edition).
///
/// If a daemon already answers on the pipe (<c>pnpm hormesd</c> from a terminal), the app attaches
/// and spawns nothing. Otherwise it runs <c>node --import tsx packages/daemon/src/main.ts</c> from the
/// repo, one process, with a stdin pipe it closes to stop the daemon (after a <c>bye</c>: main.ts
/// Lifeline), and restarts it with backoff (1 s → 30 s) when it exits unexpectedly. Output goes to
/// <c>&lt;stateDir&gt;/daemon.log</c>, rotated at 5 MB.
/// </summary>
public sealed class DaemonProcess : IDisposable
{
    private const long LogRotateBytes = 5 * 1024 * 1024;
    /// <summary>main.ts: another daemon serves this state dir or socket.</summary>
    private const int ExitAlreadyRunning = 73;
    /// <summary>main.ts: the engine asked to be replaced; respawn at once.</summary>
    private const int ExitRestart = 75;

    private readonly string pipeName;
    private readonly object gate = new();
    private Process? process;
    private StreamWriter? log;
    private bool stopping;
    private int failures;

    public DaemonProcess(string pipeName) => this.pipeName = pipeName;

    /// <summary>One line for the tray tooltip and the Console: "running pid 4242", "attached", "restarting in 4 s: exit 1".</summary>
    public string State { get; private set; } = "not started";
    public event Action<string>? StateChanged;

    public static string LogPath => Path.Combine(Ipc.StateDir, "daemon.log");

    public void Start()
    {
        if (Ipc.PipeExists(pipeName))
        {
            SetState("attached to a running daemon");
            return;
        }
        Spawn();
    }

    /// <summary>Kill the daemon we spawned and start a new one (the Console's Restart daemon).</summary>
    public void Restart()
    {
        lock (gate)
        {
            if (process is { HasExited: false } p)
            {
                try { p.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
                return; // OnExited respawns
            }
        }
        Spawn();
    }

    private void Spawn()
    {
        lock (gate)
        {
            if (stopping) return;
            var repo = RepoLocator.Find();
            if (repo is null)
            {
                SetState("no Hormes checkout found (set HORMES_REPO)");
                return;
            }
            var node = FindNode();
            if (node is null)
            {
                SetState("node.exe not found (install Node 24 or set HORMES_NODE)");
                return;
            }
            Directory.CreateDirectory(Ipc.StateDir);
            OpenLog();
            var psi = new ProcessStartInfo(node)
            {
                WorkingDirectory = repo,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };
            psi.ArgumentList.Add("--import");
            psi.ArgumentList.Add("tsx");
            psi.ArgumentList.Add(Path.Combine(repo, "packages", "daemon", "src", "main.ts"));
            psi.ArgumentList.Add("--socket");
            psi.ArgumentList.Add(Ipc.SocketPath);
            // No microphone yet: a voice session would open (and bill) with nothing to hear.
            psi.Environment["HORMES_AUTO_WAKE"] = "0";
            // Text mode: typed and dictated lines go straight to the brain (Claude Code) with no voice session.
            psi.Environment["HORMES_TEXT_BRAIN"] = "1";
            psi.Environment["HORMES_REPO"] = repo;
            var p = new Process { StartInfo = psi, EnableRaisingEvents = true };
            p.OutputDataReceived += (_, e) => WriteLog(e.Data);
            p.ErrorDataReceived += (_, e) => WriteLog(e.Data);
            p.Exited += (_, _) => OnExited(p);
            try
            {
                p.Start();
            }
            catch (Exception e) when (e is System.ComponentModel.Win32Exception or InvalidOperationException)
            {
                SetState($"could not start node: {e.Message}");
                return;
            }
            p.BeginOutputReadLine();
            p.BeginErrorReadLine();
            process = p;
            WriteLog($"--- hormes app started daemon pid {p.Id} ({DateTime.Now:yyyy-MM-dd HH:mm:ss})");
            SetState($"running pid {p.Id}");
        }
    }

    private void OnExited(Process p)
    {
        int code;
        try { code = p.ExitCode; } catch (InvalidOperationException) { code = -1; }
        lock (gate)
        {
            if (!ReferenceEquals(process, p)) return;
            process = null;
            if (stopping) return;
        }
        WriteLog($"--- daemon exited {code}");
        if (code == ExitAlreadyRunning)
        {
            SetState("attached to a running daemon");
            return;
        }
        if (code == ExitRestart)
        {
            failures = 0;
            Spawn();
            return;
        }
        var delay = TimeSpan.FromSeconds(Math.Min(30, Math.Pow(2, failures++)));
        SetState($"restarting in {delay.TotalSeconds:0} s: exit {code}");
        _ = Task.Delay(delay).ContinueWith(_ => Spawn(), TaskScheduler.Default);
    }

    /// <summary>
    /// A clean quit: the caller has already sent <c>bye</c>; closing stdin is the quit itself.
    /// A daemon we only attached to keeps running, as on the Mac.
    /// </summary>
    public void Stop(TimeSpan wait)
    {
        Process? p;
        lock (gate)
        {
            stopping = true;
            p = process;
        }
        if (p is null || p.HasExited) return;
        try { p.StandardInput.Close(); } catch (IOException) { } catch (InvalidOperationException) { }
        if (!p.WaitForExit((int)wait.TotalMilliseconds))
        {
            try { p.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
        }
    }

    private void SetState(string state)
    {
        State = state;
        StateChanged?.Invoke(state);
    }

    private void OpenLog()
    {
        if (log is not null) return;
        try
        {
            var path = LogPath;
            if (File.Exists(path) && new FileInfo(path).Length > LogRotateBytes)
                File.Move(path, path + ".1", overwrite: true);
            log = new StreamWriter(new FileStream(path, FileMode.Append, FileAccess.Write, FileShare.ReadWrite), new UTF8Encoding(false)) { AutoFlush = true };
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    private void WriteLog(string? line)
    {
        if (line is null) return;
        lock (gate)
        {
            try { log?.WriteLine(line); } catch (IOException) { } catch (ObjectDisposedException) { }
        }
    }

    /// <summary><c>HORMES_NODE</c>, else the first node.exe on PATH, else the default installer location.</summary>
    private static string? FindNode()
    {
        var env = Environment.GetEnvironmentVariable("HORMES_NODE");
        if (!string.IsNullOrEmpty(env) && File.Exists(env)) return env;
        var path = Environment.GetEnvironmentVariable("PATH") ?? "";
        var onPath = path.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries)
            .Select(dir => Path.Combine(dir.Trim('"'), "node.exe"))
            .FirstOrDefault(File.Exists);
        if (onPath is not null) return onPath;
        var programFiles = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe");
        return File.Exists(programFiles) ? programFiles : null;
    }

    public void Dispose()
    {
        lock (gate)
        {
            log?.Dispose();
            log = null;
        }
    }
}

/// <summary>Finds the Hormes checkout: <c>HORMES_REPO</c>, else up from the executable to the package.json named <c>hormes</c>.</summary>
public static class RepoLocator
{
    public static string? Find()
    {
        var env = Environment.GetEnvironmentVariable("HORMES_REPO");
        if (!string.IsNullOrEmpty(env) && IsRepo(env)) return Path.GetFullPath(env);
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
            if (IsRepo(dir.FullName)) return dir.FullName;
        return null;
    }

    private static bool IsRepo(string dir)
    {
        var manifest = Path.Combine(dir, "package.json");
        if (!File.Exists(manifest)) return false;
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllBytes(manifest));
            return doc.RootElement.TryGetProperty("name", out var name) && name.GetString() == "hormes";
        }
        catch (Exception e) when (e is JsonException or IOException)
        {
            return false;
        }
    }
}

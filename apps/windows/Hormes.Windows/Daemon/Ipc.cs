using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace Hormes.Windows.Daemon;

/// <summary>
/// Where the daemon lives: the state dir, the socket path, and the named pipe that path maps to.
///
/// Mirrors packages/core/src/ipc.ts and env.ts: Windows Node serves a socket path as the pipe
/// <c>\\.\pipe\hormes-&lt;first 16 hex of SHA-256(lower-cased full path)&gt;</c>. Keep the two in step.
/// </summary>
public static class Ipc
{
    public static string Home => Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);

    /// <summary><c>HORMES_STATE_DIR</c>, else <c>~/.hormes</c> (env.ts stateDirFromEnv).</summary>
    public static string StateDir
    {
        get
        {
            var env = Environment.GetEnvironmentVariable("HORMES_STATE_DIR");
            return string.IsNullOrEmpty(env) ? Path.Combine(Home, ".hormes") : ExpandHome(env);
        }
    }

    /// <summary><c>HORMES_SOCKET</c>, else <c>&lt;stateDir&gt;/hormes.sock</c> (env.ts readConfig).</summary>
    public static string SocketPath
    {
        get
        {
            var env = Environment.GetEnvironmentVariable("HORMES_SOCKET");
            return string.IsNullOrEmpty(env) ? Path.Combine(StateDir, "hormes.sock") : env;
        }
    }

    /// <summary>The pipe's name as <see cref="System.IO.Pipes.NamedPipeClientStream"/> wants it: no <c>\\.\pipe\</c> prefix.</summary>
    public static string PipeName(string socketPath)
    {
        foreach (var prefix in new[] { @"\\.\pipe\", @"\\?\pipe\" })
            if (socketPath.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return socketPath[prefix.Length..];
        var full = Path.GetFullPath(socketPath).ToLowerInvariant();
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(full));
        return "hormes-" + Convert.ToHexString(hash).ToLowerInvariant()[..16];
    }

    /// <summary>Whether something is listening on the pipe right now (the file exists in the pipe namespace).</summary>
    public static bool PipeExists(string pipeName) => File.Exists(@"\\.\pipe\" + pipeName);

    private static string ExpandHome(string path) =>
        path == "~" ? Home : path.StartsWith("~/") || path.StartsWith(@"~\") ? Path.Combine(Home, path[2..]) : path;
}

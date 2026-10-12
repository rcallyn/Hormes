using System;
using System.Diagnostics;
using System.IO;
using Hormes.Windows.Daemon;

namespace Hormes.Windows;

/// <summary>
/// The Windows app's own log, <c>~/.hormes/windows-app.log</c> (the daemon's is daemon.log): voice turns, the speech
/// runtime, microphone trouble. Never audio, and never what was said beyond its length: the transcript is the ledger's.
/// </summary>
public static class AppLog
{
    private const long RotateBytes = 2 * 1024 * 1024;
    private static readonly object Gate = new();
    public static string PathName => Path.Combine(Ipc.StateDir, "windows-app.log");

    public static void Write(string line)
    {
        Debug.WriteLine(line);
        lock (Gate)
        {
            try
            {
                Directory.CreateDirectory(Ipc.StateDir);
                if (File.Exists(PathName) && new FileInfo(PathName).Length > RotateBytes) File.Move(PathName, PathName + ".1", overwrite: true);
                File.AppendAllText(PathName, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff} {line}{Environment.NewLine}");
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
        }
    }
}

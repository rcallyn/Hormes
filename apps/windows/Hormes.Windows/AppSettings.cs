using System;
using System.IO;
using System.Text.Json;
using Hormes.Windows.Daemon;

namespace Hormes.Windows;

/// <summary>The Windows app's own preferences, in <c>~/.hormes/windows-app.json</c> (the engine's settings stay the engine's).</summary>
public sealed class AppSettings
{
    /// <summary>Listen for a double clap to start a voice turn (keeps the microphone open).</summary>
    public bool Clap { get; set; } = true;

    private static string PathName => Path.Combine(Ipc.StateDir, "windows-app.json");

    public static AppSettings Load()
    {
        try
        {
            return File.Exists(PathName) ? JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(PathName)) ?? new AppSettings() : new AppSettings();
        }
        catch (Exception e) when (e is IOException or JsonException or UnauthorizedAccessException)
        {
            return new AppSettings();
        }
    }

    public void Save()
    {
        try
        {
            Directory.CreateDirectory(Ipc.StateDir);
            File.WriteAllText(PathName, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
    }
}

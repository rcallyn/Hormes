using System;
using NAudio.CoreAudioApi;

namespace Hormes.Windows.Audio;

/// <summary>Windows' own output state: whether the default speakers are muted (or turned all the way down).</summary>
public static class SystemAudio
{
    /// <summary>True when the default output device is muted or at zero volume, or there is no output device.</summary>
    public static bool IsMuted()
    {
        try
        {
            using var devices = new MMDeviceEnumerator();
            if (!devices.HasDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia)) return true;
            using var speakers = devices.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
            var volume = speakers.AudioEndpointVolume;
            return volume.Mute || volume.MasterVolumeLevelScalar < 0.01f;
        }
        catch (Exception e)
        {
            // Unreadable: assume sound is on, as before this check existed.
            AppLog.Write($"system audio: {e.Message}");
            return false;
        }
    }
}

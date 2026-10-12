using System;
using System.Buffers.Binary;
using System.Collections.Concurrent;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using NAudio.Wave;

namespace Hormes.Windows.Audio;

/// <summary>
/// Hormes's sounds (the Mac's: apps/mac/Resources/Sounds, copied next to the app as Sounds/*.caf): the chime, alarm
/// and timer an automation rings with, and the small cues. They are Core Audio files holding plain 16-bit PCM, read
/// here chunk by chunk (caff → desc → data) and played once each, overlapping if need be.
/// </summary>
public static class Earcons
{
    private static readonly ConcurrentDictionary<string, (WaveFormat Format, byte[] Pcm)?> Cache = new();

    public static string Folder => Path.Combine(AppContext.BaseDirectory, "Sounds");

    /// <summary>Whether a sound of that name ships with the app (macOS system sound names such as "Ping" do not).</summary>
    public static bool Has(string name) => File.Exists(Path.Combine(Folder, $"{Path.GetFileName(name)}.caf"));

    /// <summary>Play a sound by name ("chime", "alarm", "timer", …); unknown or unreadable names are logged, not thrown.</summary>
    public static void Play(string name)
    {
        var sound = Cache.GetOrAdd(name, Load);
        if (sound is not { } s) return;
        _ = Task.Run(async () =>
        {
            try
            {
                using var output = new WaveOut();
                output.Init(new RawSourceWaveStream(new MemoryStream(s.Pcm), s.Format));
                output.Play();
                while (output.PlaybackState == PlaybackState.Playing) await Task.Delay(50).ConfigureAwait(false);
            }
            catch (Exception e)
            {
                AppLog.Write($"sound {name}: {e.Message}");
            }
        });
    }

    private static (WaveFormat, byte[])? Load(string name)
    {
        var path = Path.Combine(Folder, $"{Path.GetFileName(name)}.caf");
        try
        {
            return File.Exists(path) ? ReadCaf(File.ReadAllBytes(path)) : Missing(name);
        }
        catch (Exception e) when (e is IOException or InvalidDataException)
        {
            AppLog.Write($"sound {name}: {e.Message}");
            return null;
        }
    }

    private static (WaveFormat, byte[])? Missing(string name)
    {
        AppLog.Write($"sound {name}: no {name}.caf in {Folder}");
        return null;
    }

    /// <summary>A CAF file with linear PCM → its format and samples (little-endian, as WaveOut wants them).</summary>
    public static (WaveFormat, byte[]) ReadCaf(byte[] file)
    {
        if (file.Length < 8 || Encoding.ASCII.GetString(file, 0, 4) != "caff") throw new InvalidDataException("not a CAF file");
        WaveFormat? format = null;
        var bigEndianSamples = true;
        var bits = 16;
        var pos = 8;
        while (pos + 12 <= file.Length)
        {
            var type = Encoding.ASCII.GetString(file, pos, 4);
            var size = BinaryPrimitives.ReadInt64BigEndian(file.AsSpan(pos + 4, 8));
            var body = pos + 12;
            if (type == "desc")
            {
                var rate = BitConverter.Int64BitsToDouble(BinaryPrimitives.ReadInt64BigEndian(file.AsSpan(body, 8)));
                var fmt = Encoding.ASCII.GetString(file, body + 8, 4);
                var flags = BinaryPrimitives.ReadUInt32BigEndian(file.AsSpan(body + 12, 4));
                var channels = (int)BinaryPrimitives.ReadUInt32BigEndian(file.AsSpan(body + 24, 4));
                bits = (int)BinaryPrimitives.ReadUInt32BigEndian(file.AsSpan(body + 28, 4));
                if (fmt != "lpcm" || (flags & 1) != 0 || bits is not (16 or 24 or 32)) throw new InvalidDataException($"unsupported CAF audio ({fmt}, flags {flags}, {bits} bit)");
                bigEndianSamples = (flags & 2) == 0;
                format = new WaveFormat((int)rate, bits, channels);
            }
            else if (type == "data")
            {
                if (format is null) throw new InvalidDataException("CAF data before desc");
                // The data chunk starts with a 4-byte edit count; size -1 means "to the end of the file".
                var start = body + 4;
                var length = size < 0 ? file.Length - start : (int)size - 4;
                var pcm = file.AsSpan(start, Math.Min(length, file.Length - start)).ToArray();
                if (bigEndianSamples)
                {
                    var step = bits / 8;
                    for (var i = 0; i + step <= pcm.Length; i += step) Array.Reverse(pcm, i, step);
                }
                return (format, pcm);
            }
            if (size < 0) break;
            pos = body + (int)size;
        }
        throw new InvalidDataException("CAF file without audio data");
    }
}

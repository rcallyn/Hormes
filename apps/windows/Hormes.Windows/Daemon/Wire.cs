using System;
using System.Buffers.Binary;
using System.IO;
using System.Threading;
using System.Threading.Tasks;

namespace Hormes.Windows.Daemon;

// The app ↔ daemon wire, mirroring packages/daemon/src/wire.ts:
//
//   [type: u8][length: u32 big-endian][payload: length bytes]
//
// type 1  JSON control message (UTF-8)
// type 2  microphone PCM16 mono 24 kHz, app → daemon
// type 3  speaker PCM16 mono 24 kHz, daemon → app

public enum FrameType : byte
{
    Json = 1,
    Mic = 2,
    Speaker = 3,
}

public readonly record struct Frame(byte Type, byte[] Payload);

public static class Wire
{
    public const int MaxFrameBytes = 16 * 1024 * 1024;
    public const int HeaderBytes = 5;

    public static byte[] Encode(FrameType type, ReadOnlySpan<byte> payload)
    {
        if (payload.Length > MaxFrameBytes) throw new InvalidDataException($"frame too large: {payload.Length} bytes");
        var output = new byte[HeaderBytes + payload.Length];
        output[0] = (byte)type;
        BinaryPrimitives.WriteUInt32BigEndian(output.AsSpan(1, 4), (uint)payload.Length);
        payload.CopyTo(output.AsSpan(HeaderBytes));
        return output;
    }

    /// <summary>One whole frame, or null at a clean end of stream. Throws on an oversized frame: drop the connection.</summary>
    public static async Task<Frame?> ReadAsync(Stream stream, CancellationToken ct)
    {
        var header = new byte[HeaderBytes];
        if (!await ReadAllAsync(stream, header, ct)) return null;
        var length = BinaryPrimitives.ReadUInt32BigEndian(header.AsSpan(1, 4));
        if (length > MaxFrameBytes) throw new InvalidDataException($"frame of {length} bytes exceeds the {MaxFrameBytes} byte cap");
        var payload = new byte[length];
        if (!await ReadAllAsync(stream, payload, ct)) return null;
        return new Frame(header[0], payload);
    }

    private static async Task<bool> ReadAllAsync(Stream stream, byte[] buffer, CancellationToken ct)
    {
        var read = 0;
        while (read < buffer.Length)
        {
            var n = await stream.ReadAsync(buffer.AsMemory(read), ct).ConfigureAwait(false);
            if (n == 0) return false;
            read += n;
        }
        return true;
    }
}

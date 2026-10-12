using System;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace Hormes.Windows.Daemon;

/// <summary>
/// The app's connection to hormesd over its named pipe (apps/mac EngineClient.swift, Windows edition).
///
/// Connected only once the daemon's <c>hello</c> arrives. Pings every 2 s from the moment the pipe
/// opens; two unanswered pings drop the connection and the loop reconnects. Every event is raised on
/// the reader's thread: UI subscribers marshal to their dispatcher.
/// </summary>
public sealed class EngineClient : IDisposable
{
    /// <summary>packages/protocol PROTOCOL_VERSION. A daemon with another number refuses Go from this app.</summary>
    public const int ProtocolVersion = 4;

    private static readonly TimeSpan PingEvery = TimeSpan.FromSeconds(2);
    private static readonly TimeSpan ConnectTimeout = TimeSpan.FromSeconds(1);

    private readonly string pipeName;
    private readonly SemaphoreSlim writeLock = new(1, 1);
    private readonly CancellationTokenSource stop = new();
    private NamedPipeClientStream? pipe;
    private TaskCompletionSource? byeAnswered;
    private int unansweredPings;
    private long pingSeq;

    public EngineClient(string pipeName) => this.pipeName = pipeName;

    public bool Connected { get; private set; }
    public int? DaemonPid { get; private set; }
    public int? DaemonProtocol { get; private set; }

    public event Action<bool>? ConnectionChanged;
    /// <summary>The snapshot as the daemon sent it; parsed by the subscriber (it can be large).</summary>
    public event Action<JsonElement>? Snapshot;
    public event Action<string, string>? Toast;
    /// <summary>Mic and speaker RMS, 0..1.</summary>
    public event Action<double, double>? Levels;
    /// <summary>Every other message, by type (planner.state, planner.reply, work.state…): the payload is a clone, safe to keep.</summary>
    public event Action<string, JsonElement>? Message;

    public void Start() => _ = Task.Run(() => RunAsync(stop.Token));

    public Task SendCommandAsync(object command) => SendJsonAsync(new { type = "command", command });

    public async Task SendJsonAsync(object message)
    {
        var p = pipe;
        if (p is null || !p.IsConnected) return;
        var frame = Wire.Encode(FrameType.Json, JsonSerializer.SerializeToUtf8Bytes(message));
        await writeLock.WaitAsync().ConfigureAwait(false);
        try
        {
            await p.WriteAsync(frame).ConfigureAwait(false);
            await p.FlushAsync().ConfigureAwait(false);
        }
        catch (IOException) { }
        catch (ObjectDisposedException) { }
        finally { writeLock.Release(); }
    }

    /// <summary>A clean quit: say bye and wait (up to <paramref name="wait"/>) for the daemon's own bye.</summary>
    public async Task ByeAsync(TimeSpan wait)
    {
        if (!Connected) return;
        var answered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        byeAnswered = answered;
        await SendJsonAsync(new { type = "bye" }).ConfigureAwait(false);
        await Task.WhenAny(answered.Task, Task.Delay(wait)).ConfigureAwait(false);
    }

    private async Task RunAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await ConnectOnceAsync(ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { return; }
            catch (Exception e) when (e is IOException or TimeoutException or InvalidDataException or UnauthorizedAccessException)
            {
                Debug.WriteLine($"engine client: {e.Message}");
            }
            SetConnected(false);
            try { await Task.Delay(500, ct).ConfigureAwait(false); } catch (OperationCanceledException) { return; }
        }
    }

    private async Task ConnectOnceAsync(CancellationToken ct)
    {
        using var p = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
        await p.ConnectAsync((int)ConnectTimeout.TotalMilliseconds, ct).ConfigureAwait(false);
        pipe = p;
        unansweredPings = 0;
        using var connection = CancellationTokenSource.CreateLinkedTokenSource(ct);
        await SendJsonAsync(new { type = "hello", pid = Environment.ProcessId, version = "windows-2.0.0", audio = false, protocol = ProtocolVersion }).ConfigureAwait(false);
        // The planner is not in the snapshot: ask for it on every (re)connect; changes are broadcast after.
        await SendJsonAsync(new { type = "planner.read" }).ConfigureAwait(false);
        var pinger = PingLoopAsync(p, connection);
        try
        {
            while (!connection.IsCancellationRequested)
            {
                var frame = await Wire.ReadAsync(p, connection.Token).ConfigureAwait(false);
                if (frame is null) break;
                if (frame.Value.Type == (byte)FrameType.Json) Handle(frame.Value.Payload);
                // Speaker frames (type 3) wait for the audio phase.
            }
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            // the pinger gave up on a silent daemon
        }
        finally
        {
            connection.Cancel();
            pipe = null;
            await pinger.ConfigureAwait(false);
        }
    }

    private async Task PingLoopAsync(NamedPipeClientStream p, CancellationTokenSource connection)
    {
        try
        {
            while (!connection.IsCancellationRequested)
            {
                await Task.Delay(PingEvery, connection.Token).ConfigureAwait(false);
                if (Interlocked.Increment(ref unansweredPings) > 2)
                {
                    Debug.WriteLine("engine client: two pings unanswered; dropping the connection");
                    connection.Cancel();
                    return;
                }
                await SendJsonAsync(new { type = "ping", id = $"p{Interlocked.Increment(ref pingSeq)}" }).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException) { }
    }

    private void Handle(byte[] payload)
    {
        JsonDocument doc;
        try { doc = JsonDocument.Parse(payload); }
        catch (JsonException) { return; }
        using (doc)
        {
            var root = doc.RootElement;
            if (!root.TryGetProperty("type", out var typeEl) || typeEl.ValueKind != JsonValueKind.String) return;
            switch (typeEl.GetString())
            {
                case "hello":
                    DaemonPid = root.TryGetProperty("pid", out var pid) && pid.TryGetInt32(out var pidValue) ? pidValue : null;
                    DaemonProtocol = root.TryGetProperty("protocol", out var proto) && proto.TryGetInt32(out var protoValue) ? protoValue : null;
                    SetConnected(true);
                    break;
                case "pong":
                    Interlocked.Exchange(ref unansweredPings, 0);
                    break;
                case "snapshot":
                    if (root.TryGetProperty("snapshot", out var snap)) Snapshot?.Invoke(snap.Clone());
                    break;
                case "levels":
                    if (root.TryGetProperty("levels", out var lv))
                        Levels?.Invoke(Number(lv, "input"), Number(lv, "output"));
                    break;
                case "toast":
                    Toast?.Invoke(root.TryGetProperty("text", out var t) ? t.GetString() ?? "" : "", root.TryGetProperty("tone", out var tone) ? tone.GetString() ?? "info" : "info");
                    break;
                case "error":
                    Toast?.Invoke(root.TryGetProperty("message", out var m) ? m.GetString() ?? "error" : "error", "error");
                    break;
                case "bye":
                    byeAnswered?.TrySetResult();
                    break;
                default:
                    Message?.Invoke(typeEl.GetString()!, root.Clone());
                    break;
            }
        }
    }

    private static double Number(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var v) && v.TryGetDouble(out var d) ? d : 0;

    private void SetConnected(bool value)
    {
        if (Connected == value) return;
        Connected = value;
        if (!value) DaemonPid = null;
        ConnectionChanged?.Invoke(value);
    }

    public void Dispose()
    {
        stop.Cancel();
        pipe?.Dispose();
    }
}

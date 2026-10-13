using System;

namespace Hormes.Windows.Speech;

/// <summary>
/// A spoken conversation keeps going: after User speaks to Hormes and Hormes has answered (the engine is idle again and
/// any spoken reply has finished), listening starts again on its own, so User can just answer. It ends when a turn
/// hears nothing (the endpointer's no-speech timeout), on Stop, or when User types instead.
///
/// Single-threaded: call it from the UI thread. <see cref="Due"/> says when to start; the caller waits
/// <see cref="Pause"/> (so the speakers' tail is not heard) and asks <see cref="StillDue"/> before it begins.
/// </summary>
public sealed class FollowUp
{
    /// <summary>Between the end of the answer and the microphone opening.</summary>
    public static readonly TimeSpan Pause = TimeSpan.FromMilliseconds(700);

    private bool conversation;
    private bool answered;
    private bool busy;
    private bool speaking;
    private bool heardThisTurn;

    public bool Enabled { get; set; } = true;
    public bool InConversation => conversation;

    /// <summary>User's words arrived from the microphone: a spoken conversation is on, and an answer is awaited.</summary>
    public void Heard()
    {
        conversation = true;
        heardThisTurn = true;
        answered = false;
    }

    /// <summary>A line of Hormes's landed on the transcript.</summary>
    public bool ReplyLine()
    {
        if (conversation) answered = true;
        return Due;
    }

    /// <summary>The engine's phase: thinking or acting is busy.</summary>
    public bool EngineBusy(bool on)
    {
        busy = on;
        return Due;
    }

    /// <summary>Hormes's voice started or stopped playing.</summary>
    public bool Speaking(bool on)
    {
        speaking = on;
        return Due;
    }

    /// <summary>A listening turn began.</summary>
    public void ListeningStarted() => heardThisTurn = false;

    /// <summary>A listening turn ended; with nothing heard, the conversation is over.</summary>
    public void ListeningEnded()
    {
        if (!heardThisTurn) End();
    }

    /// <summary>Stop, or a typed line: no more automatic listening.</summary>
    public void End()
    {
        conversation = false;
        answered = false;
    }

    /// <summary>Time to listen again: the answer is in, nothing is running, nothing is playing.</summary>
    public bool Due => Enabled && conversation && answered && !busy && !speaking;

    /// <summary>After the pause: still due? Consumes it, so one answer opens the microphone once.</summary>
    public bool StillDue()
    {
        if (!Due) return false;
        answered = false;
        return true;
    }
}

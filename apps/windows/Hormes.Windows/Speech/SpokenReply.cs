using System.Linq;
using System.Text.RegularExpressions;

namespace Hormes.Windows.Speech;

/// <summary>
/// Which of Hormes's answers are worth saying aloud: short, conversational ones ("Done, it's on Friday at 3.").
/// Anything shaped for reading (a list, a table, code, a link, headings, several paragraphs, or just long) stays on
/// screen and is never sent to ElevenLabs, so no credits go on it.
/// </summary>
public static class SpokenReply
{
    /// <summary>At most this many characters once made speakable.</summary>
    public const int MaxChars = 500;
    /// <summary>At most this many sentences.</summary>
    public const int MaxSentences = 5;

    /// <summary>The line to speak, or null when the answer is one to read.</summary>
    public static string? Pick(string text)
    {
        if (string.IsNullOrWhiteSpace(text) || IsForReading(text)) return null;
        var spoken = ElevenLabsSpeaker.Speakable(text);
        if (spoken.Length == 0 || spoken.Length > MaxChars) return null;
        return Sentences(spoken) > MaxSentences ? null : spoken;
    }

    private static bool IsForReading(string text)
    {
        if (text.Contains("```") || Regex.IsMatch(text, @"https?://|www\.")) return true;
        var lines = text.Split('\n').Select(l => l.Trim()).Where(l => l.Length > 0).ToArray();
        if (lines.Length > 3) return true;
        if (lines.Any(l => l.StartsWith('#') || l.StartsWith('|'))) return true;
        // A list: two or more bullet or numbered lines.
        return lines.Count(l => Regex.IsMatch(l, @"^([-*•]|\d+[.)])\s")) >= 2;
    }

    private static int Sentences(string s) => Regex.Matches(s, @"[.!?]+(\s|$)").Count is var n && n == 0 ? 1 : n;
}

import SwiftUI

enum VoiceSwitchWords {
    static let oneRestart = "one restart"
    static let dot = " · "
    static let arrow = "voice → "
    static func named(_ name: String, flag: String?) -> String {
        guard let flag else { return name }
        return "\(name) \(flag)"
    }

    /// The stream's mono meta row: `voice → Marin 🇬🇧 · one restart · 0.7 s` (the figure only when the row carries it). Pinned.
    static func switched(name: String, flag: String?, ms: Double?) -> String {
        var parts = [arrow + named(name, flag: flag), oneRestart]
        if let ms, ms.isFinite, ms >= 0 { parts.append(String(format: "%.1f s", ms / 1000)) }
        return parts.joined(separator: dot)
    }

}

/// The native menu can reopen a session after a voice change.
enum VoiceSwitch {
    /// The saved voice or accent differs from what the open session speaks — awake only, and only
    /// when the session said its voice (a daemon from before `voice.reopen` did not, so nothing to press).
    static func waits(voice: String, accent: String, session: SessionInfo?, phase: Phase) -> Bool {
        guard let session, AppState.inSessionPhases.contains(phase), let spoken = session.voice else { return false }
        return spoken != voice || (session.accent ?? accent) != accent
    }

    /// Work runs: a delegation running or waiting on a confirmation while the session is up, or a live thread not idle.
    static func busy(delegations: [Delegation], threads: [WorkThread], phase: Phase) -> Bool {
        let delegation = phase != .asleep && delegations.contains { $0.status == .running || $0.status == .awaitingConfirmation }
        return delegation || threads.contains { $0.status.isBusy }
    }

    static func tip(enabled: Bool) -> String { enabled ? HelpCopy.switchVoice.hint : HelpCopy.switchVoiceBusy.hint }
}

struct VoiceChipSlot: View {
    @EnvironmentObject private var state: AppState
    var body: some View {
        Text(state.snapshot.settings.voiceProvider == "gemini" ? "Gemini" : "OpenAI")
            .font(ConsoleTheme.sans(11)).foregroundStyle(.secondary)
    }
}

struct VoiceMenuRow: Equatable {
    enum Kind: Equatable { case switchNow, voice(String), separator }
    let kind: Kind
    let title: String
    var on = false
    var enabled = true
    static let separator = VoiceMenuRow(kind: .separator, title: "")
}

enum VoiceMenuModel {
    static func value(voice: String, accent: String) -> String { VoiceWords.name(voice) }
    static func rows(voice: String, accent: String, session: SessionInfo?, phase: Phase, busy: Bool) -> [VoiceMenuRow] {
        var rows: [VoiceMenuRow] = []
        if VoiceSwitch.waits(voice: voice, accent: accent, session: session, phase: phase) {
            rows.append(VoiceMenuRow(kind: .switchNow, title: "Switch now", enabled: !busy))
            rows.append(.separator)
        }
        let voices = ["ballad", "cedar", "marin"] + (["ballad", "cedar", "marin"].contains(voice) ? [] : [voice])
        rows += voices.map { VoiceMenuRow(kind: .voice($0), title: VoiceWords.name($0), on: voice == $0) }
        return rows
    }
}

enum VoiceWords {
    static func name(_ id: String) -> String { ConsoleTheme.voiceOptions.first { $0.id == id }?.name ?? id }
}

/// Old ledger entries still spell their recorded accent.
enum AccentWords {
    static func flag(_ id: String) -> String? { id == "american" ? "🇺🇸" : id == "british" ? "🇬🇧" : nil }
}

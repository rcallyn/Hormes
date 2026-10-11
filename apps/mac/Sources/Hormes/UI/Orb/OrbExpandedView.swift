import SwiftUI

// The capsule beside the blob and the status pill over its foot, in the house
// system (Prototemplate, translated to a Mac panel): ink or paper ground by
// appearance, text as white/ink alpha steps 1.0 / 0.72 / 0.48, titanium for meta,
// hairlines drawn once, exactly one accent for the one primary action, 6pt radius,
// solid SF Symbols on a fixed 20pt column, mono for timings. The phase colour stays
// on the blob; in here it is a 6pt dot and an icon tint, never a wash.

/// What the capsule reads. Fed from AppState by the controller with removeDuplicates so
/// the 30–60 Hz level stream never re-evaluates these views.
@MainActor
final class OrbCapsuleModel: ObservableObject {
    @Published var snapshot: Snapshot = .empty
    @Published var connected = false
    @Published var daemonDetail = "starting"
    /// True while the capsule is on screen; the timers tick only then.
    @Published var shown = false
    // The wake word gate, mirrored from AppState (distinct values only).
    @Published var wakeGate: WakeGateState = .off(reason: "starting")
    @Published var wakePassphraseSet = false
    /// The recogniser's last words, for the ear in the gate row; fed only while shown.
    @Published var wakeHeard = ""
    /// Bumped when the panel stops being key: the passphrase field drops its focus ring.
    @Published var keyLost = 0
    /// Bumped on every Stop pressed on the capsule or the menu: the Stop button flashes red for the press.
    @Published var stopFlash = 0
    /// The blob sits on the capsule's right (the capsule grew leftward from a blob near
    /// the screen's right edge): the capsule pops open from that side.
    @Published var blobOnRight = false

    var phase: Phase { snapshot.phase }
    var lastUser: TranscriptItem? { snapshot.transcript.last { $0.speaker == .user } }
    var lastHormes: TranscriptItem? { snapshot.transcript.last { $0.speaker == .hormes } }
    var activeDelegation: Delegation? { snapshot.delegations.last { $0.status == .running || $0.status == .awaitingConfirmation } }
    /// The delegation being worked on right now — running, not waiting on User's yes. The
    /// header's "Working · 0:12" follows it and stops with it (done, cancelled, awaiting).
    var workingDelegation: Delegation? { snapshot.delegations.last { $0.status == .running } }
    var isAwake: Bool { phase != .asleep && phase != .error }
    var paused: Bool { phase == .paused }
    /// The gate holds the microphone wherever the voice engine does not: dormant (asleep,
    /// error) and paused — WakeGate.listens(in:), spelled through Model because Wake/ is
    /// not compiled into the orb preview.
    var gateListens: Bool { !AppState.voiceAudioRuns(in: phase) }
    /// The gate block shows while the gate listens and the wake word is on — the same
    /// rule as the status menu's row. Paused included: the word resumes.
    var showsGate: Bool { gateListens && snapshot.settings.wake.enabled }
}

struct OrbPill: Equatable {
    var text: String
    var tone: Toast.Tone
    /// A solid SF Symbol in place of the tone dot (the gate's lock); tinted by tone.
    var icon: String? = nil
    /// Counting down to this moment: drawn as "<text> · N s", redrawn once a second.
    var until: Date? = nil
    /// A one-click action the pill offers (the way back to the notch): the pill becomes
    /// a button, with the accent word `actionTitle` at its end.
    var action: (() -> Void)? = nil
    var actionTitle: String = "Notch"

    static func == (a: OrbPill, b: OrbPill) -> Bool {
        a.text == b.text && a.tone == b.tone && a.icon == b.icon && a.until == b.until && (a.action == nil) == (b.action == nil) && a.actionTitle == b.actionTitle
    }
}

/// The small pill under the blob: first problem, else the latest toast.
@MainActor
final class OrbStatusModel: ObservableObject {
    @Published var pill: OrbPill?
    /// True while the panel is on screen; the lockout countdown ticks only then.
    @Published var shown = false
}

struct OrbCapsuleActions {
    /// Go / Pause — the transport's one button (`AppState.transportToggle`): go when asleep
    /// or paused, pause in session, stop while connecting.
    var transportToggle: () -> Void = {}
    var toggleMute: () -> Void = {}
    /// Stop — `AppState.transportStop` (the command, the stop-pressed notification, the
    /// overlay clear, the toast); the controller adds only the capsule's red flash (`stopFlash`).
    var stop: () -> Void = {}
    var openConsole: () -> Void = {}
    var collapse: () -> Void = {}
    /// The typed passphrase (answers an open prompt, or wakes directly).
    var submitPassphrase: (String) -> Void = { _ in }
    var cancelAuth: () -> Void = {}
    /// The passphrase field took or gave up focus; the panel holds key status only in between.
    var fieldFocus: (Bool) -> Void = { _ in }
    /// Where the passphrase field is, in the capsule's own space (`OrbCapsuleView.space`:
    /// y down from the capsule's top-left); nil when the row is gone. The controller
    /// uses it to tell a click into the field from any other click.
    var fieldFrame: (CGRect?) -> Void = { _ in }
}

// MARK: - Tokens

/// The four colours plus one accent, resolved for the appearance. Dark is a token
/// remap: paper collapses onto raised ink, ink flips to white, hairline alphas rise.
struct OrbTheme {
    let dark: Bool

    static let ink = Color(red: 0x07 / 255, green: 0x07 / 255, blue: 0x07 / 255)
    static let inkRaised = Color(red: 0x10 / 255, green: 0x10 / 255, blue: 0x10 / 255)
    static let titanium = Color(white: 0.5)
    static let paper = Color.white
    static let accentLight = Color.black
    static let accentDark = Color.white

    static let radius: CGFloat = 6
    static let iconColumn: CGFloat = 20
    static let rowHeight: CGFloat = 28
    /// A hover being felt (`Motion.instant`).
    static var motion: Animation { .easeOut(duration: Motion.seconds(Motion.instant)) }

    private var fg: Color { dark ? .white : Self.ink }
    var ground: Color { dark ? Self.inkRaised : Self.paper }
    var text: Color { fg }
    var text2: Color { fg.opacity(0.72) }
    var text3: Color { fg.opacity(0.48) }
    var titanium: Color { Self.titanium }
    /// Structural hairline: the capsule's edge and the header's rule.
    var hair: Color { dark ? Color.white.opacity(0.22) : Self.ink.opacity(0.18) }
    /// Row hairline: a row owns its bottom rule; the last row in a run drops it.
    var hairRow: Color { dark ? Color.white.opacity(0.10) : Self.ink.opacity(0.09) }
    /// Hover: the ground one alpha step.
    var hover: Color { dark ? Color.white.opacity(0.06) : Self.ink.opacity(0.05) }
    var accent: Color { dark ? Self.accentDark : Self.accentLight }
    /// A field's ground: ink under raised ink, paper on paper (the hairline is the seam).
    var field: Color { dark ? Self.ink : Self.paper }
    var error: Color { OrbStyle.color(.error) }
}

enum OrbStyle {
    static func color(_ phase: Phase) -> Color {
        let c = OrbPalette.color(for: phase)
        return Color(red: c.r, green: c.g, blue: c.b)
    }

    static func label(_ phase: Phase) -> String {
        switch phase {
        case .asleep: return "Asleep"
        case .connecting: return "Connecting"
        case .listening: return "Listening"
        case .speaking: return "Speaking"
        case .thinking: return "Thinking"
        case .acting: return "Acting"
        case .muted: return "Muted"
        case .paused: return "Paused"
        case .error: return "Error"
        }
    }

    static func mmss(_ seconds: Double) -> String {
        let s = seconds.isFinite && seconds < 1e12 ? max(0, Int(seconds.rounded(.down))) : 0
        if s >= 3600 { return String(format: "%d:%02d:%02d", s / 3600, (s / 60) % 60, s % 60) }
        return String(format: "%d:%02d", s / 60, s % 60)
    }

    /// "Working · 0:12" — the same line on the capsule and the notch island: elapsed since
    /// the running delegation began (`timings.delegatedAt`, ms since 1970), mono digits.
    static func workingLine(delegatedAtMs: Double, now: Date) -> String {
        let elapsed = now.timeIntervalSince1970 - delegatedAtMs / 1000
        return "Working · " + mmss(elapsed.isFinite ? max(0, elapsed) : 0)
    }

    // MARK: wake gate — the same words and symbols as the status menu's row
    // (App/StatusItem.gateLabel / gateSymbol). App/ is not compiled into the orb
    // preview, so they are mirrored here; change both or neither.

    /// `auth` is named when it is `.none`, so a gate that opens the session on the word
    /// alone never looks like one that authenticates. While `paused` the gate listens for
    /// the word to *resume*, unauthenticated (WakeGate.isPaused), and the row says so.
    /// `island` sets the reason in the island's grammar (GateWords): `Wake word off · microphone not granted`.
    static func gateLabel(_ g: WakeGateState, phrases: [String], auth: WakeAuth = .either, trigger: WakeTrigger = .word, now: Date = Date(), paused: Bool = false, island: Bool = false) -> String {
        switch g {
        case .off(let reason): return GateWords.off(reason, island: island)
        case .listening:
            return GateWords.listening(phrases: phrases, auth: auth, trigger: trigger, paused: paused, island: island)
        case .heard: return "Heard you"
        case .authenticating(let method): return "Waiting for \(method)"
        case .granted: return paused ? "Resuming…" : "Waking…"
        case .denied(let reason): return GateWords.denied(reason, island: island)
        case .lockedOut(let until): return "Locked for \(max(1, Int(until.timeIntervalSince(now).rounded()))) s"
        }
    }

    static func gateSymbol(_ g: WakeGateState) -> String {
        switch g {
        case .off: return "ear.trianglebadge.exclamationmark"
        case .listening: return "ear.fill"
        case .heard, .granted: return "waveform.circle.fill"
        case .authenticating: return "lock.fill"
        case .denied: return "xmark.circle.fill"
        case .lockedOut: return "lock.slash.fill"
        }
    }

    /// The gate icon's tint: quiet while it only listens, a step up while it asks (it is
    /// status, not the primary action — the accent stays on the blob and the Wake
    /// button), red for a refusal, titanium while locked.
    static func gateTint(_ g: WakeGateState, theme: OrbTheme) -> Color {
        switch g {
        case .off, .listening: return theme.text3
        case .heard, .granted: return color(.listening)
        case .authenticating: return theme.text2
        case .denied: return theme.error
        case .lockedOut: return theme.titanium
        }
    }

    /// The gate's method (WakeGate.currentMethod) written down. LocalAuth names the
    /// owner fallback "your password" for the spoken prompt; on a label the word alone
    /// will do, and it starts with a capital like "Touch ID" and "Apple Watch" do:
    /// "Password", "Passphrase", "Password or passphrase".
    static func gateMethodLabel(_ method: String) -> String {
        let m = method.replacingOccurrences(of: "your password", with: "Password")
        return m.prefix(1).uppercased() + m.dropFirst()
    }

    /// The pill's text while the gate waits: what the spoken prompt asked for.
    /// "passphrase" → "Password?" (the prompt's own word); "Touch ID" → "Touch ID?";
    /// "Touch ID or passphrase" stays as it is ("your password or passphrase" → "Password or passphrase").
    static func gatePrompt(method: String) -> String {
        let m = gateMethodLabel(method)
        if m.contains(" or ") { return m }
        if m == "Passphrase" { return "Password?" }
        return m + "?"
    }

    /// The capsule row's words: the status menu's, except while authenticating, where
    /// the lock already says "waiting" and "Waiting for Touch ID or passphrase" does
    /// not fit beside Cancel — the method alone. The full wording stays in the tooltip.
    static func gateRowLabel(_ g: WakeGateState, phrases: [String], auth: WakeAuth = .either, trigger: WakeTrigger = .word, now: Date = Date(), paused: Bool = false) -> String {
        if case .authenticating(let method) = g { return gateMethodLabel(method) }
        return gateLabel(g, phrases: phrases, auth: auth, trigger: trigger, now: now, paused: paused)
    }
}

// MARK: - Capsule

/// Essential status, last exchange, wake authentication and native controls.
struct OrbCapsuleView: View {
    @ObservedObject var model: OrbCapsuleModel
    let actions: OrbCapsuleActions
    @State private var passphrase = ""
    @FocusState private var focused: Bool
    static let space = "OrbCapsule"

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Hormes").font(.headline)
                Spacer()
                Button(action: actions.collapse) { Image(systemName: "xmark") }.buttonStyle(.plain).help("Close")
            }
            Text(model.connected ? ConsoleTheme.phase(model.phase).label : "Connecting").font(.caption).foregroundStyle(.secondary)
            if let work = model.activeDelegation { Text(work.request).font(.callout).lineLimit(2) }
            else if let line = model.lastHormes?.text { Text(line).font(.callout).lineLimit(2) }
            if case .authenticating(let method) = model.wakeGate, method == "passphrase" {
                SecureField("Passphrase", text: $passphrase)
                    .textFieldStyle(.roundedBorder).focused($focused)
                    .onSubmit { submit() }
                    .onGeometryChange(for: CGRect.self, of: { $0.frame(in: .named(Self.space)) }) { actions.fieldFrame($0) }
                HStack { Button("Unlock") { submit() }.disabled(passphrase.isEmpty); Button("Cancel", action: actions.cancelAuth) }
            }
            Spacer(minLength: 0)
            HStack {
                Button(model.phase == .asleep || model.phase == .paused || model.phase == .error ? "Go" : "Pause", action: actions.transportToggle)
                Button(action: actions.toggleMute) { Image(systemName: model.phase == .muted ? "mic.slash" : "mic") }.help(model.phase == .muted ? "Unmute" : "Mute")
                Button("Stop", action: actions.stop)
                Spacer(minLength: 0)
                Button(action: actions.openConsole) { Image(systemName: "rectangle.3.group") }.help("Workspace")
            }.controlSize(.small)
        }
        .padding(14)
        .background(Color(white: 0.04), in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.white.opacity(0.2)))
        .preferredColorScheme(.dark)
        .coordinateSpace(name: Self.space)
        .onChange(of: focused) { actions.fieldFocus(focused) }
        .onChange(of: model.keyLost) { focused = false }
        .onChange(of: model.wakeGate) { if case .authenticating(let method) = model.wakeGate, method == "passphrase" { return }; passphrase = ""; actions.fieldFrame(nil) }
        .onDisappear { actions.fieldFrame(nil); actions.fieldFocus(false) }
    }
    private func submit() { actions.submitPassphrase(passphrase); passphrase = "" }
}

struct OrbPillView: View {
    @ObservedObject var status: OrbStatusModel
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let theme = OrbTheme(dark: scheme == .dark)
        ZStack(alignment: .bottom) {
            Color.clear.allowsHitTesting(false)
            if let pill = status.pill {
                pillBody(pill, theme: theme)
                    .padding(.horizontal, 7).padding(.vertical, 3)
                    .background(RoundedRectangle(cornerRadius: OrbTheme.radius, style: .continuous).fill(theme.ground.opacity(0.94)))
                    .overlay(RoundedRectangle(cornerRadius: OrbTheme.radius, style: .continuous).strokeBorder(theme.hair, lineWidth: 1))
                    .padding(.bottom, 2)
                    .help(pill.text)
                    // Arrives with a fade and a small rise, leaves with a fade (`Motion.appear`).
                    .transition(Motion.appear)
                    // A counting pill keeps its identity: the number changes in place, the pill does not re-enter.
                    .id(pill.text)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .animation(Motion.gentle, value: status.pill)
    }

    @ViewBuilder
    private func pillBody(_ pill: OrbPill, theme: OrbTheme) -> some View {
        if let until = pill.until {
            // Once a second, only while a countdown is showing (at most a minute) and the
            // panel is on screen; ordered out, it ticks once a day, i.e. never.
            TimelineView(.periodic(from: .now, by: status.shown ? 1 : 86_400)) { timeline in
                let remaining = max(1, Int(until.timeIntervalSince(timeline.date).rounded()))
                label(pill, text: "\(pill.text) · \(remaining) s", theme: theme)
            }
        } else {
            label(pill, text: pill.text, theme: theme)
        }
    }

    private func label(_ pill: OrbPill, text: String, theme: OrbTheme) -> some View {
        HStack(spacing: 5) {
            if let icon = pill.icon {
                Image(systemName: icon)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(iconTint(pill.tone, theme: theme))
            } else if pill.tone != .info {
                Circle().fill(OrbStyle.color(pill.tone == .error ? .error : .speaking))
                    .frame(width: 5, height: 5)
            }
            Text(text)
                .font(.system(size: 11).monospacedDigit())
                .lineLimit(1)
                .truncationMode(.tail)
                .foregroundStyle(theme.text2)
                // The count changes in place, no transition: rolling the digits
                // (.numericText) re-rasterised the pill through interpolated display lists
                // every second and cost more than the whole blob for the lockout minute — in
                // the one gate state where the blob deliberately holds still.
            if let action = pill.action {
                // The one-click way back: the accent word, a button.
                Button(action: action) {
                    Text(pill.actionTitle)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(theme.accent)
                        .padding(.leading, 3)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help(pill.actionTitle)
            }
        }
    }

    /// The gate's symbol: a step up while it asks (status — the accent is the blob's while
    /// the question is open), red for a refusal, titanium while locked.
    private func iconTint(_ tone: Toast.Tone, theme: OrbTheme) -> Color {
        switch tone {
        case .info: return theme.text2
        case .warn: return theme.titanium
        case .error: return theme.error
        }
    }
}

import SwiftUI

/// Window-local navigation, saved conversation loading, and the lightbox.
@MainActor
final class ConsoleSession: ObservableObject {
    @Published var showsEducation = false
    @Published var showsTasks = false
    @Published var showsWork = true {
        didSet { if showsWork { showsEducation = false; showsTasks = false } }
    }
    @Published var showsSystem = false
    @Published var selectedAgentRole: HormesAgentRole = .sage
    @Published var selectedWorkSessionId: String?
    @Published var viewingAgentWork = false

    /// The agent session stepped into. Setting one of the three open ids clears the
    /// other two: the centre shows one conversation, or Now.
    @Published var openAgentId: String? {
        didSet {
            guard openAgentId != nil else { return }
            showsWork = false
            showsEducation = false
            showsTasks = false
            if openHormesSessionId != nil { openHormesSessionId = nil }
            if openThreadId != nil { openThreadId = nil }
        }
    }
    /// The past Hormes conversation stepped into — a chain's id (its first session's);
    /// nil is Now, the default.
    @Published var openHormesSessionId: String? {
        didSet {
            guard openHormesSessionId != nil else { return }
            showsWork = false
            showsEducation = false
            showsTasks = false
            if openAgentId != nil { openAgentId = nil }
            if openThreadId != nil { openThreadId = nil }
        }
    }
    /// The thread being inspected, opened from Activity or the notch.
    @Published var openThreadId: String? {
        didSet {
            guard openThreadId != nil else { return }
            showsWork = false
            showsEducation = false
            showsTasks = false
            if openAgentId != nil { openAgentId = nil }
            if openHormesSessionId != nil { openHormesSessionId = nil }
        }
    }
    /// The chain whose rows are on screen — set only once its read has landed, so an open
    /// id alone (set early for the rail's highlight) never passes for a loaded conversation.
    private(set) var loadedChainId: String?
    private var chainRead = UUID()
    /// Recorded rows for the selected saved conversation.
    @Published var hormesEntries: [StreamEntry] = []
    @Published var hormesLoading = false
    /// The open chain's read hit the daemon's cap (Ledger.readChain keeps the newest rows): the
    /// oldest of a very long conversation are not on screen.
    @Published private(set) var hormesTruncated = false

    // MARK: durability (the window, the daemon)

    /// The Console window is on screen (ConsoleWindowController: show, close, minimise). A
    /// hidden Console holds no tails: the window only `orderOut`s and its view tree survives,
    /// so a pane's onDisappear never fired while hidden and its tail ran for hours. Panes
    /// send `agent.close` when this turns false and `agent.open` when it turns true.
    @Published var windowVisible = false
    /// Bumped on every daemon (re)connect (AppDelegate → ConsoleWindowController.reconnected).
    /// A restarted engine starts with no open conversations and the pane's identity does not
    /// change across the restart, so nothing re-sent `agent.open` and the header dot pulsed
    /// over a feed nothing fed; a pane watching this re-opens within a second. Settable so
    /// the preview harness can stage a reconnect without a daemon.
    @Published var reconnectCount = 0

    func reconnected() { reconnectCount += 1 }

    @Published var lightbox: ConsoleLightboxItem?

    /// Bumped by the window controller to focus the composer (⌘K).
    @Published var composerFocusRequest = 0
    /// Bumped on every Stop (the composer's button, ⌘.): the Stop button flashes red for the press.
    @Published var stopFlash = 0

    var showsNow: Bool { !showsWork && !showsEducation && !showsTasks && openAgentId == nil && openHormesSessionId == nil && openThreadId == nil }
    static let openHormesSessionNotification = Notification.Name("hormes.console.openHormesSession")

    /// Back to current activity.
    func showNow() {
        showsEducation = false
        showsTasks = false
        selectedWorkSessionId = nil
        viewingAgentWork = false
        showsWork = false
        openAgentId = nil
        openThreadId = nil
        closeHormes()
    }

    /// Education is a Console read model; opening it never resumes a lesson.
    func showEducation() {
        let inspectedSession = selectedWorkSessionId
        showNow()
        selectedWorkSessionId = inspectedSession
        showsEducation = true
    }

    func showTasks() {
        showNow()
        showsTasks = true
    }

    /// Read an agent’s saved work through the existing session inspector.
    func openWork(_ id: String) {
        showNow()
        selectedWorkSessionId = id
        viewingAgentWork = true
        showsWork = true
    }

    func openAgent(_ id: String) {
        openAgentId = id
    }

    /// Inspect a live thread.
    func openThread(_ id: String) {
        openThreadId = id
    }

    func closeHormes() {
        chainRead = UUID()
        openHormesSessionId = nil
        loadedChainId = nil
        hormesEntries = []
        hormesLoading = false
        hormesTruncated = false
    }

    /// Read a saved conversation, falling back to individual sessions for older daemons.
    func openHormes(_ chain: HormesChain, from state: AppState) async {
        if openHormesSessionId == chain.id, loadedChainId == chain.id || hormesLoading {
            return
        }
        openHormesSessionId = chain.id
        let request = UUID()
        chainRead = request
        loadedChainId = nil
        hormesEntries = []
        hormesLoading = true
        hormesTruncated = false
        var rows: [LedgerRow] = []
        var truncated = false
        // nil is no answer (a disconnect, the request timeout); empty rows for a chain that has
        // members is a daemon whose ledger has no readChain (`{rows: [], truncated: false}`)
        // or a walk that missed the root — an empty conversation is not what User opened.
        if let answer = await state.hormesChainRows(chain.id), answer.covers(sessionCount: chain.sessions.count) {
            rows = answer.rows
            truncated = answer.truncated
        } else {
            for s in chain.sessions {
                rows += await state.hormesSessionRows(s.id)
            }
        }
        // User may have moved on while we were reading.
        guard openHormesSessionId == chain.id, chainRead == request else { return }
        hormesEntries = StreamBuilder.fromLedger(rows)
        hormesTruncated = truncated
        hormesLoading = false
        loadedChainId = chain.id
    }

}

// MARK: - Hormes conversations (pure)

/// One of Hormes's conversations as the rail shows it: a session, or a resume
/// chain (`resumedFrom` links) folded into one row. `sessions` oldest first; the
/// chain's id is its first session's, so a row keeps its identity across resumes.
struct HormesChain: Identifiable, Equatable {
    let sessions: [HormesSessionSummary]

    var id: String { sessions.first?.id ?? "" }
    var root: HormesSessionSummary? { sessions.first }
    var last: HormesSessionSummary? { sessions.last }
    var startedAt: Double { root?.startedAt ?? 0 }
    var isOpen: Bool { last?.closedAt == nil }
    var reason: String? { last?.reason }
    /// heard + said, the whole chain.
    var messages: Int { sessions.reduce(0) { $0 + $1.heard + $1.said } }
    var delegations: Int { sessions.reduce(0) { $0 + $1.delegations } }
    /// The first thing User said anywhere in the chain; "" when nothing was heard.
    var title: String { sessions.first(where: { !$0.title.isEmpty })?.title ?? "" }

    // Respect previously saved names and trashed state.

    /// "active" | "archived" | "trashed".
    var state: String { root?.state ?? sessions.compactMap(\.state).first ?? "active" }
    var isTrashed: Bool { state == "trashed" }
    /// User's own name for it; nil when he gave none (or cleared it).
    var name: String? {
        let n = root?.name ?? sessions.compactMap(\.name).first
        return (n?.isEmpty == false) ? n : nil
    }
    /// The rail's title: User's name, else the first thing he said.
    var displayTitle: String { name ?? title }
    /// Nothing heard, said or delegated — the crash litter.
    var isEmptyConversation: Bool { messages == 0 && delegations == 0 }

    func contains(_ sessionId: String) -> Bool { sessions.contains { $0.id == sessionId } }

    /// Folds the ledger's list into chains, newest first by when each began. A session
    /// whose `resumedFrom` is not in the list starts a chain of its own.
    static func build(_ list: [HormesSessionSummary]) -> [HormesChain] {
        var byId: [String: HormesSessionSummary] = [:]
        for s in list where byId[s.id] == nil { byId[s.id] = s }
        func rootId(_ s: HormesSessionSummary) -> String {
            var current = s
            var seen: Set<String> = [s.id]
            while let from = current.resumedFrom, let previous = byId[from], !seen.contains(previous.id) {
                seen.insert(previous.id)
                current = previous
            }
            return current.id
        }
        var groups: [String: [HormesSessionSummary]] = [:]
        for s in list { groups[rootId(s), default: []].append(s) }
        return groups.values
            .map { HormesChain(sessions: $0.sorted { $0.startedAt < $1.startedAt }) }
            .sorted { $0.startedAt > $1.startedAt }
    }
}

struct ConsoleLightboxItem: Identifiable, Equatable {
    let url: URL
    let caption: String
    var id: String { url.path }
}

/// Side-effect hooks handed down through the environment so leaf views stay
/// pure value types (and therefore cheap to diff) without observing AppState.
struct ConsoleActions {
    var send: (EngineCommand) -> Void = { _ in }
    /// Stop everything — the command plus the feedback that does not wait for the
    /// engine (ConsoleWindowController.handle(.stop)); the composer's button and ⌘. share it.
    var stop: () -> Void = {}
    var screenshotURL: (String) -> URL = { URL(fileURLWithPath: $0) }
    /// The wake gate's passphrase (AppState.wakeActions, read at call time so the
    /// gate may install them after the window exists). Set returns false when too short.
    var setWakePassphrase: (String) -> Bool = { _ in false }
    var clearWakePassphrase: () -> Void = {}
    /// Now › "Circle something…": mark mode on the overlay (AppState.beginMarkMode).
    var beginMarkMode: () -> Void = {}
    /// A conversation's Reveal: the session's folder or file in Finder.
    var reveal: (URL) -> Void = { _ in }
    /// The Hormes section: step into a past conversation (the whole chain), or back to Now.
    /// The root view fills these in — they need AppState, which leaf views never see.
    var openHormesConversation: (HormesChain) -> Void = { _ in }
    var showNow: () -> Void = {}
    /// Open a remedy URL or reveal a path in Finder.
    var open: (String) -> Void = { target in
        if let url = URL(string: target), url.scheme != nil, !target.hasPrefix("/") {
            NSWorkspace.shared.open(url)
        } else {
            NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: (target as NSString).expandingTildeInPath)])
        }
    }
}

private struct ConsoleActionsKey: EnvironmentKey {
    static let defaultValue = ConsoleActions()
}

extension EnvironmentValues {
    var consoleActions: ConsoleActions {
        get { self[ConsoleActionsKey.self] }
        set { self[ConsoleActionsKey.self] = newValue }
    }
}

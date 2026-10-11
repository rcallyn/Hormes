import AppKit
import Combine
import SwiftUI

/// One draggable waveform. The notch and floating panel share its animation and controls.
@MainActor
public final class OrbPanelController {
    public let state: AppState
    static let collapsedSize = NSSize(width: 164, height: 164)
    static let expandedSize = NSSize(width: 460, height: 252)
    static let sleepTuckDelay = 0.55
    public nonisolated static let stopPressedNotification = Notification.Name("hormes.stopPressed")
    static let mainThreadId = "main"
    static let dormantPhases: Set<Phase> = [.asleep, .error]
    private let panel: OrbPanel
    private let container = NSView()
    private let blobCell = NSView()
    private let blobView: VoicePresenceView
    private let pillHost: OrbPillHostingView
    private let capsuleHost: OrbCapsuleHostingView
    private let capsuleModel = OrbCapsuleModel()
    private let statusModel = OrbStatusModel()
    private let menuTarget = OrbMenuTarget()
    private var sim: VoiceAnimation { blobView.sim }
    private var notch: NotchDock?
    private var tucked = false
    private var freeForSession = false
    private var visible = false
    private var expanded = false
    private var characterOnRight = false
    private var positioned = false
    private var userMoved = false
    private var snapshotArrived = false
    private var fieldFrame: CGRect?
    private var downPoint: CGPoint?
    private var dragOrigin = NSPoint.zero
    private var dragMoved = false
    private var draggingFromNotch = false
    private var cancellables = Set<AnyCancellable>()
    private var observers: [NSObjectProtocol] = []
    private var dismissMonitors: [Any] = []
    private var deniedPillTimer: Task<Void, Never>?
    private let gatePill = CurrentValueSubject<OrbPill?, Never>(nil)
    private var dockContent: DockContent = .empty
    private var pendingMarksSeen = 0
    private var markThumbs: [String: CGImage] = [:]
    private var markThumbsRequested = Set<String>()
    private let thumbsChanged = CurrentValueSubject<Int, Never>(0)
    private static let thumbMaxPixel = 216

    public init(state: AppState) {
        self.state = state
        let size = Self.collapsedSize
        panel = OrbPanel(contentRect: NSRect(origin: .zero, size: size), styleMask: [.nonactivatingPanel, .borderless, .fullSizeContentView], backing: .buffered, defer: false)
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.hidesOnDeactivate = false
        panel.becomesKeyOnlyIfNeeded = true
        panel.isReleasedWhenClosed = false
        panel.animationBehavior = .none
        panel.title = "Hormes"
        container.wantsLayer = true
        panel.contentView = container
        blobCell.frame = NSRect(origin: .zero, size: size)
        blobView = VoicePresenceView(frame: blobCell.bounds)
        blobView.autoresizingMask = [.width, .height]
        blobCell.addSubview(blobView)
        pillHost = OrbPillHostingView(rootView: OrbPillView(status: statusModel))
        pillHost.frame = blobCell.bounds
        pillHost.autoresizingMask = [.width, .height]
        blobCell.addSubview(pillHost)
        container.addSubview(blobCell)
        capsuleHost = OrbCapsuleHostingView(rootView: OrbCapsuleView(model: capsuleModel, actions: OrbCapsuleActions()))
        capsuleHost.isHidden = true
        container.addSubview(capsuleHost)
        sim.reducedMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        capsuleHost.rootView = OrbCapsuleView(model: capsuleModel, actions: OrbCapsuleActions(
            transportToggle: { [weak self] in self?.state.transportToggle() },
            toggleMute: { [weak self] in self?.toggleMute() },
            stop: { [weak self] in self?.stopPressed() },
            openConsole: { [weak self] in self?.state.openConsole() },
            collapse: { [weak self] in self?.collapse() },
            submitPassphrase: { [weak self] in self?.state.wakeActions.submitPassphrase($0) },
            cancelAuth: { [weak self] in self?.state.wakeActions.cancelAuth() },
            fieldFocus: { [weak self] focused in if !focused { self?.releaseKey() } },
            fieldFrame: { [weak self] in self?.fieldFrame = $0 }))
        panel.onMouseDown = { [weak self] event in
            guard let self, self.blobCell.frame.contains(self.container.convert(event.locationInWindow, from: nil)) else { return false }
            // Actionable status pills receive their ordinary SwiftUI button click.
            let local = self.blobCell.convert(event.locationInWindow, from: nil)
            if local.y <= 30, self.statusModel.pill?.action != nil { return false }
            self.downPoint = CGSpace.point(fromAppKit: NSEvent.mouseLocation)
            self.dragOrigin = self.panel.frame.origin
            self.dragMoved = false
            return true
        }
        panel.onMouseDragged = { [weak self] _ in self?.pointerDragged(to: CGSpace.point(fromAppKit: NSEvent.mouseLocation)) }
        panel.onMouseUp = { [weak self] _ in self?.pointerUp() }
        panel.onRightClick = { [weak self] in self?.showMenu(for: $0) }
        panel.keyRequired = { [weak self] in self?.clickNeedsKey(windowPoint: $0) ?? false }
        bind()
    }

    deinit {
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
        for monitor in dismissMonitors { NSEvent.removeMonitor(monitor) }
        deniedPillTimer?.cancel()
    }

    public var isVisible: Bool { visible }
    public var isTucked: Bool { tucked }
    public func show() {
        visible = true
        statusModel.shown = true
        if !positioned { placeInitially() }
        updateHomeMode(animated: false)
        if tucked { notch?.show() } else { blobView.paused = false; bringPanelForward(); blobView.poke() }
    }
    public func hide() {
        visible = false
        collapse()
        statusModel.shown = false
        notch?.hide()
        blobView.paused = true
        panel.orderOut(nil)
    }
    public func toggleExpanded() {
        if tucked { notch?.toggleIsland() } else if expanded { collapse() } else { expand() }
    }
    public func summon() {
        collapse()
        freeForSession = true
        tucked = false
        notch?.parked = false
        notch?.hide()
        place(center: CGSpace.point(fromAppKit: NSEvent.mouseLocation))
        visible = true
        statusModel.shown = true
        blobView.paused = false
        bringPanelForward()
        blobView.poke()
    }
    private func bringPanelForward() { if visible { panel.orderFrontRegardless() } }
    private func fellAsleep() { freeForSession = false; updateHomeMode(animated: false) }
    private func wokeUp() { if !freeForSession { updateHomeMode(animated: false) } }
    private func reactToStop() { sim.signal(); blobView.poke(); notch?.view.wake() }
    private func stopPressed() { state.transportStop(); capsuleModel.stopFlash += 1 }
    private func togglePause() { state.transportToggle() }
    private func toggleMute() { state.send(state.phase == .muted ? .unmute : .mute) }

    private func bind() {
        state.$snapshot
            .map(\.phase)
            .removeDuplicates()
            .sink { [weak self] phase in
                guard let self else { return }
                // The awake↔asleep transitions are the only ones that move the blob
                // (`fellAsleep`, `wokeUp`). Asleep and error are the dormant side (no
                // session either way: a failed wake, a session that died); paused is not
                // — it holds the conversation, and nothing moves in or out of it.
                let was = self.sim.phase
                self.sim.setPhase(phase)
                self.notch?.phaseChanged()
                let dormant = Self.dormantPhases
                if dormant.contains(phase), !dormant.contains(was) {
                    self.fellAsleep()
                } else if dormant.contains(was), !dormant.contains(phase), phase != .paused {
                    self.wokeUp()
                }
                self.blobView.poke()
            }
            .store(in: &cancellables)

        // Home: free or the notch, from the setting (and the display). The payload is
        // the new value while the snapshot is still the old one in here, so the mode
        // is read on the next turn of the main queue.
        state.$snapshot
            .map(\.settings.orbHome)
            .removeDuplicates()
            .sink { [weak self] _ in
                DispatchQueue.main.async { MainActor.assumeIsolated { self?.updateHomeMode(animated: true) } }
            }
            .store(in: &cancellables)
        // The first real snapshot: the settings are the daemon's now, and the home can
        // be decided — even when `orbHome` says what the empty snapshot already carried,
        // which the sink above would not see as a change.
        // `connected` is not that moment: it flips before the first snapshot arrives.
        state.$snapshot
            .filter { $0 != .empty }
            .first()
            .sink { [weak self] _ in
                guard let self else { return }
                self.snapshotArrived = true
                DispatchQueue.main.async { MainActor.assumeIsolated { self.updateHomeMode(animated: true) } }
            }
            .store(in: &cancellables)
        // The dock's content: built whole from the snapshot, the thread store, the mark
        // state, the gate and the decoded thumbnails; set only when it differs.
        // The automations (design11): the ring, the next fire and the rows, as AppState holds them from the
        // snapshot and the `automation.event` deltas — payloads, never re-read from `state` in here.
        let automations = Publishers.CombineLatest3(state.$ringing.removeDuplicates(), state.$nextFire.removeDuplicates(), state.$automations.removeDuplicates())
        Publishers.CombineLatest4(state.$snapshot, state.$threads, state.$marking.eraseToAnyPublisher().removeDuplicates(), state.$wakeGate.removeDuplicates())
            .combineLatest(thumbsChanged, automations)
            .map { [weak self] top, _, auto -> (DockContent, [ScreenMark]) in
                guard let self else { return (.empty, []) }
                return (self.buildDockContent(snapshot: top.0, threads: top.1, marking: top.2, gate: top.3, ringing: auto.0, nextFire: auto.1, automations: auto.2), top.0.marks)
            }
            .removeDuplicates { $0.0 == $1.0 }
            .sink { [weak self] content, marks in self?.dockContentChanged(content, marks: marks) }
            .store(in: &cancellables)
        // Mark mode: the island folds before the overlay takes the mouse, and unfolds
        // when the stroke is done or cancelled. An Ask that was waiting for a mark that
        // never came is forgotten.
        state.$marking.eraseToAnyPublisher()
            .removeDuplicates()
            .sink { [weak self] marking in
                guard let self else { return }
                if marking {
                    self.notch?.foldForMark()
                } else {
                    self.notch?.markEnded()
                }
            }
            .store(in: &cancellables)
        // Toasts on the notch: the latest, 1.5 s, while the blob is parked there.
        state.$toasts
            .map(\.last)
            .removeDuplicates { $0?.id == $1?.id }
            .compactMap { $0 }
            .sink { [weak self] t in
                guard let self, self.tucked else { return }
                let tone: PillTone
                switch t.tone {
                case .info: tone = .info
                case .warn: tone = .warn
                case .error: tone = .error
                }
                self.notch?.showPill(t.text, symbol: nil, tone: tone, seconds: 1.5)
            }
            .store(in: &cancellables)
        // The island's working state: "Working · 0:12" while a delegation runs, counted from its start.
        state.$snapshot
            .map { (s: Snapshot) -> Double? in s.delegations.last { $0.status == .running }.map { $0.timings.delegatedAt / 1000 } }
            .removeDuplicates()
            .sink { [weak self] since in self?.notch?.setWorking(since: since) }
            .store(in: &cancellables)
        gatePill
            .sink { [weak self] pill in self?.notch?.setGatePill(pill) }
            .store(in: &cancellables)

        state.$levels
            .sink { [weak self] levels in
                guard let self else { return }
                self.sim.setLevels(levels)
                if levels.input > 0.02 || levels.output > 0.02 {
                    self.blobView.poke()
                    if self.tucked { self.notch?.view.wake() }
                }
            }
            .store(in: &cancellables)

        // Derived models: only distinct changes reach SwiftUI (levels never do).
        state.$snapshot.removeDuplicates()
            .sink { [weak self] snap in self?.capsuleModel.snapshot = snap }
            .store(in: &cancellables)
        state.$connected.removeDuplicates()
            .sink { [weak self] v in self?.capsuleModel.connected = v }
            .store(in: &cancellables)
        state.$daemonDetail.removeDuplicates()
            .sink { [weak self] v in self?.capsuleModel.daemonDetail = v }
            .store(in: &cancellables)
        // The wake word gate: colours and cues on the blob, the row in the capsule,
        // the question / verdict / countdown in the pill.
        state.$wakeGate
            .removeDuplicates()
            .sink { [weak self] gate in self?.gateChanged(gate) }
            .store(in: &cancellables)
        state.$wakeHeard
            .removeDuplicates()
            .sink { [weak self] heard in
                guard let self else { return }
                // The calibration cue: something new was heard. One cell, at most.
                if !heard.isEmpty { self.sim.signal(); self.blobView.poke() }
                // The capsule's ear only while it is open, so a hidden capsule never lays out for a transcript.
                if self.expanded { self.capsuleModel.wakeHeard = heard }
            }
            .store(in: &cancellables)
        state.$wakePassphraseSet.removeDuplicates()
            .sink { [weak self] v in self?.capsuleModel.wakePassphraseSet = v }
            .store(in: &cancellables)

        // The pill: the first problem, else the gate,
        // else the latest toast, else "Paused · meter stopped" while paused. The gate
        // outranks toasts because its lockout toast and countdown arrive together and
        // the countdown is the one worth the space. A toast that repeats the showing
        // one's words (the app's "Stopped", then the engine's "stopped" a moment later)
        // does not flip the pill.
        Publishers.CombineLatest3(
            state.$snapshot.map { $0.problems.first?.text }.removeDuplicates(),
            gatePill.removeDuplicates(),
            state.$toasts.map(\.last).removeDuplicates { a, b in
                a?.tone == b?.tone && a?.text.lowercased() == b?.text.lowercased()
            })
            .combineLatest(state.$snapshot.map(\.phase).removeDuplicates(), state.$ringing.removeDuplicates())
            .map { [weak self] top, phase, ring -> OrbPill? in
                let (problem, gate, toast) = top
                // A ring first (design11: ring > problem > gate > toast): its line, Snooze as the pill's one press.
                if let r = ring { return OrbPill(text: r.line, tone: .info, icon: "bell.fill", action: { [weak self] in self?.snoozeRing(r) }, actionTitle: "Snooze") }
                if let p = problem { return OrbPill(text: p, tone: .error) }
                if let g = gate { return g }
                if let t = toast { return OrbPill(text: t.text, tone: t.tone) }
                if phase == .paused { return OrbPill(text: "Paused · meter stopped", tone: .info, icon: "pause.fill") }
                return nil
            }
            .removeDuplicates()
            .sink { [weak self] pill in
                guard let self else { return }
                self.statusModel.pill = pill
                // The blob lifts a little off its foot so the pill has room.
                self.blobView.poke()
            }
            .store(in: &cancellables)

        // A saved position that arrives after show() (first snapshot) still wins,
        // as long as User has not moved the orb himself in the meantime.
        state.$snapshot
            .map(\.settings.orbPosition)
            .removeDuplicates()
            .compactMap { $0 }
            .sink { [weak self] pos in
                guard let self, !self.userMoved, !self.expanded, !self.tucked, self.downPoint == nil else { return }
                self.apply(savedPosition: pos)
            }
            .store(in: &cancellables)

        state.$threads.removeDuplicates().sink { [weak self] threads in
            let dots = AppState.railOrder(Array(threads.values)).filter { $0.status.isLive && $0.id != Self.mainThreadId }.map {
                ThreadDot(id: $0.id, name: $0.name, tone: OrbPalette.color(for: $0.status.presencePhase), status: $0.status, since: $0.startedAt / 1000)
            }
            self?.notch?.setThreads(dots)
        }.store(in: &cancellables)

        let nc = NotificationCenter.default
        // A Stop pressed anywhere in the app, the moment it is pressed.
        observers.append(nc.addObserver(forName: Self.stopPressedNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.reactToStop() }
        })
        observers.append(nc.addObserver(forName: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.sim.reducedMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }
        })
        observers.append(nc.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.screensDidChange() }
        })
        // Key status left by any other route (a click in another app): the field's
        // focus ring must not outlive it, and the panel may not take key again on its own.
        observers.append(nc.addObserver(forName: NSWindow.didResignKeyNotification, object: panel, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.panel.keyAllowed = false
                self.capsuleModel.keyLost += 1
            }
        })
    }

    private func gateChanged(_ gate: WakeGateState) {
        sim.setGate(BlobGate(gate))
        blobView.poke()
        notch?.view.wake()
        capsuleModel.wakeGate = gate
        deniedPillTimer?.cancel(); deniedPillTimer = nil
        switch gate {
        case .authenticating(let method):
            gatePill.send(OrbPill(text: OrbStyle.gatePrompt(method: method), tone: .info, icon: "lock.fill"))
        case .denied:
            gatePill.send(OrbPill(text: "Not this time", tone: .error, icon: "xmark.circle.fill"))
            deniedPillTimer = Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                guard !Task.isCancelled else { return }
                self?.gatePill.send(nil)
            }
        case .lockedOut(let until):
            gatePill.send(OrbPill(text: "Locked", tone: .warn, icon: "lock.slash.fill", until: until))
        case .off, .listening, .heard, .granted:
            gatePill.send(nil)
        }
    }

    private func clickNeedsKey(windowPoint: NSPoint) -> Bool {
        guard let frame = fieldFrameInWindow, !capsuleHost.isHidden else { return false }
        return frame.insetBy(dx: -2, dy: -2).contains(windowPoint)
    }

    /// The field's frame in window coordinates (AppKit, y up), from what SwiftUI
    /// reported in the capsule's own y-down space.
    private var fieldFrameInWindow: NSRect? {
        guard expanded, let f = fieldFrame else { return nil }
        let h = capsuleHost.bounds.height
        let local = capsuleHost.isFlipped ? f : NSRect(x: f.minX, y: h - f.maxY, width: f.width, height: f.height)
        return capsuleHost.convert(local, to: nil)
    }

    /// Give key status back the moment the field lets go of it, so the next keystroke
    /// lands in whatever User was working in. A non-activating panel has no window of
    /// its own to pass key to: ordering it out returns key to the active app's window,
    /// and ordering it straight back in (regardless, not key) leaves it where it was.
    private func releaseKey() {
        panel.keyAllowed = false
        guard panel.isKeyWindow else { return }
        panel.orderOut(nil)
        bringPanelForward()
    }

    private func makeDock(_ geometry: NotchGeometry) -> NotchDock {
        let dock = NotchDock(sim: sim, geometry: geometry)
        dock.togglePause = { [weak self] in self?.togglePause() }
        dock.stop = { [weak self] in self?.stopPressed() }
        dock.toggleMute = { [weak self] in self?.toggleMute() }
        dock.dragOut = { [weak self] p in self?.dragOutOfNotch(at: p) }
        dock.dragMoved = { [weak self] p in self?.pointerDragged(to: p) }
        dock.dragEnded = { [weak self] in self?.pointerUp() }
        // The island's boxes. Circle sends nothing itself (`mark.add` is the overlay's);
        // a thread's Stop is one `thread.stop`, never the transport's; Sleep is the
        // drop's sleep with its cause; nothing here opens a paid session but Go and a
        // typed line under `typedWakes`.
        dock.allow = { [weak self] id in self?.state.threadAnswer(id, yes: true) }
        dock.deny = { [weak self] id in self?.state.threadAnswer(id, yes: false) }
        dock.forgetMark = { [weak self] id in self?.state.markRemove(id) }
        dock.openMark = { [weak self] _ in self?.state.openConsole() }
        dock.openThread = { [weak self] id in self?.state.openThread(id) }
        dock.stopThread = { [weak self] id in self?.state.threadStop(id) }
        dock.circle = { [weak self] in self?.state.beginMarkMode() }
        dock.console = { [weak self] in self?.state.openConsole() }
        dock.remedy = { [weak self] row in self?.remedyFromDock(row) }
        dock.say = { [weak self] text in self?.state.send(.sayText(text)) }
        // The ring's presses (design11): Snooze · Done go to the row; the head and Open go to the Console — never a session.
        dock.snooze = { [weak self] id, minutes in self?.state.send(.automationSnooze(id: id, minutes: minutes)) }
        dock.done = { [weak self] id in self?.state.send(.automationDone(id: id)) }
        dock.ringOpen = { [weak self] _, _ in self?.state.openConsole() }
        dock.setThreads(AppState.railOrder(Array(state.threads.values)).filter { $0.status.isLive && $0.id != Self.mainThreadId }.map { ThreadDot(id: $0.id, name: $0.name, tone: OrbPalette.color(for: $0.status.presencePhase), status: $0.status, since: $0.startedAt / 1000) })
        dock.setContent(dockContent)
        return dock
    }

    // MARK: - The dock's boxes

    /// The foot's remedy box: the remedy's command when the engine gave one this app can
    /// send, its place when it named one (`hormes://settings` in-process), else
    /// `problem.retry` for the kind — the Console's dispatch.
    private func remedyFromDock(_ row: DockContent.ProblemRow) {
        if let json = row.remedyJSON, let data = json.data(using: .utf8),
           let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let cmd = EngineCommand(remedyJSON: obj) {
            state.send(cmd)
        } else if let target = row.openTarget, !target.isEmpty {
            if target.lowercased().hasPrefix("hormes://settings") {
                state.openSettings()
            } else if let url = URL(string: target) {
                NSWorkspace.shared.open(url)
            }
        } else {
            state.send(.problemRetry(kind: row.kind))
        }
    }

    /// ⌥⇧Return: type to Hormes — the notch's field while the blob is parked there, else
    /// the Console's composer.
    public func sayLine() {
        if tucked, let notch { notch.focusField() } else { state.openConsole() }
    }

    // MARK: - The dock's content

    /// One `DockContent` from the snapshot, the thread store (rail order: the asking
    /// thread first), the mark state and the gate. Spawned threads only: main's turn is
    /// the transport's; main's awaiting-confirmation delegation counts as "Hormes asks".
    private func buildDockContent(snapshot s: Snapshot, threads store: [String: WorkThread], marking: Bool, gate: WakeGateState,
                                  ringing: RingLine? = nil, nextFire: NextFire? = nil, automations: [Automation] = []) -> DockContent {
        let now = Date()
        let awake = s.phase != .asleep
        let inSession = AppState.inSessionPhases.contains(s.phase)
        let marks: [DockContent.Mark] = s.marks.map { m in
            DockContent.Mark(id: m.id, size: CGSize(width: m.rect.w, height: m.rect.h), at: Date(timeIntervalSince1970: m.at / 1000),
                             consumed: m.consumed, isWindow: m.isWindow, caption: ComposerWords.markCaption(m, now: now),
                             hasPixels: m.screenshotPath != nil, thumbnail: markThumbs[m.id])
        }
        let live = AppState.railOrder(Array(store.values)).filter { $0.status.isLive && $0.id != Self.mainThreadId }
        var rows: [DockContent.ThreadRow] = []
        var question: DockContent.Question?
        for t in live {
            let asking = t.status == .waitingUser
            rows.append(DockContent.ThreadRow(id: t.id, name: t.name, word: t.status.orbWord, since: Date(timeIntervalSince1970: t.startedAt / 1000),
                                              tone: OrbPalette.color(for: t.status.presencePhase), canStop: t.canStop && !asking, asks: t.question))
            if question == nil, asking, let q = t.question, !q.isEmpty {
                question = DockContent.Question(threadId: t.id, name: t.name, text: q)
            }
        }
        if question == nil, let d = s.delegations.last(where: { $0.status == .awaitingConfirmation }) {
            question = DockContent.Question(threadId: Self.mainThreadId, name: "Hormes", text: d.request)
        }
        var problem: DockContent.ProblemRow?
        if let p = s.problems.first {
            var json: String?
            if let cmd = p.remedy?.command, let data = try? JSONEncoder().encode(cmd) { json = String(data: data, encoding: .utf8) }
            problem = DockContent.ProblemRow(kind: p.kind, symbol: ProblemGlyphs.symbol(for: p.kind), warn: ProblemGlyphs.isWarning(p.kind), text: p.text,
                                             remedyLabel: p.remedy?.label, remedyJSON: json, openTarget: p.remedy?.open, more: max(0, s.problems.count - 1))
        }
        var meter = DockContent.Meter(inSession: inSession, paused: !inSession && s.pause != nil, elapsed: nil, sleepsIn: nil)
        if let session = s.session {
            meter.elapsed = max(0, now.timeIntervalSince1970 - session.startedAt / 1000)
            
        }
        if let pause = s.pause, !inSession {
            
            meter.sleepsIn = max(0, (pause.sleepsAt - now.timeIntervalSince1970 * 1000) / 1000)
        }
        let ws = s.settings.wake
        let gateLabel = awake ? nil : OrbStyle.gateLabel(gate, phrases: ws.phrases, auth: ws.auth, trigger: ws.trigger ?? .word, now: now, paused: s.phase == .paused, island: true)
        let rings = Self.ringRows(ringing: ringing, nextFire: nextFire, automations: automations, snoozeMinutes: s.settings.automationSettings.snoozeMinutes)
        return DockContent(awake: awake, inSession: inSession, typedWakes: s.settings.typedWakes,
                           request: s.delegations.last { $0.status == .running }?.request,
                           lastLine: s.transcript.last?.text, gateLabel: gateLabel,
                           marks: marks, question: question, threads: rows, problem: problem, meter: meter,
                           marking: marking, screenRecordingGranted: s.permissions.grant(.screenRecording) != .denied,
                           ring: rings.ring, next: rings.next, timer: rings.timer)
    }

    /// The ring (the newest `fired` row with a line), the foot's next fire and the soonest running timer, in the
    /// dock's words: the kind's label, the head's source line, the chip's figure, the Snooze box's minutes (the
    /// ring's own snooze press, else Settings — timers five).
    static func ringRows(ringing: RingLine?, nextFire: NextFire?, automations: [Automation], snoozeMinutes: Int) -> (ring: DockContent.RingRow?, next: DockContent.NextRow?, timer: DockContent.TimerRow?) {
        var ring: DockContent.RingRow?
        if let r = ringing {
            let row = automations.first { $0.id == r.id }
            let kind = AutomationKindWord(rawValue: r.kind) ?? row?.kind ?? .alarm
            let presses = r.presses.map { DockContent.RingPress(kind: $0.kind, minutes: $0.minutes, target: $0.target) }
            let snooze = presses.first { $0.kind == "snooze" }?.minutes ?? (kind == .timer ? 5 : snoozeMinutes)
            let head = RingWords.head(kindLabel: kind.label, whenKind: row?.when.kind, phrase: row?.when.phrase, eventKind: row?.when.on?.kind)
            ring = DockContent.RingRow(id: r.id, kind: kind.rawValue, kindLabel: kind.label, name: r.name, line: r.line, calm: r.calm, head: head,
                                       chip: RingWords.chip(line: r.line, name: r.name), lateMs: r.lateMs, presses: presses, more: max(0, r.more), snoozeMinutes: snooze)
        }
        var next: DockContent.NextRow?
        if let n = nextFire, n.at.isFinite {
            let kind = AutomationKindWord(rawValue: n.kind) ?? .alarm
            let at = Date(timeIntervalSince1970: n.at / 1000)
            next = DockContent.NextRow(kindLabel: kind.label, clock: RingWords.clock(at), name: n.name, until: kind == .timer ? at : nil)
        }
        let soonest = automations.filter { $0.kind == .timer && $0.state == "armed" && ($0.nextAt?.isFinite ?? false) }.min { ($0.nextAt ?? 0) < ($1.nextAt ?? 0) }
        let timer = soonest.map { DockContent.TimerRow(id: $0.id, name: $0.name, until: Date(timeIntervalSince1970: ($0.nextAt ?? 0) / 1000)) }
        return (ring, next, timer)
    }

    /// The capsule pill's Snooze (free mode): the ring's own snooze press, else Settings' minutes (timers five).
    private func snoozeRing(_ r: RingLine) {
        let settings = state.snapshot.settings.automationSettings.snoozeMinutes
        let minutes = r.presses.first { $0.kind == "snooze" }?.minutes ?? (r.kind == "timer" ? 5 : settings)
        state.send(.automationSnooze(id: r.id, minutes: minutes))
    }

    /// New content: the dock takes it; a mark that landed while tucked gets its six
    /// seconds of "◎ N circled · Go to ask"; crops on their way are asked for.
    private func dockContentChanged(_ c: DockContent, marks: [ScreenMark]) {
        if c.pendingMarks > pendingMarksSeen, tucked, !c.awake {
            notch?.showPill("◎ \(c.pendingMarks) circled · Go to ask", symbol: nil, tone: .mark, seconds: 6)
        }
        pendingMarksSeen = c.pendingMarks
        dockContent = c
        notch?.setContent(c)
        // The snapshot itself (not `state.snapshot`: `@Published` publishes before the property is set).
        requestThumbnails(for: marks)
    }

    /// Decode each mark's crop once its path appears, off the main thread, sized for the
    /// aspect-filled 84×60 film at 2× (the minis downsample from the same decode); drop
    /// what the snapshot no longer lists.
    private func requestThumbnails(for marks: [ScreenMark]) {
        let ids = Set(marks.map(\.id))
        markThumbs = markThumbs.filter { ids.contains($0.key) }
        markThumbsRequested = markThumbsRequested.filter { ids.contains($0) }
        for m in marks where !markThumbsRequested.contains(m.id) {
            guard let path = m.screenshotPath, !path.isEmpty else { continue }
            markThumbsRequested.insert(m.id)
            let id = m.id
            Thumbnails.shared.thumbnail(for: state.screenshotURL(path), maxPixel: Self.thumbMaxPixel) { [weak self] img in
                guard let self, let img, self.markThumbsRequested.contains(id) else { return }
                self.markThumbs[id] = img
                self.thumbsChanged.send(self.thumbsChanged.value + 1)
            }
        }
    }

    private func screensDidChange() {
        collapse()
        if !NSScreen.screens.contains(where: { $0.frame.intersects(panel.frame) }) { positioned = false; placeInitially() }
        updateHomeMode(animated: false)
    }
    private func updateHomeMode(animated: Bool) {
        let geometry = NotchGeometry.current()
        let wantsNotch = snapshotArrived && state.snapshot.settings.livesInNotch && !freeForSession && geometry != nil
        if let geometry {
            if notch == nil { notch = makeDock(geometry) } else { notch?.apply(geometry: geometry) }
        }
        if wantsNotch {
            collapse()
            tucked = true
            notch?.parked = true
            notch?.setContent(dockContent)
            notch?.setGatePill(gatePill.value)
            panel.orderOut(nil)
            blobView.paused = true
            if visible { notch?.show() }
        } else {
            if tucked, let dock = notch { place(center: dock.dropPointCG) }
            tucked = false
            notch?.parked = false
            if !draggingFromNotch { notch?.hide() }
            blobView.paused = !visible
            bringPanelForward()
        }
    }
    private func placeInitially() {
        positioned = true
        if let saved = state.snapshot.settings.orbPosition, apply(savedPosition: saved) { return }
        let frame = (NSScreen.main ?? NSScreen.screens.first)?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        panel.setFrame(NSRect(x: frame.maxX - Self.collapsedSize.width - 24, y: frame.minY + 96, width: Self.collapsedSize.width, height: Self.collapsedSize.height), display: true)
    }
    @discardableResult private func apply(savedPosition: OrbPosition) -> Bool {
        let point = CGPoint(x: savedPosition.x, y: savedPosition.y)
        let origin = CGSpace.appKitOrigin(topLeft: point, size: Self.collapsedSize)
        let frame = NSRect(origin: origin, size: Self.collapsedSize)
        guard point.isFinitePoint, NSScreen.screens.contains(where: { $0.frame.contains(NSPoint(x: frame.midX, y: frame.midY)) }) else { return false }
        panel.setFrame(frame, display: true)
        positioned = true
        return true
    }
    private func place(center: CGPoint) {
        let size = Self.collapsedSize
        let topLeft = CGPoint(x: center.x - size.width / 2, y: center.y - size.height / 2)
        panel.setFrame(NSRect(origin: CGSpace.appKitOrigin(topLeft: topLeft, size: size), size: size), display: true)
        positioned = true
    }
    private func dragOutOfNotch(at point: CGPoint) {
        freeForSession = true
        draggingFromNotch = true
        tucked = false
        notch?.parked = false
        place(center: point)
        downPoint = point
        dragOrigin = panel.frame.origin
        dragMoved = true
        userMoved = true
        blobView.paused = false
        bringPanelForward()
        blobView.poke()
    }
    private func pointerDragged(to point: CGPoint) {
        guard let down = downPoint else { return }
        guard dragMoved || hypot(point.x - down.x, point.y - down.y) >= 4 else { return }
        if expanded { collapse(); dragOrigin = panel.frame.origin }
        dragMoved = true
        userMoved = true
        panel.setFrameOrigin(NSPoint(x: dragOrigin.x + point.x - down.x, y: dragOrigin.y - (point.y - down.y)))
    }
    private func pointerUp() {
        defer { downPoint = nil; draggingFromNotch = false }
        guard dragMoved else { toggleExpanded(); return }
        notch?.hide()
        let center = CGSpace.point(fromAppKit: NSPoint(x: panel.frame.midX, y: panel.frame.midY))
        if let geometry = NotchGeometry.current(), NotchGeometry.catchZoneCG(geometry).contains(center) {
            freeForSession = false
            state.send(.setSettings(SettingsPatch(orbHome: "notch")))
            // The settings echo updates home mode. Snap immediately after the deliberate drop.
            tucked = true
            notch?.parked = true
            panel.orderOut(nil)
            blobView.paused = true
            if visible { notch?.show() }
        } else {
            // Clamp a released waveform to the screen without momentum or collision scanning.
            let screen = NSScreen.screens.first { $0.frame.contains(NSEvent.mouseLocation) } ?? NSScreen.main
            if let bounds = screen?.visibleFrame {
                let f = panel.frame
                panel.setFrameOrigin(NSPoint(x: min(max(f.minX, bounds.minX), bounds.maxX - f.width), y: min(max(f.minY, bounds.minY), bounds.maxY - f.height)))
            }
            let p = CGSpace.topLeft(ofAppKitFrame: panel.frame)
            state.send(.setSettings(SettingsPatch(orbPosition: OrbPosition(x: p.x, y: p.y))))
        }
    }
    private func expand() {
        guard !expanded else { return }
        expanded = true
        let old = panel.frame
        let size = Self.expandedSize
        let bounds = panel.screen?.visibleFrame ?? old
        characterOnRight = old.minX + size.width > bounds.maxX
        let x = characterOnRight ? old.maxX - size.width : old.minX
        let y = min(max(old.midY - size.height / 2, bounds.minY), bounds.maxY - size.height)
        blobCell.frame = NSRect(x: characterOnRight ? size.width - Self.collapsedSize.width : 0, y: old.minY - y, width: Self.collapsedSize.width, height: Self.collapsedSize.height)
        capsuleHost.frame = NSRect(x: characterOnRight ? 12 : Self.collapsedSize.width - 8, y: 18, width: size.width - Self.collapsedSize.width - 4, height: size.height - 36)
        panel.setFrame(NSRect(x: x, y: y, width: size.width, height: size.height), display: true)
        capsuleModel.blobOnRight = characterOnRight
        capsuleModel.wakeHeard = state.wakeHeard
        capsuleHost.isHidden = false
        capsuleModel.shown = true
        installDismissMonitors()
    }
    private func collapse() {
        guard expanded else { return }
        let frame = panel.convertToScreen(blobCell.convert(blobCell.bounds, to: nil))
        expanded = false
        removeDismissMonitors()
        releaseKey()
        capsuleHost.isHidden = true
        capsuleModel.shown = false
        fieldFrame = nil
        blobCell.frame = NSRect(origin: .zero, size: Self.collapsedSize)
        panel.setFrame(NSRect(origin: frame.origin, size: Self.collapsedSize), display: true)
    }
    private func installDismissMonitors() {
        removeDismissMonitors()
        if let global = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown], handler: { [weak self] _ in
            MainActor.assumeIsolated { self?.collapse() }
        }) { dismissMonitors.append(global) }
        if let local = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown], handler: { [weak self] event in
            if event.window !== self?.panel { self?.collapse() }
            return event
        }) { dismissMonitors.append(local) }
    }
    private func removeDismissMonitors() {
        for monitor in dismissMonitors { NSEvent.removeMonitor(monitor) }
        dismissMonitors.removeAll()
    }
    private func showMenu(for event: NSEvent) {
        let menu = NSMenu()
        menu.addItem(menuTarget.item("Open", symbol: "waveform") { [weak self] in self?.toggleExpanded() })
        if notch != nil { menu.addItem(menuTarget.item("Return to notch", symbol: "arrow.up") { [weak self] in self?.freeForSession = false; self?.state.send(.setSettings(SettingsPatch(orbHome: "notch"))); self?.updateHomeMode(animated: false) }) }
        menu.addItem(.separator())
        menu.addItem(menuTarget.item((state.phase == .asleep || state.phase == .paused ? "Go" : "Pause"), symbol: "playpause.fill") { [weak self] in self?.state.transportToggle() })
        menu.addItem(menuTarget.item("Stop", symbol: "stop.fill") { [weak self] in self?.stopPressed() })
        menu.addItem(menuTarget.item("Workspace", symbol: "rectangle.3.group") { [weak self] in self?.state.openConsole() })
        NSMenu.popUpContextMenu(menu, with: event, for: container)
    }
}

final class OrbPanel: NSPanel {
    var onMouseDown: ((NSEvent) -> Bool)?
    var onMouseDragged: ((NSEvent) -> Void)?
    var onMouseUp: ((NSEvent) -> Void)?
    var onRightClick: ((NSEvent) -> Void)?
    /// Does a click at this window point need the panel to be key (the passphrase field)? Set by the controller.
    var keyRequired: ((NSPoint) -> Bool)?

    private var tracking = false

    /// Never key on its own: the blob and the capsule's buttons work without it, and
    /// taking key status would redirect the keystrokes of whatever User was typing in.
    /// The capsule's passphrase field is the one exception: a click that lands in it
    /// opens this for the duration of `makeKey()` (`sendEvent`), and the controller
    /// hands key status back when the field lets go (`releaseKey`).
    var keyAllowed = false
    override var canBecomeKey: Bool { keyAllowed }
    override var canBecomeMain: Bool { false }

    /// The window goes where the body is, menu bar included. AppKit's default keeps
    /// every window's frame below the menu bar of its screen, which pinned the panel
    /// 27 pt under the notch dock while the body sat in it: the blob drew below the
    /// bar instead of emerging from under the ink, at every drop-out and every tuck.
    /// The body's own physics keep it on the work areas (`BlobBody.walls`,
    /// `keepOnSomeScreen`); the panel needs no second keeper.
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }

    /// While key — only ever with the passphrase field focused — the panel would also
    /// answer ⌘-shortcuts, and our main menu would take ⌘Q for a quit User did not
    /// mean. Editing shortcuts pass; every other ⌘ combination is swallowed.
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if event.modifierFlags.contains(.command) {
            let key = event.charactersIgnoringModifiers?.lowercased() ?? ""
            if !["a", "c", "v", "x", "z"].contains(key) { return true }
        }
        return super.performKeyEquivalent(with: event)
    }

    override func sendEvent(_ event: NSEvent) {
        switch event.type {
        case .leftMouseDown:
            if onMouseDown?(event) == true { tracking = true; return }
            // A click into a text input: become key (without activating the app — this is
            // a non-activating panel) so the field can take the keystrokes; a click
            // anywhere else leaves key status where it is.
            if !isKeyWindow, keyRequired?(event.locationInWindow) == true {
                keyAllowed = true
                makeKey()
                keyAllowed = false
                    }
        case .leftMouseDragged:
            if tracking { onMouseDragged?(event); return }
        case .leftMouseUp:
            if tracking { tracking = false; onMouseUp?(event); return }
        case .rightMouseDown:
            onRightClick?(event)
            return
        default:
            break
        }
        super.sendEvent(event)
    }
}

/// Hosts the status pill over the blob; never takes the mouse — except for the pill's
/// one-click action (the way back to the notch), and only on the pill's own band at
/// the foot of the cell, so the blob above it still takes the tap and the drag.
final class OrbPillHostingView: NSHostingView<OrbPillView> {
    override func hitTest(_ point: NSPoint) -> NSView? {
        guard rootView.status.pill?.action != nil else { return nil }
        let local = convert(point, from: superview)
        guard local.y <= 30 else { return nil }
        return super.hitTest(point)
    }
}

/// Hosts the capsule; takes the first click even though the panel is never key, so
/// a button press is a press and not a focus change.
final class OrbCapsuleHostingView: NSHostingView<OrbCapsuleView> {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

/// A menu item's action, held by the item's `representedObject` and released with it.
final class OrbMenuAction: NSObject {
    let run: () -> Void
    init(_ run: @escaping () -> Void) { self.run = run }
}

/// NSMenu target/action without making the controller an NSObject. Holds nothing
/// itself: every closure lives on its item, so right-clicks never accumulate state.
final class OrbMenuTarget: NSObject {
    func item(_ title: String, symbol: String, _ handler: @escaping () -> Void) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: #selector(fire(_:)), keyEquivalent: "")
        item.target = self
        item.representedObject = OrbMenuAction(handler)
        if let image = NSImage(systemSymbolName: symbol, accessibilityDescription: title) {
            item.image = image.withSymbolConfiguration(.init(pointSize: 13, weight: .medium))
        }
        return item
    }

    @objc private func fire(_ sender: NSMenuItem) {
        (sender.representedObject as? OrbMenuAction)?.run()
    }
}


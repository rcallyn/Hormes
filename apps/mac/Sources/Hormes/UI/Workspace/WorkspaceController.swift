import AppKit
import WebKit
import Combine
import AVFoundation
import EventKit

private final class WorkPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

private final class WorkSurface: NSView {
    var notchWidth: CGFloat = 220
    override func layout() {
        super.layout()
        let path = CGMutablePath()
        let body = CGRect(x: 0, y: 0, width: bounds.width, height: max(1, bounds.height - 34))
        path.addRoundedRect(in: body, cornerWidth: 22, cornerHeight: 22)
        path.addRect(CGRect(x: bounds.midX - notchWidth / 2, y: max(0, bounds.height - 56), width: notchWidth, height: 56))
        let mask = CAShapeLayer(); mask.path = path; layer?.mask = mask
    }
}

/// A bundled workspace: learning has its own window; compact tools use the notch panel.
/// Only typed protocol commands cross the bridge; page content cannot execute native code.
@MainActor
final class WorkspaceController: NSObject, WKScriptMessageHandler, WKNavigationDelegate, NSWindowDelegate {
    private let state: AppState
    private let groceryNotch: GroceryNotchController
    private let panel = WorkPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    private let whiteboard = WhiteboardWindow()
    private var boardPositioned = false
    private var boardAttached = false
    private var leavingFullScreen = false
    private var afterFullScreenExit: (() -> Void)?
    private var closeRequest: String?
    private var closeTimeout: Task<Void, Never>?
    private var web: WKWebView!
    private var webConstraints: [NSLayoutConstraint] = []
    private var workspaceVisible: Bool { panel.isVisible || whiteboard.isVisible }
    private var separateWindow: Bool {
        WhiteboardWindow.usesSeparateWindow(mode: latest?.state.active?.mode, surface: latest?.state.active?.surface?.kind)
    }
    private var subscriptions = Set<AnyCancellable>()
    private let speech = AVSpeechSynthesizer()
    private let calendar = EKEventStore()
    private var muted = false
    private var ready = false
    private var latest: HormesWorkReply?
    private var openRequest: String?
    private var resourceRoot: URL?
    private var shownOfferId: String?
    private var lecturePanelHeight = CGFloat(LecturePanelLayout.collapsedHeight)
    var visibility: (Bool) -> Void = { _ in }

    init(state: AppState) {
        self.state = state
        groceryNotch = GroceryNotchController(state: state)
        super.init()
        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "hormes")
        config.websiteDataStore = .nonPersistent()
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.setValue(false, forKey: "drawsBackground")
        panel.isOpaque = false; panel.backgroundColor = .clear; panel.hasShadow = true
        panel.level = .statusBar; panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        let host = WorkSurface(); host.wantsLayer = true
        host.notchWidth = NotchGeometry.current()?.notch.width ?? 220
        host.layer?.backgroundColor = NSColor.black.cgColor
        host.layer?.masksToBounds = true
        panel.contentView = host
        whiteboard.contentView = NSView()
        whiteboard.delegate = self
        boardPositioned = whiteboard.restoredFrame
        attachWeb(to: host, topInset: 34)
        state.workReplies.sink { [weak self] reply in self?.receive(reply) }.store(in: &subscriptions)
        state.$snapshot.map(\.phase).removeDuplicates().sink { [weak self] phase in
            guard let self, self.ready, let latest = self.latest else { return }
            self.send(latest, voicePhase: phase)
        }.store(in: &subscriptions)
        state.workActionHandler = { [weak self] command in self?.perform(command) }
        state.workCalendarHandler = { [weak self] in Task { await self?.readCalendar() } }
        Timer.publish(every: 60, on: .main, in: .common).autoconnect().sink { [weak self] _ in
            guard let self, self.state.connected, self.state.work.calendarEnabled == true else { return }
            Task { await self.readCalendar(requestPermission: false) }
        }.store(in: &subscriptions)
        NotificationCenter.default.publisher(for: .EKEventStoreChanged).sink { [weak self] _ in
            guard let self, self.state.work.calendarEnabled == true else { return }
            Task { await self.readCalendar(requestPermission: false) }
        }.store(in: &subscriptions)
        state.$connected.removeDuplicates().sink { [weak self] connected in
            guard connected, let self else { return }
            // Startup may occur on the lock screen before a distributed notification.
            let locked = self.screenLocked
            self.state.systemSignal(SystemSignal(kind: locked ? "screen.lock" : "screen.unlock"))
        }.store(in: &subscriptions)
        if let root = Bundle.main.resourceURL?.appendingPathComponent("Workspace"), FileManager.default.fileExists(atPath: root.appendingPathComponent("index.html").path) {
            resourceRoot = root; web.loadFileURL(root.appendingPathComponent("index.html"), allowingReadAccessTo: root)
        }
    }
    private func receive(_ reply: HormesWorkReply) {
        let oldSession = latest?.state.active
        let oldSurface = latest?.state.active?.surface?.id
        let oldMeetingStatus = latest?.state.active?.meeting?.status
        let oldCalendarSelection = latest?.state.selectedCalendarIds
        latest = reply
        if oldSession?.id != reply.state.active?.id { lecturePanelHeight = CGFloat(LecturePanelLayout.collapsedHeight) }
        if !LecturePanelLayout.allowsSpeech(mode: reply.state.active?.mode), speech.isSpeaking { speech.stopSpeaking(at: .immediate) }
        if reply.ok, oldCalendarSelection != reply.state.selectedCalendarIds {
            Task { await self.readCalendar(requestPermission: false) }
        }
        if ready { send(reply) }
        if reply.requestId == closeRequest {
            closeTimeout?.cancel(); closeTimeout = nil
            closeRequest = nil
            if reply.ok { close() }
        }
        if reply.ok, let session = reply.state.active, session.mode == "grocery", oldSession?.id == session.id,
           session.grocery?.phase == "review", oldSession?.grocery?.review?.at != session.grocery?.review?.at,
           session.grocery?.review != nil { show(passive: true) }
        if workspaceVisible, reply.state.active?.mode == "meeting", oldMeetingStatus != reply.state.active?.meeting?.status { show(passive: true) }
        if reply.ok, reply.presentation == "open", reply.state.active != nil { shownOfferId = nil; show(passive: true) }
        if reply.requestId == openRequest {
            openRequest = nil
            if reply.ok && reply.state.active != nil { shownOfferId = nil; show() }
            if reply.ok && reply.state.quiet { close() }
        }
        if let offer = reply.state.offer, !screenLocked, reply.state.active == nil, offer.id != shownOfferId {
            shownOfferId = offer.id; show(passive: true)
        } else if reply.state.offer == nil && shownOfferId != nil {
            shownOfferId = nil; close()
        }
        if let surface = reply.state.active?.surface, surface.id != oldSurface, !screenLocked {
            if ["flashcard", "quiz", "image", "break"].contains(surface.kind) || workspaceVisible {
                show(passive: true)
            }
        }
        if let text = reply.speech, workspaceVisible, !reply.state.quiet, !muted, state.snapshot.session == nil,
           LecturePanelLayout.allowsSpeech(mode: reply.state.active?.mode) {
            let utterance = AVSpeechUtterance(string: text)
            utterance.rate = AVSpeechUtteranceDefaultSpeechRate
            speech.speak(utterance)
        }
        if !reply.ok { state.toast(reply.message ?? "Work could not be saved", tone: .error) }
    }
    private func send(_ reply: HormesWorkReply, voicePhase: Phase? = nil) {
        var payload = reply; payload.voicePhase = (voicePhase ?? state.phase).rawValue
        guard let data = try? JSONEncoder().encode(payload), let json = String(data: data, encoding: .utf8) else { return }
        Task { _ = try? await web.callAsyncJavaScript("window.hormes.receive(JSON.parse(payload))", arguments: ["payload": json], in: nil, contentWorld: .page) }
    }
    func perform(_ command: HormesWorkCommand) {
        let send = { [weak self] in
            guard let self else { return }
            if ["tasks.start", "education.practice", "education.return", "start", "resume", "demo", "offer.accept", "class.next"].contains(command.action) { self.openRequest = command.requestId }
            self.speech.stopSpeaking(at: .immediate)
            self.state.send(.work(command))
        }
        if ready && (workspaceVisible || boardAttached) {
            Task {
                do { _ = try await web.callAsyncJavaScript("await window.hormes.flush()", arguments: [:], in: nil, contentWorld: .page); send() }
                catch { state.toast("The board is not saved yet. Retry before switching.", tone: .error) }
            }
        } else { send() }
    }
    private var screenLocked: Bool {
        guard let info = CGSessionCopyCurrentDictionary() as? [String: Any] else { return true }
        return (info["CGSSessionScreenIsLocked"] as? Bool ?? false) || !(info[kCGSessionOnConsoleKey as String] as? Bool ?? false)
    }
    private func attachWeb(to host: NSView, topInset: CGFloat = 0) {
        NSLayoutConstraint.deactivate(webConstraints)
        web.removeFromSuperview()
        host.addSubview(web)
        web.translatesAutoresizingMaskIntoConstraints = false
        webConstraints = [web.leadingAnchor.constraint(equalTo: host.leadingAnchor),
                          web.trailingAnchor.constraint(equalTo: host.trailingAnchor),
                          web.bottomAnchor.constraint(equalTo: host.bottomAnchor),
                          web.topAnchor.constraint(equalTo: host.topAnchor, constant: topInset)]
        NSLayoutConstraint.activate(webConstraints)
    }

    private func afterLeavingFullScreen(_ action: @escaping () -> Void) {
        guard whiteboard.styleMask.contains(.fullScreen) || leavingFullScreen else { action(); return }
        afterFullScreenExit = action
        if !leavingFullScreen { leavingFullScreen = true; whiteboard.toggleFullScreen(nil) }
    }

    func windowDidExitFullScreen(_ notification: Notification) {
        leavingFullScreen = false
        let action = afterFullScreenExit; afterFullScreenExit = nil
        action?()
    }

    func windowDidFailToExitFullScreen(_ window: NSWindow) {
        leavingFullScreen = false; afterFullScreenExit = nil
        state.toast("Exit full screen before closing or switching the workspace.", tone: .info)
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        guard sender === whiteboard, closeRequest == nil else { return false }
        // Match the workspace's close button: flush real ink, then await the pause reply.
        guard let sessionId = latest?.state.active?.id else { close(); return false }
        let command = HormesWorkCommand(action: "pause", sessionId: sessionId)
        closeRequest = command.requestId
        closeTimeout?.cancel()
        closeTimeout = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 15_000_000_000)
            guard !Task.isCancelled, let self, self.closeRequest == command.requestId else { return }
            self.closeRequest = nil
            self.state.toast("The lesson did not confirm closing. Reconnect and try again.", tone: .error)
        }
        Task {
            do {
                if ready { _ = try await web.callAsyncJavaScript("await window.hormes.flush()", arguments: [:], in: nil, contentWorld: .page) }
                guard latest?.state.active?.id == sessionId, closeRequest == command.requestId else {
                    if closeRequest == command.requestId { closeRequest = nil }
                    return
                }
                state.send(.work(command))
            } catch {
                guard closeRequest == command.requestId else { return }
                closeTimeout?.cancel(); closeTimeout = nil; closeRequest = nil
                state.toast("The board is not saved yet. Retry before closing.", tone: .error)
            }
        }
        return false
    }

    private func showWhiteboard(passive: Bool) {
        panel.orderOut(nil)
        if !boardAttached, let host = whiteboard.contentView {
            attachWeb(to: host); boardAttached = true
        }
        // Independent learning leaves the voice/annotation notch available.
        visibility(false)
        whiteboard.title = latest?.state.active.map { "\($0.title) · Hormes" } ?? "Hormes Whiteboard"
        if !boardPositioned {
            let screen = NSScreen.main ?? NSScreen.screens.first
            if let screen {
                let visible = screen.visibleFrame
                let frame = NSRect(x: visible.midX - min(1080, visible.width - 48) / 2,
                                   y: visible.midY - min(780, visible.height - 48) / 2,
                                   width: min(1080, visible.width - 48), height: min(780, visible.height - 48))
                whiteboard.setFrame(frame, display: false)
            }
            boardPositioned = true
        }
        if passive {
            // A tutor update cannot reset a chosen size, move the window, or undo minimization.
            if !whiteboard.isVisible && !whiteboard.isMiniaturized { whiteboard.orderFront(nil) }
        } else {
            if whiteboard.isMiniaturized { whiteboard.deminiaturize(nil) }
            whiteboard.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    private func show(passive: Bool = false) {
        guard !screenLocked else { return }
        guard resourceRoot != nil else { state.toast("Build the Hormes workspace before opening it.", tone: .error); return }
        if separateWindow {
            afterFullScreenExit = nil
            showWhiteboard(passive: passive)
            return
        }
        if whiteboard.styleMask.contains(.fullScreen) || leavingFullScreen {
            afterLeavingFullScreen { [weak self] in self?.show(passive: passive) }
            return
        }
        whiteboard.orderOut(nil)
        if boardAttached, let host = panel.contentView {
            attachWeb(to: host, topInset: 34); boardAttached = false
        }
        let geometry = NotchGeometry.current()
        let screen = geometry?.screen ?? NSScreen.main?.frame ?? NSRect(x: 0, y: 0, width: 1200, height: 800)
        let center = geometry?.notch.midX ?? screen.midX
        let mode = latest?.state.active?.mode
        let size: NSSize
        let surface = latest?.state.active?.surface?.kind
        switch surface ?? (latest?.state.active == nil ? "offer" : mode) {
        case "lecture", "class": size = NSSize(width: 740, height: lecturePanelHeight)
        case "class-review": size = NSSize(width: 620, height: 280)
        case "flashcard": size = NSSize(width: 620, height: 390)
        case "quiz": size = NSSize(width: 660, height: 550)
        case "image": size = NSSize(width: 780, height: 620)
        case "break": size = NSSize(width: 280, height: 115)
        case "offer": size = NSSize(width: 440, height: 220)
        case "coding": size = NSSize(width: 540, height: 300)
        case "review": size = NSSize(width: 620, height: 420)
        case "meeting": size = latest?.state.active?.meeting?.status == "recording" ? NSSize(width: 740, height: 290) : NSSize(width: 780, height: 620)
        case "grocery": size = NSSize(width: 560, height: 490)
        case "travel": size = NSSize(width: 860, height: 700)
        default: size = NSSize(width: 1080, height: 760)
        }
        let width = min(size.width, screen.width - 48), height = min(size.height, screen.height - 64)
        let target = NSRect(x: center - width / 2, y: screen.maxY - height, width: width, height: height)
        visibility(true)
        if !panel.isVisible { panel.setFrame(NSRect(x: center - 160, y: screen.maxY - 38, width: 320, height: 38), display: false) }
        if passive { panel.orderFront(nil) }
        else {
            // A deliberate workspace action needs keyboard focus. Passive offers
            // retain the nonactivating panel behavior and never steal it.
            NSApp.activate(ignoringOtherApps: true)
            panel.makeKeyAndOrderFront(nil)
        }
        NSAnimationContext.runAnimationGroup { context in
            context.duration = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? 0 : 0.3
            context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            panel.animator().setFrame(target, display: true)
        }
    }
    func flushBeforeQuit() async -> Bool {
        guard ready else { return true }
        do { _ = try await web.callAsyncJavaScript("await window.hormes.flush()", arguments: [:], in: nil, contentWorld: .page); return true }
        catch { state.toast("Your board has unsaved changes. Reconnect and retry quitting.", tone: .error); return false }
    }
    private func close() {
        speech.stopSpeaking(at: .immediate)
        if boardAttached {
            afterLeavingFullScreen { [weak self] in
                self?.whiteboard.orderOut(nil)
                self?.visibility(false)
            }
            return
        }
        guard panel.isVisible else { return }
        let frame = panel.frame
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? 0 : 0.22
            panel.animator().setFrame(NSRect(x: frame.midX - 160, y: frame.maxY - 38, width: 320, height: 38), display: true)
        }, completionHandler: { [weak self] in
            Task { @MainActor in self?.panel.orderOut(nil); self?.visibility(false) }
        })
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        ready = true; if let latest { send(latest) }
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if url.isFileURL, let root = resourceRoot, url.standardizedFileURL.path.hasPrefix(root.standardizedFileURL.path + "/") { decisionHandler(.allow); return }
        if ["https", "http"].contains(url.scheme ?? ""), action.navigationType == .linkActivated { NSWorkspace.shared.open(url) }
        decisionHandler(.cancel)
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let url = message.frameInfo.request.url, url.isFileURL,
              let root = resourceRoot, url.standardizedFileURL.path.hasPrefix(root.standardizedFileURL.path + "/"),
              let body = message.body as? [String: Any] else { return }
        if let raw = body["command"], let data = try? JSONSerialization.data(withJSONObject: raw), let command = try? JSONDecoder().decode(HormesWorkCommand.self, from: data) {
            if command.action == "offer.accept" { perform(command) }
            else { state.send(.work(command)) }
            return
        }
        switch body["native"] as? String {
        case "lecture-layout":
            if let value = body["value"] as? [String: Any], let id = value["sessionId"] as? String,
               let measured = value["height"] as? Double,
               let height = LecturePanelLayout.height(measured, sessionId: id, activeId: latest?.state.active?.id, mode: latest?.state.active?.mode),
               abs(CGFloat(height) - lecturePanelHeight) > 1 {
                lecturePanelHeight = CGFloat(height)
                if panel.isVisible { show(passive: true) }
            }
        case "close": close()
        case "console": state.workConsoleHandler()
        case "source":
            if let id = body["value"] as? String, let source = state.work.sources.first(where: { $0.id == id }), let path = source.path {
                let url = URL(fileURLWithPath: path)
                if FileManager.default.fileExists(atPath: path) { NSWorkspace.shared.open(url) }
                else { state.toast("The source file is not at its saved location.", tone: .info) }
            }
        case "meeting-file":
            if let id = body["value"] as? String, let file = state.work.active?.meeting?.attachments.first(where: { $0.id == id }) {
                if FileManager.default.fileExists(atPath: file.path) { NSWorkspace.shared.open(URL(fileURLWithPath: file.path)) }
                else { state.toast("The meeting attachment is missing. Regenerate it before review.", tone: .error) }
            }
        case "meeting-draft":
            if let meeting = state.work.active?.meeting, let draft = meeting.followUp, draft.revision == meeting.revision,
               draft.reviewedAt != nil, let path = draft.exportPath, FileManager.default.fileExists(atPath: path) {
                NSWorkspace.shared.open(URL(fileURLWithPath: path))
            }
        case "speech": muted = body["value"] as? Bool ?? true; if muted { speech.stopSpeaking(at: .immediate) }
        case "voice": speech.stopSpeaking(at: .immediate); state.send(state.snapshot.session == nil ? .go : state.phase == .muted ? .unmute : .mute)
        default: break
        }
    }
    private func readCalendar(requestPermission: Bool = true) async {
        if requestPermission { state.workCalendarStatus = "Reading Calendar…" }
        do {
            let allowed: Bool
            if requestPermission { allowed = try await calendar.requestFullAccessToEvents() }
            else { allowed = EKEventStore.authorizationStatus(for: .event) == .fullAccess }
            guard allowed else {
                state.workCalendarStatus = "Calendar read access is unavailable. Enable full Calendar access in macOS Privacy & Security."
                if requestPermission { state.toast("Calendar access was not granted. Manual sessions still work.", tone: .info) }
                state.send(.work(HormesWorkCommand(action: "calendar", events: []))); return
            }
            let available = Array(calendar.calendars(for: .event).sorted {
                ($0.source.title, $0.title, $0.calendarIdentifier) < ($1.source.title, $1.title, $1.calendarIdentifier)
            }.prefix(200))
            let sources = available.map { HormesCalendarSource(id: $0.calendarIdentifier, title: $0.title, account: $0.source.title.isEmpty ? "Calendar account" : $0.source.title) }
            let selected = Set(state.work.selectedCalendarIds ?? [])
            let calendars = available.filter { selected.contains($0.calendarIdentifier) }
            let start = Calendar.current.startOfDay(for: Date())
            let end = Calendar.current.date(byAdding: .day, value: 1, to: start)!
            // EventKit treats an empty/nil calendar filter as all calendars. Do not query it.
            let matches = calendars.isEmpty ? [] : calendar.events(matching: calendar.predicateForEvents(withStart: start, end: end, calendars: calendars))
            let events = matches.sorted { $0.startDate < $1.startDate }.prefix(100).compactMap { event -> HormesCalendarEvent? in
                guard let identifier = event.eventIdentifier else { return nil }
                return HormesCalendarEvent(id: identifier, title: event.title ?? "Calendar event", startsAt: event.startDate.timeIntervalSince1970 * 1000, endsAt: event.endDate.timeIntervalSince1970 * 1000, calendar: event.calendar.title, sourceCalendarId: event.calendar.calendarIdentifier, demo: false)
            }
            state.send(.work(HormesWorkCommand(action: "calendar", events: events, calendarSources: sources)))
            state.workCalendarStatus = calendars.isEmpty ? "Choose calendars below to read today's events." : "\(events.count) events read from \(calendars.count) selected calendars."
        } catch {
            state.workCalendarStatus = "Calendar could not be read: \(error.localizedDescription)"
            state.toast(state.workCalendarStatus, tone: .error)
        }
    }
}

import AppKit
import SwiftUI

/// Fake data only: no daemon, microphone, credential writes, or paid sessions.
@main
struct PreviewMain {
    static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let delegate = PreviewDelegate()
        app.delegate = delegate
        app.run()
    }
}

@MainActor
final class PreviewDelegate: NSObject, NSApplicationDelegate {
    let state = AppState()
    let session = ConsoleSession()
    var window: NSWindow?
    var orb: OrbPanelController?
    var screenshotTimer: Timer?

    func applicationDidFinishLaunching(_ note: Notification) {
        let scenario = ProcessInfo.processInfo.environment["PREVIEW_SCENARIO"] ?? "activity"
        state.stateDir = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("hormes-simplification-preview")
        state.connected = true
        state.snapshot = .empty
        state.snapshot.phase = .asleep
        state.snapshot.settings.wake.trigger = .clap
        state.snapshot.settings.voiceProvider = "gemini"
        state.snapshot.settings.brain = .local
        state.snapshot.settings.orbHome = scenario == "notch" ? "notch" : "free"
        state.sendHandler = { command in print("preview command: \(command.json)") }
        let summaries = ["Review exchange economies", "Plan the coding block"].enumerated().map { index, title in
            try! hormesJSONDecoder.decode(HormesSessionSummary.self, from: JSONSerialization.data(withJSONObject:
                ["id": "preview-\(index)", "day": "2026-10-11", "startedAt": Date().timeIntervalSince1970 * 1000 - Double(index + 1) * 3_600_000,
                 "closedAt": Date().timeIntervalSince1970 * 1000 - Double(index + 1) * 3_500_000, "reason": "paused",
                 "usageSeconds": 60, "heard": 1, "said": 1, "delegations": 0, "title": title]))
        }
        state.installHormesSessions(list: { summaries }, rows: { _ in [LedgerRow(at: 1, type: "session.started")] })
        if scenario == "waveform" || scenario == "waveform-open" || scenario == "notch" {
            NotchGeometry.simulate = scenario == "notch"
            orb = OrbPanelController(state: state)
            orb?.show()
            if scenario == "notch" || scenario == "waveform-open" { DispatchQueue.main.async { self.orb?.toggleExpanded() } }
        } else {
            if scenario == "education" { session.showEducation() }
            else if scenario == "tasks" { session.showTasks() }
            else if scenario != "library" { session.showNow() }
            let frame = NSRect(x: 120, y: 120, width: 1100, height: 760)
            let window = NSWindow(contentRect: frame, styleMask: [.titled, .closable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
            window.title = "Hormes preview"
            window.titlebarAppearsTransparent = true
            window.titleVisibility = .hidden
            window.isReleasedWhenClosed = false
            let root = ConsoleRootView().environmentObject(state).environmentObject(session)
                .environment(\.consoleActions, ConsoleActions(send: { [state] in state.send($0) }, stop: { [state] in state.transportStop() }))
                .environment(\.consoleTransport, ConsoleTransport(toggle: { [state] in state.transportToggle() }))
            let host = NSHostingView(rootView: root)
            host.sizingOptions = []
            window.contentView = host
            window.makeKeyAndOrderFront(nil)
            self.window = window
            session.windowVisible = true
            if scenario == "settings" { DispatchQueue.main.async { self.session.showsSystem = true } }
        }
        let delay = Double(ProcessInfo.processInfo.environment["PREVIEW_SETTLE"] ?? "2") ?? 2
        screenshotTimer = Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated { self?.capture(scenario) }
        }
    }

    private func capture(_ scenario: String) {
        let target = scenario == "settings" ? window?.attachedSheet : window ?? NSApp.windows.first { $0.isVisible }
        guard let window = target, let view = window.contentView,
              let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { exit(1) }
        view.cacheDisplay(in: view.bounds, to: bitmap)
        guard let data = bitmap.representation(using: .png, properties: [:]) else { exit(1) }
        let out = ProcessInfo.processInfo.environment["PREVIEW_OUT"] ?? "/tmp/hormes-preview-\(scenario).png"
        do {
            try data.write(to: URL(fileURLWithPath: out))
            print("preview saved: \(out)")
            orb?.hide()
            NSApp.terminate(nil)
        } catch { print(error); exit(1) }
    }
}

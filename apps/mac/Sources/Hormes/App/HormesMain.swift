import AppKit

#if !HORMES_ORB_PREVIEW
@main
struct HormesMain {
    @MainActor private static var signalSources: [DispatchSourceSignal] = []

    @MainActor static func main() {
        // One Hormes per state dir, decided before anything exists: a second launch hands off to the
        // first and exits here, before NSApplication (no check-in, no Dock tile), the crash guard, the
        // daemon, audio or hotkeys (SingleInstance.swift).
        SingleInstance.ensureOne(stateDir: AppDelegate.stateDir())

        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.regular)

        // `pkill Hormes` / Ctrl-C should quit the same way ⌘Q does, so the daemon is
        // stopped and the voice session put to sleep instead of the process just vanishing.
        for sig in [SIGTERM, SIGINT] {
            signal(sig, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
            source.setEventHandler { MainActor.assumeIsolated { QuitRequest.schedule() } }
            source.resume()
            signalSources.append(source)
        }

        app.run()
    }
}
#endif

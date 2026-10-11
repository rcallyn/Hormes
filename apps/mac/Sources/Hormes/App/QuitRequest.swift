import AppKit

/// AppKit waits in a nested run loop for an asynchronous termination reply.
/// Enter it after the dispatch callback returns, so save tasks on the main
/// actor can run. Entering it inside a main-queue signal handler strands them.
@MainActor
enum QuitRequest {
    static func schedule() {
        RunLoop.main.perform(inModes: [.common]) {
            MainActor.assumeIsolated { NSApplication.shared.terminate(nil) }
        }
    }
}

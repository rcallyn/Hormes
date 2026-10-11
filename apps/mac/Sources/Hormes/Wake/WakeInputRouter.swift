import AppKit
import Combine
import CoreGraphics
import Foundation

/// Shares the existing wake listener tap. No second audio graph or cloud call.
/// The unchanged WakeGate still owns authentication, retries and lockout.
@MainActor
final class WakeInputRouter: @preconcurrency WakeListening {
    var onTranscript: ((String, Bool, Int) -> Void)?
    var onStatus: ((WakeWordListener.Status) -> Void)?
    var onClap: (() -> Void)?
    private let listener = WakeWordListener()
    private weak var state: AppState?
    private let processor = ClapSignalProcessor()
    private var subscriptions = Set<AnyCancellable>()
    private var observers: [NSObjectProtocol] = []
    private var unlocked = WakeInputRouter.sessionUnlocked()
    private var trigger: WakeTrigger = .word
    private var enabled = false
    private var running = false

    init(state: AppState) {
        self.state = state
        listener.onTranscript = { [weak self] text, final, segment in
            MainActor.assumeIsolated {
                guard let self else { return }
                if WakeGesturePolicy.forwardsWords(trigger: self.trigger, authenticating: state.wakeGate.isAuthenticating) {
                    self.onTranscript?(text, final, segment)
                }
            }
        }
        listener.onStatus = { [weak self] status in self?.onStatus?(status) }
        listener.onClapFrames = { [weak self, processor] frames in
            processor.feed(frames) { [weak self] in MainActor.assumeIsolated { self?.clap() } }
        }
        state.$snapshot.map { $0.settings.wake }.removeDuplicates().sink { [weak self] wake in
            MainActor.assumeIsolated {
                self?.trigger = wake.trigger ?? .word; self?.enabled = wake.enabled; self?.reset()
            }
        }.store(in: &subscriptions)
        let center = NSWorkspace.shared.notificationCenter
        observers.append(center.addObserver(forName: NSWorkspace.sessionDidResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.unlocked = false; self?.reset() }
        })
        observers.append(center.addObserver(forName: NSWorkspace.sessionDidBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.unlocked = true; self?.reset() }
        })
    }
    deinit { for observer in observers { NSWorkspace.shared.notificationCenter.removeObserver(observer) } }
    private static func sessionUnlocked() -> Bool {
        guard let info = CGSessionCopyCurrentDictionary() as? [String: Any] else { return false }
        return !(info["CGSSessionScreenIsLocked"] as? Bool ?? false) && (info[kCGSessionOnConsoleKey as String] as? Bool ?? false)
    }
    private func reset() { processor.reset() }
    private func clap() {
        guard let state, running, WakeGesturePolicy.acceptsClap(trigger: trigger, enabled: enabled,
            listening: state.wakeGate.isListening, quiet: state.localSpeaker.isQuiet(now: Date()),
            unlocked: unlocked && Self.sessionUnlocked(), audioEnabled: WakeGate.audioEnabled(ProcessInfo.processInfo.environment)) else { return }
        onClap?()
    }
    func start() { running = true; reset(); listener.start() }
    func stop() { running = false; reset(); listener.stop() }
    func setContextualStrings(_ strings: [String]) { listener.setContextualStrings(strings) }
    func rollSegment(_ completion: @escaping (Int?) -> Void) { listener.rollSegment(completion) }
}

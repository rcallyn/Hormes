import Foundation

extension ThreadStatus {
    /// The corresponding voice-presence state.
    var presencePhase: Phase {
        switch self {
        case .idle, .queued, .starting, .thinking: return .connecting
        case .acting: return .acting
        case .waitingScreen: return .thinking
        case .waitingUser: return .listening
        case .paused: return .paused
        case .done: return .speaking
        case .failed: return .error
        case .stopped: return .asleep
        }
    }

    /// Compact status for the notch and session list.
    var orbWord: String {
        switch self {
        case .idle: return "idle"
        case .queued: return "queued"
        case .starting: return "starting"
        case .thinking: return "thinking"
        case .acting: return "working"
        case .waitingScreen: return "waiting"
        case .waitingUser: return "asks"
        case .paused: return "paused"
        case .done: return "done"
        case .failed: return "failed"
        case .stopped: return "stopped"
        }
    }
}


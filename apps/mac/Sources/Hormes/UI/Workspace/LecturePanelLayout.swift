import Foundation

/// Only the current lecture may resize its notch panel. Measurements are bounded
/// independently of web content and never open a folded panel.
enum LecturePanelLayout {
    static let collapsedHeight: Double = 260
    static func height(_ measurement: Double, sessionId: String, activeId: String?, mode: String?) -> Double? {
        guard measurement.isFinite, measurement > 0, mode == "class", sessionId == activeId else { return nil }
        return min(640, max(collapsedHeight, measurement.rounded(.up)))
    }
    static func allowsSpeech(mode: String?) -> Bool { mode != "class" }
}

import AppKit

/// The learning workspace is a document-sized window, independent of the voice notch.
/// Its web view stays alive while the window is hidden or moved between displays.
@MainActor
final class WhiteboardWindow: NSWindow {
    override var canBecomeMain: Bool { true }
    override var canBecomeKey: Bool { true }

    let restoredFrame: Bool

    init() {
        restoredFrame = UserDefaults.standard.string(forKey: "NSWindow Frame HormesWhiteboard") != nil
        super.init(contentRect: NSRect(x: 0, y: 0, width: 1080, height: 760),
                   styleMask: [.titled, .closable, .resizable, .miniaturizable],
                   backing: .buffered, defer: false)
        title = "Hormes Whiteboard"
        minSize = NSSize(width: 680, height: 460)
        isReleasedWhenClosed = false
        tabbingMode = .disallowed
        collectionBehavior = [.fullScreenPrimary]
        backgroundColor = NSColor(white: 0.035, alpha: 1)
        appearance = NSAppearance(named: .darkAqua)
        setFrameAutosaveName("HormesWhiteboard")
        if restoredFrame { setFrameUsingName("HormesWhiteboard") }
    }

    static func usesSeparateWindow(mode: String?, surface: String?) -> Bool {
        ["study", "exam", "review"].contains(mode ?? "") || surface == "whiteboard"
    }
}

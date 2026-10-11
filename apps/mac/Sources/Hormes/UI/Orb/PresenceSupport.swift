import AppKit

enum CGSpace {
    /// The primary display's top edge in AppKit space; CG's origin sits there.
    static var mainMaxY: CGFloat { NSScreen.screens.first?.frame.maxY ?? 0 }

    static func rect(fromAppKit r: NSRect) -> CGRect {
        CGRect(x: r.minX, y: mainMaxY - r.maxY, width: r.width, height: r.height)
    }

    static func point(fromAppKit p: NSPoint) -> CGPoint { CGPoint(x: p.x, y: mainMaxY - p.y) }

    static func appKitOrigin(topLeft p: CGPoint, size: CGSize) -> NSPoint {
        NSPoint(x: p.x, y: mainMaxY - p.y - size.height)
    }

    static func topLeft(ofAppKitFrame f: NSRect) -> CGPoint { CGPoint(x: f.minX, y: mainMaxY - f.maxY) }
}

struct ThreadDot: Equatable {
    let id: String
    let name: String
    let tone: RGB
    let status: ThreadStatus
    /// When it started, seconds since 1970 (the record's `startedAt` / 1000).
    let since: Double
}


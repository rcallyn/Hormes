import SwiftUI

/// Providers share one neutral visual identity in Console.
func brandColor(_ tool: AgentTool) -> Color { ConsoleTheme.fg }

struct BrandMark: View {
    let tool: AgentTool
    var size: CGFloat = 14
    var quiet = false
    var body: some View {
        Image(systemName: "circle.hexagongrid.fill").resizable().scaledToFit()
            .foregroundStyle(quiet ? ConsoleTheme.fg3 : ConsoleTheme.fg)
            .frame(width: size, height: size).frame(width: 20, height: 20)
            .alignmentGuide(.firstTextBaseline) { d in d[.bottom] - 5 }
            .alignmentGuide(.lastTextBaseline) { d in d[.bottom] - 5 }
            .accessibilityLabel(quiet ? "Agent, over" : "Agent")
    }
}

/// The five white voice bars used throughout Hormes.
struct HormesMark: View {
    var size: CGFloat = 14
    var quiet = false
    var body: some View {
        HStack(spacing: size * 0.11) {
            ForEach(0..<5) { index in
                Capsule().fill(Color.white.opacity(quiet ? 0.48 : 1))
                    .frame(width: size * 0.09, height: size * [0.3, 0.55, 0.85, 0.55, 0.3][index])
            }
        }
        .frame(width: size, height: size).frame(width: 20, height: 20)
        .alignmentGuide(.firstTextBaseline) { d in d[.bottom] - 5 }
        .alignmentGuide(.lastTextBaseline) { d in d[.bottom] - 5 }
        .accessibilityLabel(quiet ? "Hormes, over" : "Hormes")
    }
}

/// Status remains explicit through symbols, words and a quiet activity pulse.
struct BrandStatusGlyph: View {
    let status: AgentStatus
    let tool: AgentTool

    var body: some View {
        let meta = ConsoleTheme.status(status)
        // A ZStack, so a status that changes crossfades the glyph it had into the one it gets.
        ZStack {
            if let symbol = meta.symbol {
                ConsoleIcon(name: symbol, tint: meta.color).transition(.opacity)
            } else if meta.live {
                ZStack {
                    Circle().stroke(brandColor(tool), lineWidth: 1).frame(width: 12, height: 12)
                    ConsoleDot(color: meta.color, live: true, size: 6)
                }
                .transition(.opacity)
            } else {
                ConsoleDot(color: meta.color, live: false, size: 6).transition(.opacity)
            }
        }
        .frame(width: 20, height: 20)
        .animation(Motion.fade, value: status)
        .help(status.rawValue)
        .accessibilityLabel(status.rawValue)
    }
}

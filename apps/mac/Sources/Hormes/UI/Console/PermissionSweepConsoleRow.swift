import SwiftUI

enum PermissionSweepWords {
    static let skip = "Skip"
    static let stop = "Stop"
    static let skipTip = "Leave this permission missing and continue"
    static let stopTip = "Stop requesting permissions; existing grants remain"
}

/// Installation progress belongs in the existing Console; no extra setup window.
struct PermissionSweepConsoleRow: View {
    let progress: PermissionSweepProgress
    let next: () -> Void
    let stop: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(progress.line)
                .font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.fg2)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 10) {
                if progress.stage == .waiting || progress.stage == .settings {
                    Button(PermissionSweepWords.skip, action: next)
                        .buttonStyle(ConsoleButtonStyle(kind: .ghost, height: 22, small: true))
                        .help(PermissionSweepWords.skipTip)
                }
                Button(PermissionSweepWords.stop, action: stop)
                    .buttonStyle(ConsoleButtonStyle(kind: .ghost, height: 22, small: true))
                    .help(PermissionSweepWords.stopTip)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

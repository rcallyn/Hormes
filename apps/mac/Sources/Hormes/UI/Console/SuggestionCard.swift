import SwiftUI

/// Passive surface only. Review uses the ordinary typed-request path after Go;
/// it never starts a session or approves the agent's permission question.
struct SuggestionCard: View {
    let suggestion: ProactiveSuggestion
    let awake: Bool
    @Environment(\.consoleActions) private var actions

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(suggestion.title).font(ConsoleTheme.sans(12, .medium))
                Text(suggestion.explanation).font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.muted)
                if !awake { Text("Press Go to review with Hormes.").font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.muted) }
            }
            Spacer(minLength: 8)
            Button("Review") { actions.send(.suggestionAccept(id: suggestion.id)) }
                .buttonStyle(ConsoleButtonStyle(kind: .primary, height: 26, small: true))
                .disabled(!awake)
            Button("Dismiss") { actions.send(.suggestionDismiss(id: suggestion.id)) }
                .buttonStyle(ConsoleButtonStyle(kind: .ghost, height: 26, small: true))
        }
        .padding(12)
        .background(ConsoleTheme.ground)
        .accessibilityElement(children: .contain)
    }
}

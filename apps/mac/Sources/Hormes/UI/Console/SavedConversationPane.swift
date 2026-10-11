import SwiftUI

/// Saved conversations use the same recorded rows as Activity.
struct SavedConversationPane: View {
    let chain: HormesChain
    let entries: [StreamEntry]
    let loading: Bool
    let truncated: Bool
    @EnvironmentObject private var session: ConsoleSession

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(chain.displayTitle.isEmpty ? "Conversation" : chain.displayTitle).lineLimit(1)
                    Text(ConsoleFormat.fullDate(chain.startedAt)).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button("Back") { session.showNow() }
            }.padding(16)
            Divider()
            if truncated {
                Text("Showing the newest part of this conversation.").font(.caption).foregroundStyle(.secondary).padding(8)
            }
            StreamFeed(entries: entries, modeKey: "saved:" + chain.id,
                       emptyState: StreamEmptyState(text: loading ? "Reading…" : "Nothing recorded.", loading: loading))
        }
    }
}

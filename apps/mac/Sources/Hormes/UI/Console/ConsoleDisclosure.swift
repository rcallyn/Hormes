import SwiftUI

/// Learning sections use native disclosure behavior.
struct ConsoleDisclosure<Content: View>: View {
    enum Summary { case words(String) }
    let id: String
    let title: String
    var count: String? = nil
    var summary: [Summary] = []
    @ViewBuilder let content: () -> Content

    var body: some View {
        DisclosureGroup {
            content()
        } label: {
            HStack {
                Text(title)
                if let count { Text(count).foregroundStyle(.secondary) }
                ForEach(Array(summary.enumerated()), id: \.offset) { _, item in
                    if case .words(let text) = item { Text(text).font(.caption).foregroundStyle(.secondary) }
                }
            }
        }.padding(12)
    }
}

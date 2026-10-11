import SwiftUI

struct ConsoleRow: View {
    enum Trailing { case none, chevron }
    let title: String
    var value: String? = nil
    var meta: String? = nil
    var trailing: Trailing = .none
    var selected = false
    let primary: () -> Void

    var body: some View {
        Button(action: primary) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).font(ConsoleTheme.sans(12))
                    if let meta { Text(meta).font(ConsoleTheme.sans(11)).foregroundStyle(.secondary) }
                }
                Spacer()
                if let value { Text(value).font(ConsoleTheme.sans(11)).foregroundStyle(.secondary) }
                if case .chevron = trailing { Image(systemName: "chevron.right").font(.caption) }
            }.padding(12).contentShape(Rectangle())
                .background(selected ? Color.white.opacity(0.08) : .clear)
        }.buttonStyle(.plain).accessibilityAddTraits(selected ? .isSelected : [])
    }
}

struct ConsoleGroupHead: View {
    let title: String
    var count: String? = nil
    var body: some View {
        HStack { Text(title); if let count { Text(count) }; Spacer() }
            .font(ConsoleTheme.sans(11, .medium)).foregroundStyle(.secondary).padding(12)
    }
}

import SwiftUI

/// Original requested items remain distinct from the assistant's preparation plan.
struct GroceryRecord: View {
    let grocery: HormesGrocery
    let sources: [HormesSource]
    private var reviewURL: URL? {
        guard let review = grocery.review else { return nil }
        return review.receiptIds.compactMap { id in sources.first { $0.id == id }?.url }.compactMap(URL.init(string:)).first {
            $0.scheme == "https" && ["instacart.com", "www.instacart.com"].contains($0.host ?? "") && $0.user == nil && $0.password == nil
        }
    }
    private func status(_ raw: String) -> String {
        switch raw {
        case "in-cart": return "In cart"
        case "unavailable": return "Unavailable"
        case "substitution-needs-review": return "Substitution to review"
        default: return "Pending"
        }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            if let note = grocery.note {
                VStack(alignment: .leading, spacing: 5) {
                    Text(note.title).font(ConsoleTheme.sans(17, .medium)).foregroundStyle(ConsoleTheme.fg)
                    Text("\(note.origin == "apple-notes" ? "Apple Notes" : "Pasted list") · \(WorkWords.stamp(note.importedAt))")
                        .font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.fg3)
                }
            }
            ForEach(grocery.items) { item in
                VStack(alignment: .leading, spacing: 5) {
                    HStack(alignment: .firstTextBaseline) {
                        Image(systemName: item.state == "in-cart" ? "checkmark.circle" : "circle").font(.system(size: 12))
                        Text(item.request).font(ConsoleTheme.sans(14)).textSelection(.enabled)
                        Spacer()
                        Text(status(item.state)).font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.fg3)
                    }
                    if let product = item.product { Text(product).font(ConsoleTheme.sans(12)).foregroundStyle(ConsoleTheme.fg2) }
                    if let price = item.priceText { Text(price).font(ConsoleTheme.sans(12)).foregroundStyle(ConsoleTheme.fg2) }
                    if let quote = item.quote, let checked = item.checkedAt {
                        DisclosureGroup("Cart evidence · \(WorkWords.stamp(checked))") { Text(quote).font(ConsoleTheme.sans(12)).textSelection(.enabled) }
                            .font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.fg3)
                    }
                }.padding(.vertical, 4)
            }
            if let blocked = grocery.blocked {
                Text(blocked.reason).font(ConsoleTheme.sans(13)).foregroundStyle(ConsoleTheme.fg2).textSelection(.enabled)
            }
            if !grocery.plan.isEmpty {
                DisclosureGroup("Assistant plan") {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(grocery.plan) { item in Text(item.text).font(ConsoleTheme.sans(12)).textSelection(.enabled) }
                    }.padding(.top, 8)
                }.font(ConsoleTheme.sans(12)).foregroundStyle(ConsoleTheme.fg2)
            }
            if let review = grocery.review {
                Text(review.summary).font(ConsoleTheme.sans(13)).textSelection(.enabled)
                if let reviewURL { Link("Review cart", destination: reviewURL).font(ConsoleTheme.sans(12, .medium)).foregroundStyle(ConsoleTheme.fg) }
                Text("Prepared for your review. Nothing purchased.").font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.fg3)
            }
        }.foregroundStyle(ConsoleTheme.fg)
    }
}

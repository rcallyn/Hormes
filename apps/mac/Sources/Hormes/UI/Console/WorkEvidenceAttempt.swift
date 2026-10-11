import SwiftUI

/// Corrections preserve the original attempt while removing it from progress.
struct WorkEvidenceAttempt: View {
    let evidence: [HormesEvidence]
    let busy: Bool
    let exclude: (String) -> Void
    @State private var editing = false
    @State private var reason = ""
    private var explanation: String { reason.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let first = evidence.first {
                Text("\(WorkWords.stamp(first.at)) · Answer: \(first.answer)")
                    .font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.muted).textSelection(.enabled)
                ForEach(evidence) { item in
                    Text(item.feedback).font(ConsoleTheme.sans(13))
                        .foregroundStyle(item.invalidated == nil && item.correct ? ConsoleTheme.fg : ConsoleTheme.muted)
                }
                Text(first.limitations).font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.muted)
                if let invalidated = first.invalidated {
                    Text("Excluded from progress · \(WorkWords.stamp(invalidated.at))\n\(invalidated.reason)")
                        .font(ConsoleTheme.sans(12)).foregroundStyle(ConsoleTheme.muted).textSelection(.enabled)
                } else if editing {
                    Text("The original answer and any hints stay in history. All checks from this answer will be excluded.")
                        .font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.muted)
                    TextField("Reason, for example: my answer was misheard", text: $reason)
                        .textFieldStyle(.roundedBorder)
                    HStack {
                        Button("Cancel") { editing = false; reason = "" }.buttonStyle(ConsoleButtonStyle(kind: .plain))
                        Button("Exclude attempt") { exclude(explanation); editing = false; reason = "" }
                            .buttonStyle(ConsoleButtonStyle(kind: .plain))
                            .disabled(busy || explanation.isEmpty || explanation.utf16.count > 500)
                    }
                } else {
                    Button("Correct this record") { editing = true }
                        .buttonStyle(ConsoleButtonStyle(kind: .plain)).disabled(busy)
                }
            }
        }
    }
}

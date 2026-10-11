import SwiftUI

enum HelpText {
    static func thread(_ thread: WorkThread) -> String {
        [thread.name, thread.status.orbWord, thread.question ?? thread.task].filter { !$0.isEmpty }.joined(separator: " · ")
    }
    static func threadMetaLine(_ thread: WorkThread) -> String {
        "Started " + ConsoleFormat.time(thread.startedAt) + " · \(thread.turns) turns · \(thread.steps) steps"
    }
    static func delegation(_ delegation: Delegation) -> String { delegation.request }
    static func question(name: String, question: String, detail: String? = nil) -> String { [name, question, detail ?? ""].filter { !$0.isEmpty }.joined(separator: " · ") }
    static func path(title: String, path: String) -> String { path }
}

extension View {
    func help(_ entry: HelpCopy.Entry) -> some View { help(entry.hint) }
}

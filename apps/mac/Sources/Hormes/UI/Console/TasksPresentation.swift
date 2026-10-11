import Foundation

enum TasksPresentation {
    static let modes = [("study", "Study"), ("meeting", "Meeting"), ("coding", "Code"), ("grocery", "Groceries")]
    static func title(_ mode: String) -> String { modes.first { $0.0 == mode }?.1 ?? mode.capitalized }
    static func sourceRevision(_ task: HormesWorkTask) -> HormesTaskSourceRevision {
        task.sourceHistory?.last ?? HormesTaskSourceRevision(sourceId: task.sourceId, noteRevision: task.noteRevision, line: task.line, at: task.createdAt)
    }
    static func status(_ task: HormesWorkTask) -> String {
        if task.supersededAt != nil { return "Source changed" }
        switch task.status {
        case "user-reported-done": return "Done · user reported"
        case "in-progress": return "In progress"
        default: return "Pending"
        }
    }
    static func command(_ action: String, task: HormesWorkTask, mode: String? = nil) -> HormesWorkCommand? {
        guard task.supersededAt == nil, ["tasks.start", "tasks.done", "tasks.reopen"].contains(action) else { return nil }
        if action == "tasks.start" {
            guard task.status != "user-reported-done", let mode = task.mode ?? mode,
                  mode != "coding", modes.contains(where: { $0.0 == mode }) else { return nil }
        }
        var command = HormesWorkCommand(action: action)
        command.taskId = task.id; command.expectedTaskVersion = task.version
        if action == "tasks.start" { command.mode = task.mode ?? mode }
        return command
    }
}

import Foundation

// Unrelated Protocol.swift dependency; this headless target does not compile AppState.
public struct LedgerHit: Equatable {}

@main struct TasksChecks {
    static func main() throws {
        var checks = 0
        func check(_ value: Bool, _ message: String) {
            guard value else { fatalError("FAIL: " + message) }
            checks += 1; print("PASS: " + message)
        }
        let json = #"{"id":"task_1","sourceId":"source_1","noteId":"note_1","noteTitle":"Synthetic to-do","noteRevision":"rev_1","text":"Review exchange economies","line":2,"status":"pending","version":3,"createdAt":1000,"updatedAt":2000,"suggestedMode":"study"}"#
        var task = try JSONDecoder().decode(HormesWorkTask.self, from: Data(json.utf8))
        check(task.text == "Review exchange economies" && task.line == 2, "original task text and source line decode unchanged")
        check(task.sourceId == "source_1" && task.noteRevision == "rev_1", "source identity and revision survive decoding")
        check(TasksPresentation.sourceRevision(task).sourceId == "source_1" && TasksPresentation.sourceRevision(task).line == 2, "first import displays the original source snapshot")
        check(TasksPresentation.command("tasks.start", task: task) == nil, "a suggestion does not start a mode without an explicit selection")
        check(TasksPresentation.command("tasks.start", task: task, mode: "coding") == nil, "imported coding intent stays planning-only instead of launching an unrelated supported project")
        let start = TasksPresentation.command("tasks.start", task: task, mode: "study")!
        check(start.taskId == "task_1" && start.expectedTaskVersion == 3, "mutation carries exact task identity and version")
        check(start.mode == "study" && start.text == nil, "start routes selected task without fabricated text or source content")
        check(start.json["expectedTaskVersion"] as? Int == 3 && start.json["taskId"] as? String == "task_1", "command encodes backend field names")
        task.status = "in-progress"; task.sessionId = "session_1"; task.mode = "study"
        check(TasksPresentation.command("tasks.start", task: task, mode: "grocery")?.mode == "study", "resume preserves linked work mode instead of rerouting it")
        task.status = "user-reported-done"; task.reportedDoneAt = 3000
        check(TasksPresentation.status(task) == "Done · user reported", "completion label never implies verified results")
        check(TasksPresentation.command("tasks.start", task: task, mode: "study") == nil, "completed task must be reopened before starting")
        check(TasksPresentation.command("tasks.reopen", task: task)?.expectedTaskVersion == 3, "reopen keeps optimistic concurrency boundary")
        task.supersededAt = 4000
        check(TasksPresentation.status(task) == "Source changed", "changed source remains visible as history")
        check(["tasks.start", "tasks.done", "tasks.reopen"].allSatisfy { TasksPresentation.command($0, task: task, mode: "study") == nil }, "stale source prevents all task mutations")
        task.sourceHistory = [HormesTaskSourceRevision(sourceId: "source_2", noteRevision: "rev_2", line: 4, at: 5000)]
        let displayedSource = TasksPresentation.sourceRevision(task)
        check(displayedSource.sourceId == "source_2" && displayedSource.line == 4 && displayedSource.at == 5000, "reimport displays the latest source with its matching line and date")
        var state = HormesWorkState.empty; state.tasks = [task]
        let restored = try JSONDecoder().decode(HormesWorkState.self, from: JSONEncoder().encode(state))
        check(restored.tasks == [task], "task source and linked work round-trip with the work state")
        check(restored.tasks?.first?.sourceId == "source_1" && restored.tasks?.first?.sourceHistory?.last?.line == 4, "later source snapshots do not replace original provenance")
        print("\(checks) task protocol and presentation checks passed")
    }
}

import SwiftUI

/// A snapshot is intentional: a newer daemon version must never silently replace an edit's base.
struct GoalDraft {
    let goalId: String?
    let expectedVersion: Int?
    var title: String
    var outcome: String
    var kind: String
    var criteriaText: String
    var courseId: String
    var hasDeadline: Bool
    var deadline: Date

    init(goal: HormesGoal?, courseId: String = "microeconomics") {
        goalId = goal?.id; expectedVersion = goal?.version
        title = goal?.title ?? ""; outcome = goal?.outcome ?? goal?.title ?? ""
        kind = goal?.kind ?? "learning"; criteriaText = goal?.criteria.joined(separator: "\n") ?? ""
        self.courseId = goal?.courseId ?? courseId
        hasDeadline = goal?.deadline != nil
        deadline = goal?.deadline.map { Date(timeIntervalSince1970: $0 / 1000) } ?? Date.now
    }
    private func trimmed(_ value: String) -> String { value.trimmingCharacters(in: .whitespacesAndNewlines) }
    var criteria: [String] { criteriaText.components(separatedBy: .newlines).map(trimmed).filter { !$0.isEmpty } }
    var validation: String? {
        if trimmed(title).isEmpty || trimmed(title).utf16.count > 200 { return "Add a title of up to 200 characters." }
        if trimmed(outcome).isEmpty || trimmed(outcome).utf16.count > 2_000 { return "Describe the outcome in up to 2,000 characters." }
        if !["learning", "meeting", "travel", "coding", "grocery"].contains(kind) { return "Choose a supported kind of goal." }
        if kind == "learning" && courseId.isEmpty { return "Choose a course for this learning goal." }
        if criteria.isEmpty || criteria.count > 12 || criteria.contains(where: { $0.utf16.count > 500 }) { return "Add 1–12 success criteria, each up to 500 characters." }
        if Set(criteria).count != criteria.count { return "Each success criterion should be distinct." }
        let milliseconds = (deadline.timeIntervalSince1970 * 1_000).rounded()
        if hasDeadline && (!milliseconds.isFinite || milliseconds <= 0 || milliseconds > 8.64e15) { return "Choose a valid deadline." }
        return nil
    }
    func command() -> HormesWorkCommand? {
        guard validation == nil else { return nil }
        var command = HormesWorkCommand(action: goalId == nil ? "goal.create" : "goal.revise")
        command.goalId = goalId; command.expectedGoalVersion = expectedVersion
        command.goalInput = HormesGoalInput(title: trimmed(title), outcome: trimmed(outcome), kind: kind, criteria: criteria,
            deadline: hasDeadline ? (deadline.timeIntervalSince1970 * 1_000).rounded() : nil,
            courseId: kind == "learning" ? courseId : nil)
        return command
    }
}

/// Console owns goal authoring. This sheet never starts work, opens the mic, or marks a goal complete.
struct GoalEditor: View {
    @EnvironmentObject private var state: AppState
    let saved: (String?) -> Void
    let cancel: () -> Void
    @State private var draft: GoalDraft
    @State private var pending: HormesWorkCommand?
    @State private var failure: String?
    @State private var saveIsSlow = false
    @State private var knownGoalIds = Set<String>()

    init(goal: HormesGoal?, courseId: String? = nil, saved: @escaping (String?) -> Void, cancel: @escaping () -> Void) {
        self.saved = saved; self.cancel = cancel
        _draft = State(initialValue: GoalDraft(goal: goal, courseId: courseId ?? "microeconomics"))
    }
    private var courses: [HormesCourse] {
        var list = state.work.courses ?? []
        if !list.contains(where: { $0.id == "microeconomics" }) { list.append(HormesCourse(id: "microeconomics", title: "Intermediate Microeconomics")) }
        return list.sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
    }
    private var currentGoal: HormesGoal? { state.work.goals.first { $0.id == draft.goalId } }
    private var stale: Bool { draft.goalId != nil && currentGoal?.version != draft.expectedVersion }
    private var kindName: String { Self.kinds.first { $0.0 == draft.kind }?.1 ?? draft.kind.capitalized }
    private static let kinds = [("learning", "Learning"), ("coding", "Coding"), ("meeting", "Meeting"), ("travel", "Travel"), ("grocery", "Groceries")]

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text(draft.goalId == nil ? "New goal" : "Edit goal").font(ConsoleTheme.sans(24, .light)).foregroundStyle(ConsoleTheme.fg)
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    field("Title") { TextField("What are you working toward?", text: $draft.title) }
                    field("Desired outcome") { TextField("Describe what success would mean", text: $draft.outcome, axis: .vertical).lineLimit(2...5) }
                    if draft.goalId == nil {
                        Picker("Kind", selection: $draft.kind) { ForEach(Self.kinds, id: \.0) { Text($0.1).tag($0.0) } }
                        if draft.kind == "learning" {
                            Picker("Course", selection: $draft.courseId) { ForEach(courses) { Text($0.title).tag($0.id) } }
                        }
                    } else {
                        Text(draft.kind == "learning" ? "\(kindName) · \(courses.first { $0.id == draft.courseId }?.title ?? draft.courseId)" : kindName)
                            .font(ConsoleTheme.sans(12)).foregroundStyle(ConsoleTheme.fg2)
                    }
                    field("Success criteria · one per line") {
                        TextField("An observable result for each criterion", text: $draft.criteriaText, axis: .vertical).lineLimit(4...10)
                    }
                    VStack(alignment: .leading, spacing: 10) {
                        Toggle("Deadline", isOn: $draft.hasDeadline).toggleStyle(.checkbox)
                        if draft.hasDeadline { DatePicker("Due", selection: $draft.deadline, displayedComponents: [.date, .hourAndMinute]) }
                    }
                    Text("Your criteria guide the work. Custom outcomes remain open for review; saving a goal does not demonstrate completion.")
                        .font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.fg3).fixedSize(horizontal: false, vertical: true)
                }.disabled(pending != nil)
            }.frame(maxHeight: 460)
            if stale && pending == nil {
                VStack(alignment: .leading, spacing: 8) {
                    Text("This goal changed while you were editing. Load the latest version before saving.").font(ConsoleTheme.sans(12)).foregroundStyle(ConsoleTheme.fg2)
                    if let currentGoal {
                        Button("Load latest · discard these edits") { draft = GoalDraft(goal: currentGoal); failure = nil }
                            .buttonStyle(.link)
                    }
                }
            } else if let failure {
                Text(failure).font(ConsoleTheme.sans(12)).foregroundStyle(ConsoleTheme.fg2).fixedSize(horizontal: false, vertical: true)
            } else if let validation = draft.validation {
                Text(validation).font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.fg3)
            }
            HStack {
                if !state.connected { Text("Connect to Hormes to save.").font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.fg3) }
                else if pending != nil { Text(saveIsSlow ? "Save not confirmed yet." : "Saving…").font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.fg3) }
                Spacer()
                Button(pending == nil ? "Cancel" : "Close", action: cancel).keyboardShortcut(.cancelAction)
                if saveIsSlow, let pending {
                    Button("Retry save") { state.send(.work(pending)) }.disabled(!state.connected)
                } else {
                    Button(draft.goalId == nil ? "Create goal" : "Save changes", action: commit)
                        .keyboardShortcut(.defaultAction).disabled(draft.validation != nil || stale || pending != nil || !state.connected)
                }
            }
        }.padding(28).frame(width: 510).background(ConsoleTheme.ground)
            .onReceive(state.workReplies, perform: receive)
            .task(id: pending?.requestId) {
                guard let requestId = pending?.requestId else { return }
                do { try await Task.sleep(for: .seconds(10)) } catch { return }
                if pending?.requestId == requestId { saveIsSlow = true }
            }
    }

    private func field<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.fg2)
            content().textFieldStyle(.roundedBorder).font(ConsoleTheme.sans(13))
        }
    }
    private func commit() {
        guard pending == nil, !stale, state.connected, let command = draft.command() else { return }
        knownGoalIds = Set(state.work.goals.map(\.id))
        failure = nil; saveIsSlow = false; pending = command
        // Goal metadata does not switch workspaces or require a board flush/voice interruption.
        state.send(.work(command))
    }
    private func receive(_ reply: HormesWorkReply) {
        guard let request = pending, reply.requestId == request.requestId else { return }
        pending = nil; saveIsSlow = false
        if reply.ok {
            let created = reply.state.goals.filter { !knownGoalIds.contains($0.id) && $0.title == request.goalInput?.title && $0.outcome == request.goalInput?.outcome }
            saved(request.goalId ?? (created.count == 1 ? created[0].id : nil))
        } else { failure = reply.message ?? "The goal could not be saved. Your edits are still here." }
    }
}

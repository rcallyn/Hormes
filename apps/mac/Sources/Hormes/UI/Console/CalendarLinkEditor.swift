import SwiftUI

/// Explicit work intent; calendar titles are never interpreted as permission to start a mode.
struct CalendarLinkEditor: View {
    @EnvironmentObject private var state: AppState
    let event: HormesCalendarEvent
    let goals: [HormesGoal]
    let courses: [HormesCourse]
    let saved: () -> Void
    let cancel: () -> Void
    @State private var mode: String
    @State private var target: String
    @State private var courseTitle = ""
    @State private var pending: HormesWorkCommand?
    @State private var failure: String?
    @State private var saveIsSlow = false

    init(event: HormesCalendarEvent, goals: [HormesGoal], courses: [HormesCourse], saved: @escaping () -> Void, cancel: @escaping () -> Void) {
        self.event = event; self.goals = goals; self.courses = courses; self.saved = saved; self.cancel = cancel
        _mode = State(initialValue: event.mode ?? "class")
        let linkedGoal = goals.first { $0.id == event.goalId }
        _target = State(initialValue: linkedGoal.flatMap { $0.kind != "coding" || WorkGoalRouting.executableCoding($0) ? "goal:\($0.id)" : nil } ?? "")
    }
    private var kind: String { mode == "grocery" ? "grocery" : mode == "meeting" ? "meeting" : mode == "travel" ? "travel" : mode == "coding" ? "coding" : "learning" }
    private var matchingGoals: [HormesGoal] { goals.filter { $0.kind == kind && (kind != "coding" || WorkGoalRouting.executableCoding($0)) } }
    private var offersDefaultGoal: Bool { kind != "learning" && matchingGoals.isEmpty && (kind != "coding" || !goals.contains { $0.id == "goal_coding" }) }
    private var namedCourseId: String { courseTitle.lowercased().replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression).trimmingCharacters(in: CharacterSet(charactersIn: "-")) }
    private var canSave: Bool {
        if mode == "break" { return true }
        if target.hasPrefix("goal:") { return matchingGoals.contains { $0.id == String(target.dropFirst(5)) } }
        if target == "default" { return offersDefaultGoal }
        guard kind == "learning" else { return false }
        if target.hasPrefix("course:") { return target == "course:microeconomics" || courses.contains { "course:\($0.id)" == target } }
        return target == "new-course" && !namedCourseId.isEmpty && namedCourseId.utf16.count <= 100 && !courseTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && courseTitle.utf16.count <= 200
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text(event.title).font(ConsoleTheme.sans(20, .medium)).foregroundStyle(ConsoleTheme.fg)
            Text("\(event.calendar) · \(WorkWords.stamp(event.startsAt))").font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.fg3)
            VStack(alignment: .leading, spacing: 18) {
                Picker("Mode", selection: $mode) {
                    ForEach(WorkWords.modes, id: \.0) { Text($0.1).tag($0.0) }
                }.onChange(of: mode) { _, _ in target = ""; failure = nil }
                if mode != "break" {
                    Picker("Goal", selection: $target) {
                        Text("Choose a goal").tag("")
                        ForEach(matchingGoals) { Text($0.title).tag("goal:\($0.id)") }
                        if kind == "learning" {
                            ForEach(courses.filter { course in !matchingGoals.contains { $0.courseId == course.id } }) { course in
                                Text(course.title).tag("course:\(course.id)")
                            }
                            if courses.isEmpty && matchingGoals.isEmpty { Text("Intermediate Microeconomics").tag("course:microeconomics") }
                            Text("New course…").tag("new-course")
                        } else if offersDefaultGoal {
                            Text(mode == "coding" ? WorkGoalRouting.codingOutcome : mode == "meeting" ? "Prepare the Hormes VC conversation" : mode == "grocery" ? "Prepare a grocery cart for review" : "Plan an evening trip to NYC").tag("default")
                        }
                    }
                    if target == "new-course" { TextField("Course name", text: $courseTitle).textFieldStyle(.roundedBorder) }
                    if kind == "coding" {
                        Text("Coding links use the bounded EvoSim goal. Other coding goals remain saved for planning.")
                            .font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.fg3).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }.disabled(pending != nil)
            Text("This saves the association. Work starts only when you open the event or accept a suggestion.")
                .font(ConsoleTheme.sans(12)).foregroundStyle(ConsoleTheme.fg2).fixedSize(horizontal: false, vertical: true)
            if let failure {
                Text(failure).font(ConsoleTheme.sans(12)).foregroundStyle(ConsoleTheme.fg2).fixedSize(horizontal: false, vertical: true)
            }
            HStack {
                if let linkedMode = event.mode {
                    Button("Remove link") { submit(HormesWorkCommand(action: "calendar.link", mode: linkedMode, blockId: event.id, enabled: false)) }
                        .buttonStyle(ConsoleButtonStyle(kind: .plain)).disabled(pending != nil || !state.connected)
                }
                Spacer()
                Button(pending == nil ? "Cancel" : "Close", action: cancel).keyboardShortcut(.cancelAction)
                if saveIsSlow, let pending {
                    Button("Retry save") { state.send(.work(pending)) }.disabled(!state.connected)
                } else {
                    Button("Save link", action: commit).keyboardShortcut(.defaultAction).disabled(!canSave || pending != nil || !state.connected)
                }
            }
            if !state.connected { Text("Connect to Hormes to save.").font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.fg3) }
            else if pending != nil { Text(saveIsSlow ? "Save not confirmed yet. Retry sends the same request safely." : "Saving…").font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.fg3) }
        }.padding(28).frame(width: 440).background(ConsoleTheme.ground)
            .onReceive(state.workReplies, perform: receive)
            .task(id: pending?.requestId) {
                guard let requestId = pending?.requestId else { return }
                do { try await Task.sleep(for: .seconds(10)) } catch { return }
                if pending?.requestId == requestId { saveIsSlow = true }
            }
    }

    private func commit() {
        guard canSave else { return }
        var command = HormesWorkCommand(action: "calendar.link", mode: mode, blockId: event.id)
        if target.hasPrefix("goal:") { command.goalId = String(target.dropFirst(5)) }
        else if target.hasPrefix("course:") {
            command.courseId = String(target.dropFirst(7))
            command.courseTitle = courses.first { $0.id == command.courseId }?.title ?? "Intermediate Microeconomics"
        } else if target == "new-course" {
            command.courseId = namedCourseId; command.courseTitle = courseTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        submit(command)
    }
    private func submit(_ command: HormesWorkCommand) {
        guard pending == nil, state.connected else { return }
        pending = command; failure = nil; saveIsSlow = false
        // Linking is metadata: preserve the active board and voice session.
        state.send(.work(command))
    }
    private func receive(_ reply: HormesWorkReply) {
        guard let request = pending, reply.requestId == request.requestId else { return }
        pending = nil; saveIsSlow = false
        if reply.ok { saved() }
        else { failure = reply.message ?? "The calendar link could not be saved. Your choices are still here." }
    }
}

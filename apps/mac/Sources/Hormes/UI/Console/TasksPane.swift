import SwiftUI

/// Imported intent stays distinct from the work Hormes performs and its evidence.
struct TasksPane: View {
    @EnvironmentObject private var state: AppState
    @EnvironmentObject private var console: ConsoleSession
    @State private var selectedId: String?
    @State private var selectedMode = "study"
    @State private var selectedCourseId = ""
    @State private var showHistory = false
    @State private var pending: HormesWorkCommand?
    @State private var message: String?
    @State private var waiting = false

    private var tasks: [HormesWorkTask] { state.work.tasks ?? [] }
    private var visible: [HormesWorkTask] { tasks.filter { showHistory || $0.supersededAt == nil } }
    private var selected: HormesWorkTask? { visible.first { $0.id == selectedId } }
    private var notes: [String] {
        var seen = Set<String>()
        return visible.sorted { $0.createdAt > $1.createdAt }.compactMap { seen.insert($0.noteId).inserted ? $0.noteId : nil }
    }
    private var unavailable: Bool { !state.connected || pending != nil || state.work.busy }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header.padding(28)
            ConsoleHairline(weight: .row)
            HStack(spacing: 0) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        if visible.isEmpty { empty }
                        ForEach(notes, id: \.self) { noteId in noteGroup(noteId) }
                    }.padding(24).frame(maxWidth: .infinity, alignment: .leading)
                }.frame(minWidth: 260, idealWidth: 340, maxWidth: 390)
                ConsoleHairline(vertical: true)
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        if let selected { detail(selected) }
                        else {
                            Text("Choose what to move forward.").font(ConsoleTheme.sans(22, .medium)).foregroundStyle(ConsoleTheme.fg)
                            Text("Your original request, its saved work, and the next action stay together.")
                                .font(ConsoleTheme.sans(13)).foregroundStyle(ConsoleTheme.fg2).lineSpacing(4)
                        }
                    }.padding(28).frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            if let message {
                ConsoleHairline(weight: .row)
                Text(message).font(ConsoleTheme.sans(12)).foregroundStyle(ConsoleTheme.fg2)
                    .textSelection(.enabled).padding(.horizontal, 28).padding(.vertical, 14)
            }
            if let pending {
                Text(waiting ? "Still waiting for Hormes. Your list is saved; refresh when the current action finishes." : pending.action == "tasks.import" ? "Reading the selected note…" : "Saving…")
                    .font(ConsoleTheme.sans(12)).foregroundStyle(ConsoleTheme.fg3).padding(.horizontal, 28).padding(.bottom, 16)
            }
        }
        .background(ConsoleTheme.ground)
        .onReceive(state.workReplies) { reply in
            guard let command = pending, command.requestId == reply.requestId else { return }
            pending = nil; waiting = false; message = reply.ok ? nil : reply.message ?? "That action could not finish."
            guard reply.ok else { return }
            if command.action == "inspect", let id = command.sessionId { console.openWork(id) }
            if command.action == "tasks.import", selectedId == nil {
                select(reply.state.tasks?.filter { $0.supersededAt == nil }.max { $0.createdAt < $1.createdAt })
            }
        }
        .task(id: pending?.requestId) {
            guard pending != nil else { return }
            try? await Task.sleep(for: .seconds(15))
            if !Task.isCancelled { waiting = true }
        }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 20) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Tasks").font(ConsoleTheme.sans(27, .medium)).foregroundStyle(ConsoleTheme.fg)
                Text("From your list to work you can inspect.").font(ConsoleTheme.sans(13)).foregroundStyle(ConsoleTheme.fg2)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 10) {
                Button("Import selected note") { send(HormesWorkCommand(action: "tasks.import")) }
                    .buttonStyle(ConsoleButtonStyle(kind: .plain)).disabled(unavailable)
                Toggle("Source history", isOn: $showHistory).toggleStyle(.checkbox)
                    .font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.fg3)
            }
        }
    }
    private var empty: some View {
        VStack(alignment: .leading, spacing: 12) {
            Image(systemName: "checklist").font(.system(size: 26, weight: .light)).foregroundStyle(ConsoleTheme.fg2)
            Text("Start with your list.").font(ConsoleTheme.sans(17, .medium)).foregroundStyle(ConsoleTheme.fg)
            Text("Select one to-do note in Apple Notes, then import it here. Each task keeps its original wording and source.")
                .font(ConsoleTheme.sans(13)).foregroundStyle(ConsoleTheme.fg2).lineSpacing(4)
            Text("Import saves the list. It does not change the note or start work.")
                .font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.fg3).lineSpacing(4)
        }
    }
    private func noteGroup(_ noteId: String) -> some View {
        let rows = visible.filter { $0.noteId == noteId }.sorted { TasksPresentation.sourceRevision($0).line < TasksPresentation.sourceRevision($1).line }
        return VStack(alignment: .leading, spacing: 10) {
            Text(rows.first?.noteTitle ?? "Apple Notes").font(ConsoleTheme.sans(12, .medium)).foregroundStyle(ConsoleTheme.fg2)
            ForEach(rows) { task in
                Button { select(task) } label: {
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: task.status == "user-reported-done" ? "checkmark.circle" : "circle")
                            .font(.system(size: 13)).padding(.top, 2)
                        VStack(alignment: .leading, spacing: 6) {
                            Text(task.text).font(ConsoleTheme.sans(13)).multilineTextAlignment(.leading).lineLimit(3)
                            Text(TasksPresentation.status(task)).font(ConsoleTheme.sans(10)).foregroundStyle(ConsoleTheme.fg3)
                        }
                        Spacer(minLength: 0)
                    }.foregroundStyle(ConsoleTheme.fg).padding(12).frame(maxWidth: .infinity, alignment: .leading)
                        .background(selectedId == task.id ? ConsoleTheme.hover : .clear, in: RoundedRectangle(cornerRadius: 8))
                        .contentShape(Rectangle())
                }.buttonStyle(.plain).accessibilityAddTraits(selectedId == task.id ? .isSelected : [])
            }
        }
    }
    @ViewBuilder private func detail(_ task: HormesWorkTask) -> some View {
        let revision = TasksPresentation.sourceRevision(task)
        VStack(alignment: .leading, spacing: 10) {
            eyebrow("ORIGINAL REQUEST")
            Text(task.text).font(ConsoleTheme.sans(23, .medium)).foregroundStyle(ConsoleTheme.fg).textSelection(.enabled)
            Text("\(task.noteTitle) · line \(revision.line) · imported \(WorkWords.stamp(revision.at))")
                .font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.fg3)
            Text(TasksPresentation.status(task)).font(ConsoleTheme.sans(12)).foregroundStyle(ConsoleTheme.fg2)
        }
        if task.supersededAt != nil {
            Text("The source note has changed. This earlier task is retained as history; select its current imported version to continue.")
                .font(ConsoleTheme.sans(13)).foregroundStyle(ConsoleTheme.fg2)
        } else {
            if let saved = state.work.sessions.first(where: { $0.id == task.sessionId }) {
                linkedWork(saved, task: task)
            } else if task.status != "user-reported-done" {
                VStack(alignment: .leading, spacing: 12) {
                    eyebrow("NEXT ACTION")
                    if let suggestion = task.suggestedMode {
                        Text("Suggested: \(TasksPresentation.title(suggestion))").font(ConsoleTheme.sans(12)).foregroundStyle(ConsoleTheme.fg2)
                    }
                    Picker("Work mode", selection: $selectedMode) {
                        ForEach(TasksPresentation.modes, id: \.0) { mode in Text(mode.1).tag(mode.0) }
                    }.pickerStyle(.menu).frame(maxWidth: 220)
                    if selectedMode == "study" {
                        Picker("Course", selection: $selectedCourseId) {
                            Text("Choose a course").tag("")
                            ForEach(state.work.courses ?? []) { course in Text(course.title).tag(course.id) }
                        }.pickerStyle(.menu).frame(maxWidth: 280)
                        if state.work.courses?.isEmpty != false {
                            Text("Add a course in Library before starting this study task.").font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.fg3)
                        }
                    } else if selectedMode == "grocery" {
                        Text("Use a separate itemized grocery list in the linked session.").font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.fg3)
                    } else if selectedMode == "coding" {
                        Text("Saved for planning. Start a supported coding project from Agents.").font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.fg3)
                    }
                    Button("Start work") {
                        if var command = TasksPresentation.command("tasks.start", task: task, mode: selectedMode) {
                            if selectedMode == "study", !selectedCourseId.isEmpty { command.courseId = selectedCourseId }
                            send(command)
                        }
                    }.buttonStyle(ConsoleButtonStyle(kind: .plain)).disabled(unavailable || selectedMode == "coding" || (selectedMode == "study" && selectedCourseId.isEmpty))
                }
            }
            ConsoleHairline(weight: .row)
            VStack(alignment: .leading, spacing: 10) {
                Button(task.status == "user-reported-done" ? "Reopen task" : "Mark done") {
                    if let command = TasksPresentation.command(task.status == "user-reported-done" ? "tasks.reopen" : "tasks.done", task: task) { send(command) }
                }.buttonStyle(ConsoleButtonStyle(kind: .plain)).disabled(unavailable)
                Text("Marked done by you is recorded as user reported. Verified results remain in the linked work.")
                    .font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.fg3).lineSpacing(4)
            }
        }
        if let source = state.work.sources.first(where: { $0.id == revision.sourceId }) {
            DisclosureGroup("Latest imported note") {
                Text(source.text).font(ConsoleTheme.sans(12)).foregroundStyle(ConsoleTheme.fg2).textSelection(.enabled).padding(.top, 8)
            }.font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.fg3)
        }
    }
    private func linkedWork(_ saved: HormesSession, task: HormesWorkTask) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            eyebrow("LINKED WORK")
            Text(saved.title).font(ConsoleTheme.sans(17, .medium)).foregroundStyle(ConsoleTheme.fg)
            Text(saved.next).font(ConsoleTheme.sans(13)).foregroundStyle(ConsoleTheme.fg2).lineSpacing(4)
            HStack(spacing: 14) {
                Button("View record") { send(HormesWorkCommand(action: "inspect", sessionId: saved.id)) }
                    .buttonStyle(ConsoleButtonStyle(kind: .plain)).disabled(!state.connected || pending != nil)
                if task.status != "user-reported-done" && task.mode != "coding" {
                    Button("Resume work") { if let command = TasksPresentation.command("tasks.start", task: task, mode: task.mode) { send(command) } }
                        .buttonStyle(ConsoleButtonStyle(kind: .plain)).disabled(unavailable)
                }
            }
        }
    }
    private func select(_ task: HormesWorkTask?) {
        selectedId = task?.id; selectedMode = task?.mode ?? task?.suggestedMode ?? "study"; selectedCourseId = ""; message = nil
    }
    private func send(_ command: HormesWorkCommand) {
        pending = command; waiting = false; message = nil
        if command.action == "tasks.start" { state.workActionHandler(command) }
        else { state.send(.work(command)) }
    }
    private func eyebrow(_ title: String) -> some View {
        Text(title).font(ConsoleTheme.mono(10, .medium)).tracking(1.1).foregroundStyle(ConsoleTheme.fg3)
    }
}

import SwiftUI

enum WorkWords {
    static func artifact(_ text: String, sources: [HormesSource]) -> String {
        sources.enumerated().reduce(text) { result, entry in result.replacingOccurrences(of: entry.element.id, with: "[\(entry.offset + 1)]") }
    }
    static let work = "Work"
    static let subtitle = "Goals, sessions, and what comes next"
    static let goals = "Goals"
    static let sessions = "Saved sessions"
    static let other = "Other work"
    static let notes = "Notes and questions"
    static func mode(_ raw: String) -> String { modes.first(where: { $0.0 == raw })?.1 ?? raw.capitalized }
    static func date(_ milliseconds: Double) -> Date { Date(timeIntervalSince1970: milliseconds / 1000) }
    static func stamp(_ milliseconds: Double) -> String { date(milliseconds).formatted(date: .abbreviated, time: .shortened) }
    static let demo = "Hypothetical day · advance manually"
    static let calendar = "Read today's Calendar"
    static let suggestions = "Calendar suggestions"
    static let calendarHint = "Choose calendars, then link events to a mode and goal. Suggestions wait for your acceptance."
    static let link = "Link event"
    static let open = "Open"
    static let dismiss = "Dismiss"
    static let start = "Start a session"
    static let evidence = "Checked attempts"
    static let history = "Session record"
    static let resume = "Resume from notch"
    static let quiet = "Break · suggestions paused"
    static let modes = [("class", "Class"), ("review", "Review"), ("study", "Study"), ("exam", "Exam prep"), ("coding", "EvoSim"), ("meeting", "VC meeting"), ("grocery", "Groceries"), ("travel", "Travel to NYC"), ("break", "Break")]
    static let times = ["09:00", "11:00", "13:00", "15:00", "16:00", "17:00", "19:00"]
}

/// UI availability mirrors the backend; the daemon remains the execution authority.
enum WorkGoalRouting {
    static let codingOutcome = "Optimize EvoSim with verified results"
    static let learningModes = ["class", "study", "review", "exam"]
    static func executableCoding(_ goal: HormesGoal) -> Bool {
        goal.kind == "coding" && goal.id == "goal_coding" && (goal.outcome == nil || goal.outcome == codingOutcome)
    }
    static func canStart(_ mode: String, goal: HormesGoal?) -> Bool {
        guard mode != "break", let goal else { return true }
        let kind = learningModes.contains(mode) ? "learning" : mode
        return goal.kind == kind && (kind != "coding" || executableCoding(goal))
    }
    static func startCommand(_ mode: String, goal: HormesGoal?, course: HormesCourse?) -> HormesWorkCommand? {
        guard canStart(mode, goal: goal) else { return nil }
        var command = HormesWorkCommand(action: "start", mode: mode)
        if mode != "break", let goal {
            command.goalId = goal.id; command.courseId = goal.courseId
        } else if learningModes.contains(mode), let course {
            command.courseId = course.id; command.courseTitle = course.title
        }
        return command
    }
}

private struct GoalEditorPresentation: Identifiable {
    let id = UUID()
    let goal: HormesGoal?
    let courseId: String?
}

/// The library records work. Opening a record reads it; resuming is a separate action.
struct WorkPane: View {
    @EnvironmentObject private var state: AppState
    @EnvironmentObject private var console: ConsoleSession
    @State private var showsTools = false
    @State private var linkingEvent: HormesCalendarEvent?
    @State private var editingGoal: GoalEditorPresentation?
    private var selected: String? {
        get { console.selectedWorkSessionId }
        nonmutating set { console.selectedWorkSessionId = newValue }
    }
    @State private var selectedGoal: String?
    @State private var selectedCourse: String?
    @State private var nextClassTitle = "Next lecture"
    @State private var nextCourseTitle = "Intermediate Microeconomics"
    private var work: HormesWorkState { state.work }
    private var sessions: [HormesSession] {
        work.sessions.filter {
            (selectedGoal == nil || $0.goalId == selectedGoal) &&
            (selectedCourse == nil || (selectedCourse == "__other" ? $0.courseId == nil : $0.courseId == selectedCourse))
        }
    }
    private var title: String {
        if let goal = work.goals.first(where: { $0.id == selectedGoal }) { return goal.title }
        if selectedCourse == "__other" { return WorkWords.other }
        return (work.courses ?? []).first(where: { $0.id == selectedCourse })?.title ?? "Your library"
    }
    private var record: HormesSession? { work.sessions.first { $0.id == selected } }

    var body: some View {
        HStack(spacing: 0) {
            if !console.viewingAgentWork {
                librarySidebar.frame(width: 224)
                ConsoleHairline(vertical: true, thickness: ConsoleHairline.sidebarEdge)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 30) {
                    if let record { recordPage(record) }
                    else { libraryPage }
                }.padding(30).frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(ConsoleTheme.ground)
        }
        .sheet(item: $linkingEvent) { event in
            CalendarLinkEditor(event: event, goals: work.goals, courses: work.courses ?? [], saved: {
                linkingEvent = nil
            }, cancel: { linkingEvent = nil })
        }
        .sheet(item: $editingGoal) { presentation in
            GoalEditor(goal: presentation.goal, courseId: presentation.courseId, saved: { goalId in
                editingGoal = nil; selectedGoal = goalId; selectedCourse = nil; selected = nil
            }, cancel: { editingGoal = nil })
        }
    }

    private var librarySidebar: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                VStack(alignment: .leading, spacing: 10) {
                    eyebrow("LIBRARY")
                    folder("All work", symbol: "square.stack", count: work.sessions.count, selected: selectedCourse == nil && selectedGoal == nil) {
                        selectedCourse = nil; selectedGoal = nil; selected = nil
                    }
                }
                VStack(alignment: .leading, spacing: 10) {
                    eyebrow("COURSES")
                    ForEach(work.courses ?? []) { course in
                        folder(course.title, symbol: "folder", count: work.sessions.filter { $0.courseId == course.id }.count, selected: selectedCourse == course.id && selectedGoal == nil) {
                            selectedCourse = course.id; selectedGoal = nil; selected = nil
                        }
                    }
                    if (work.courses ?? []).isEmpty {
                        Text("Course folders appear with your first class session.")
                            .font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.fg3).lineSpacing(4)
                    }
                    folder(WorkWords.other, symbol: "tray", count: work.sessions.filter { $0.courseId == nil }.count, selected: selectedCourse == "__other" && selectedGoal == nil) {
                        selectedCourse = "__other"; selectedGoal = nil; selected = nil
                    }
                }
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        eyebrow("GOALS")
                        Spacer()
                        Button {
                            editingGoal = GoalEditorPresentation(goal: nil, courseId: selectedCourse == "__other" ? nil : selectedCourse)
                        } label: { Image(systemName: "plus").font(.system(size: 12)).frame(width: 24, height: 24) }
                            .buttonStyle(.plain).foregroundStyle(ConsoleTheme.fg2)
                            .help("New goal").accessibilityLabel("New goal")
                    }
                    if work.goals.isEmpty {
                        Text("Create a goal to carry work across sessions.")
                            .font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.fg3).lineSpacing(4)
                    }
                    ForEach(work.goals) { goal in
                        Button {
                            selectedGoal = goal.id; selectedCourse = nil; selected = nil
                        } label: {
                            HStack(alignment: .top, spacing: 10) {
                                Circle().stroke(ConsoleTheme.fg3, lineWidth: 1).frame(width: 6, height: 6).padding(.top, 5)
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(goal.title).font(ConsoleTheme.sans(12)).foregroundStyle(selectedGoal == goal.id ? ConsoleTheme.fg : ConsoleTheme.fg2)
                                    Text(goal.state.replacingOccurrences(of: "_", with: " ").replacingOccurrences(of: "-", with: " ").capitalized)
                                        .font(ConsoleTheme.sans(10)).foregroundStyle(ConsoleTheme.fg3)
                                }
                                Spacer(minLength: 0)
                            }.padding(.vertical, 6)
                        }.buttonStyle(.plain).accessibilityAddTraits(selectedGoal == goal.id ? .isSelected : [])
                    }
                }
            }.padding(.horizontal, 22).padding(.vertical, 28)
        }.background(ConsoleTheme.raised.opacity(0.55))
    }

    private func folder(_ title: String, symbol: String, count: Int, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: symbol).font(.system(size: 13, weight: .regular)).frame(width: 16)
                Text(title).font(ConsoleTheme.sans(12, selected ? .medium : .regular)).lineLimit(2)
                Spacer(minLength: 4)
                Text(String(count)).font(ConsoleTheme.mono(10)).foregroundStyle(ConsoleTheme.fg3)
            }.foregroundStyle(selected ? ConsoleTheme.fg : ConsoleTheme.fg2)
                .padding(.vertical, 11).padding(.horizontal, 10)
                .background(RoundedRectangle(cornerRadius: 8).fill(selected ? ConsoleTheme.active : .clear))
        }.buttonStyle(.plain).accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func eyebrow(_ text: String) -> some View {
        Text(text).font(ConsoleTheme.sans(9, .medium)).tracking(1.8).foregroundStyle(ConsoleTheme.fg3)
    }

    private var libraryPage: some View {
        VStack(alignment: .leading, spacing: 28) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 8) {
                    eyebrow(Date.now.formatted(date: .complete, time: .omitted).uppercased())
                    Text(title).font(ConsoleTheme.sans(28, .light)).foregroundStyle(ConsoleTheme.fg)
                }
                Spacer(minLength: 12)
                Button { showsTools = true } label: { Image(systemName: "ellipsis").frame(width: 28, height: 28) }
                    .buttonStyle(.plain).foregroundStyle(ConsoleTheme.fg2).help("Session tools and demo controls")
                    .accessibilityLabel("Session tools and demo controls")
                    .popover(isPresented: $showsTools, arrowEdge: .bottom) {
                        ScrollView {
                            VStack(alignment: .leading, spacing: 24) { startControls; demoControls }.padding(24)
                                    }.frame(width: 420, height: 560).background(ConsoleTheme.ground)
                    }
            }
            if selectedGoal == nil && selectedCourse == nil { dayStrip }
            if let goal = work.goals.first(where: { $0.id == selectedGoal }) {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        eyebrow("SUCCESS CRITERIA")
                        Spacer()
                        Button("Edit goal") { editingGoal = GoalEditorPresentation(goal: goal, courseId: goal.courseId) }
                            .buttonStyle(.plain).font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.fg2)
                    }
                    if let outcome = goal.outcome, outcome != goal.title {
                        Text(outcome).font(ConsoleTheme.sans(14)).foregroundStyle(ConsoleTheme.fg)
                    }
                    ForEach(Array(goal.criteria.enumerated()), id: \.offset) { _, criterion in
                        Text(criterion).font(ConsoleTheme.sans(13)).foregroundStyle(ConsoleTheme.fg2)
                    }
                    if let deadline = goal.deadline {
                        Label("Due \(WorkWords.stamp(deadline))", systemImage: "calendar")
                            .font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.fg2)
                    }
                    if goal.assessment == "user-review" {
                        Text("Custom criteria · progress requires review")
                            .font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.fg3)
                    }
                    Text(goal.next).font(ConsoleTheme.sans(13)).foregroundStyle(ConsoleTheme.fg)
                }
            }
            if let active = work.active, selectedGoal == nil || active.goalId == selectedGoal,
               selectedCourse == nil || active.courseId == selectedCourse || (selectedCourse == "__other" && active.courseId == nil) {
                activeRow(active)
            }
            if selectedCourse != nil { deckRows(selectedCourse == "__other" ? nil : selectedCourse) }
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    eyebrow("SAVED SESSIONS")
                    Spacer()
                    Text(String(sessions.count)).font(ConsoleTheme.mono(10)).foregroundStyle(ConsoleTheme.fg3)
                }
                if sessions.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        Image(systemName: "square.and.pencil").font(.system(size: 24, weight: .ultraLight)).foregroundStyle(ConsoleTheme.fg3)
                        Text("Your work starts here.").font(ConsoleTheme.sans(18, .light)).foregroundStyle(ConsoleTheme.fg2)
                        Text("Notes, practice, and outcomes are saved by course, date, and session type.")
                            .font(ConsoleTheme.sans(12)).foregroundStyle(ConsoleTheme.fg3).fixedSize(horizontal: false, vertical: true)
                    }.padding(.vertical, 28)
                } else { datedSessions(sessions) }
            }
            if !work.calendar.filter({ !$0.demo }).isEmpty {
                DisclosureGroup("Calendar links") { calendarRows }.font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.fg3)
            }
        }
    }

    private var dayStrip: some View {
        VStack(alignment: .leading, spacing: 12) {
            if !work.calendar.isEmpty {
                eyebrow(work.calendar.allSatisfy(\.demo) ? "HYPOTHETICAL DAY · ADVANCE MANUALLY" : "YOUR DAY")
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: 24) {
                        ForEach(work.calendar.sorted { $0.startsAt < $1.startsAt }) { event in
                            Button {
                                if event.demo {
                                    state.workActionHandler(HormesWorkCommand(action: "demo", blockId: event.id.replacingOccurrences(of: "demo_", with: "")))
                                } else if let mode = event.mode {
                                    state.workActionHandler(HormesWorkCommand(action: "start", mode: mode, blockId: event.id))
                                }
                            } label: {
                                VStack(alignment: .leading, spacing: 7) {
                                    Text(WorkWords.date(event.startsAt).formatted(date: .omitted, time: .shortened))
                                        .font(ConsoleTheme.mono(10)).foregroundStyle(ConsoleTheme.fg3)
                                    Text(event.title).font(ConsoleTheme.sans(12)).foregroundStyle(work.active?.calendarId == event.id ? ConsoleTheme.fg : ConsoleTheme.fg2)
                                        .lineLimit(2).frame(width: 126, alignment: .leading)
                                    Rectangle().fill(work.active?.calendarId == event.id ? ConsoleTheme.fg : ConsoleTheme.hairRow).frame(height: 1)
                                }
                            }.buttonStyle(.plain).disabled(!event.demo && event.mode == nil)
                        }
                    }
                }
            }
        }
    }

    private func activeRow(_ session: HormesSession) -> some View {
        HStack(alignment: .center, spacing: 16) {
            Rectangle().fill(ConsoleTheme.fg2).frame(width: 2)
            VStack(alignment: .leading, spacing: 7) {
                eyebrow(work.quiet ? "ON A BREAK" : "CONTINUE")
                Text(session.title).font(ConsoleTheme.sans(16, .medium)).foregroundStyle(ConsoleTheme.fg)
                Text(session.next).font(ConsoleTheme.sans(12)).foregroundStyle(ConsoleTheme.fg2).lineLimit(2)
            }
            Spacer(minLength: 12)
            Button {
                state.workActionHandler(HormesWorkCommand(action: "resume", sessionId: session.id))
            } label: { Image(systemName: "arrow.up.right").frame(width: 32, height: 32) }
                .buttonStyle(.plain).foregroundStyle(ConsoleTheme.fg).help(WorkWords.resume).accessibilityLabel(WorkWords.resume)
        }.padding(18).background(ConsoleTheme.raised).clipShape(RoundedRectangle(cornerRadius: 10))
    }

    private func recordPage(_ session: HormesSession) -> some View {
        VStack(alignment: .leading, spacing: 24) {
            Button {
                if console.viewingAgentWork { console.showNow() } else { selected = nil }
            } label: {
                Label(console.viewingAgentWork ? "Back to \(console.selectedAgentRole.name)" : "Back to library", systemImage: "arrow.left").font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.fg3)
            }.buttonStyle(.plain)
            HStack(alignment: .top, spacing: 20) {
                VStack(alignment: .leading, spacing: 10) {
                    eyebrow("\(WorkWords.mode(session.mode).uppercased()) · \(WorkWords.stamp(session.createdAt).uppercased())\(session.demo ? " · DEMO" : "")")
                    Text(session.title).font(ConsoleTheme.sans(28, .light)).foregroundStyle(ConsoleTheme.fg)
                }
                Spacer(minLength: 0)
                Button("Resume") { state.workActionHandler(HormesWorkCommand(action: "resume", sessionId: session.id)) }
                    .buttonStyle(ConsoleButtonStyle(kind: .plain)).help(WorkWords.resume)
            }
            ConsoleHairline(weight: .row)
            detail(session).frame(maxWidth: 760, alignment: .leading)
        }
    }

    private func canStartSession(_ mode: String) -> Bool {
        WorkGoalRouting.canStart(mode, goal: work.goals.first { $0.id == selectedGoal })
    }

    private func startSession(_ mode: String) {
        let goal = work.goals.first { $0.id == selectedGoal }
        let course = (work.courses ?? []).first { $0.id == selectedCourse }
        guard let command = WorkGoalRouting.startCommand(mode, goal: goal, course: course) else { return }
        state.workActionHandler(command)
    }

    private var startControls: some View {
        VStack(alignment: .leading, spacing: 8) {
            ConsoleGroupHead(title: WorkWords.start)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 98))], alignment: .leading) {
                ForEach(WorkWords.modes, id: \.0) { mode in
                    Button(mode.1) { startSession(mode.0) }
                        .buttonStyle(ConsoleButtonStyle()).disabled(!state.connected || !canStartSession(mode.0))
                }
            }
            if let goal = work.goals.first(where: { $0.id == selectedGoal }), goal.kind == "coding", !canStartSession("coding") {
                Text("This coding goal is saved for planning. Agent execution currently supports the bounded EvoSim project.")
                    .font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.fg3)
            }
            if let session = work.active, ["study", "exam", "review"].contains(session.mode) {
                HStack {
                    Button("Prepare MCQ quiz") { state.workActionHandler(HormesWorkCommand(action: "ask", sessionId: session.id, text: "Read work.context. Prepare a short multiple-choice quiz on the course concept, then display only the quiz through work.quiz. Include 2–6 options and a zero-based correctOption for each question. Students click answers; no voice session is needed.")) }.buttonStyle(ConsoleButtonStyle(kind: .plain)).disabled(work.busy || work.quiet || (session.surface?.kind == "flashcard" && session.surface?.attemptId == nil))
                    Button("Take a break") { state.workActionHandler(HormesWorkCommand(action: "break.start", sessionId: session.id, durationSeconds: 300)) }.buttonStyle(ConsoleButtonStyle(kind: .plain))
                }
            }
            if let session = work.active, session.mode == "class" {
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Button(session.lecture?.status == "recording" ? "Pause lecture" : "Record lecture") { state.workActionHandler(HormesWorkCommand(action: session.lecture?.status == "recording" ? "lecture.pause" : "lecture.begin", sessionId: session.id)) }.buttonStyle(ConsoleButtonStyle(kind: .plain))
                        Button("Save lecture notes") { state.workActionHandler(HormesWorkCommand(action: "lecture.end", sessionId: session.id)) }.buttonStyle(ConsoleButtonStyle(kind: .plain)).disabled(work.busy || (session.lecture?.revision ?? 0) == 0)
                    }
                    TextField("Next class title", text: $nextClassTitle).textFieldStyle(.roundedBorder)
                    TextField("Course folder", text: $nextCourseTitle).textFieldStyle(.roundedBorder)
                    Button("Next class · four-question review") {
                        let courseId = nextCourseTitle == "Intermediate Microeconomics" ? "microeconomics" : nextCourseTitle.lowercased().replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression).trimmingCharacters(in: CharacterSet(charactersIn: "-"))
                        state.workActionHandler(HormesWorkCommand(action: "class.next", sessionId: session.id, title: nextClassTitle, courseId: courseId, courseTitle: nextCourseTitle))
                    }.buttonStyle(ConsoleButtonStyle(kind: .plain)).disabled(work.busy || nextClassTitle.isEmpty || nextCourseTitle.isEmpty)
                }
            }
            Button(WorkWords.calendar) { state.workCalendarHandler() }.buttonStyle(ConsoleButtonStyle(kind: .plain))
            if !state.workCalendarStatus.isEmpty {
                Text(state.workCalendarStatus).font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.muted)
            }
            if let sources = work.calendarSources, !sources.isEmpty {
                DisclosureGroup("Calendars") {
                    ForEach(sources) { source in
                        Toggle(isOn: Binding(get: { work.selectedCalendarIds?.contains(source.id) ?? false }, set: { enabled in
                            var selected = Set(work.selectedCalendarIds ?? [])
                            if enabled { selected.insert(source.id) } else { selected.remove(source.id) }
                            state.workActionHandler(HormesWorkCommand(action: "calendar.configure", selectedCalendarIds: selected.sorted()))
                        })) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(source.title).font(ConsoleTheme.sans(12))
                                Text(source.account).font(ConsoleTheme.sans(10)).foregroundStyle(ConsoleTheme.fg3)
                            }
                        }.toggleStyle(.checkbox)
                    }
                }.font(ConsoleTheme.sans(12))
            }
            Toggle(WorkWords.suggestions, isOn: Binding(get: { work.calendarEnabled ?? false }, set: { state.workActionHandler(HormesWorkCommand(action: "calendar.configure", enabled: $0)) }))
                .toggleStyle(.switch).font(ConsoleTheme.sans(12))
            Text(WorkWords.calendarHint).font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.muted)
        }
    }
    private var demoControls: some View {
        VStack(alignment: .leading, spacing: 0) {
            ConsoleGroupHead(title: WorkWords.demo)
            ForEach([("class", "Class", "09:00"), ("review", "Review", "11:00"), ("class2", "Next class", "12:00"), ("study", "Study", "13:00"), ("exam", "Exam prep", "15:00"), ("coding", "EvoSim", "15:30"), ("meeting", "VC meeting", "16:00"), ("grocery", "Grocery cart", "17:00"), ("break", "Break", "19:00")], id: \.0) { block in
                ConsoleRow(title: block.1, value: block.2, trailing: .chevron, selected: work.demoBlock == block.0, primary: {
                    state.workActionHandler(HormesWorkCommand(action: "demo", blockId: block.0))
                })
            }
        }
    }
    private var calendarRows: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(work.calendar.filter { !$0.demo }) { event in
                HStack {
                    ConsoleRow(title: event.title, value: event.mode.map(WorkWords.mode), meta: work.goals.first(where: { $0.id == event.goalId })?.title ?? event.calendar, primary: {
                        if let mode = event.mode { state.workActionHandler(HormesWorkCommand(action: "start", mode: mode, blockId: event.id)) }
                        else { linkingEvent = event }
                    })
                    Button(event.mode == nil ? WorkWords.link : "Edit link") { linkingEvent = event }
                        .buttonStyle(ConsoleButtonStyle(kind: .plain))
                }
            }
        }
    }
    private func deckRows(_ courseId: String?) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            let decks = (work.decks ?? []).filter { $0.courseId == courseId && $0.purpose == "recall" }
            if !decks.isEmpty {
                ConsoleGroupHead(title: "Flashcard decks", count: String(decks.count))
                ForEach(decks) { deck in
                    HStack {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(deck.title).font(ConsoleTheme.sans(13))
                            Text("\(deck.cardCount) cards · \(WorkWords.stamp(deck.createdAt))\(deck.demo ? " · Demo" : "")").font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.muted)
                        }
                        Spacer()
                        if let session = work.active, session.goalId == deck.goalId, session.demo == deck.demo {
                            let armed = session.recallPlan?.deckId == deck.id && session.recallPlan?.enabled == true
                            Button(armed ? "Pause recall" : "Start recall") { state.workActionHandler(HormesWorkCommand(action: "recall.configure", sessionId: session.id, enabled: !armed, deckId: deck.id)) }.buttonStyle(ConsoleButtonStyle(kind: .plain))
                        }
                    }.padding(.vertical, 5)
                }
            }
        }
    }
    private func datedSessions(_ items: [HormesSession]) -> some View {
        let days = Set(items.map { Calendar.current.startOfDay(for: WorkWords.date($0.createdAt)) }).sorted(by: >)
        return VStack(alignment: .leading, spacing: 24) {
            ForEach(days, id: \.self) { day in
                VStack(alignment: .leading, spacing: 0) {
                    Text(day.formatted(date: .abbreviated, time: .omitted)).font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.fg3).padding(.bottom, 8)
                    ForEach(items.filter { Calendar.current.isDate(WorkWords.date($0.createdAt), inSameDayAs: day) }.sorted { $0.createdAt > $1.createdAt }) { session in
                        Button {
                            selected = session.id
                            state.workActionHandler(HormesWorkCommand(action: "inspect", sessionId: session.id))
                        } label: {
                            HStack(alignment: .top, spacing: 16) {
                                Image(systemName: symbol(session.mode)).font(.system(size: 18, weight: .ultraLight)).foregroundStyle(ConsoleTheme.fg2)
                                    .frame(width: 24, height: 28)
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(session.title).font(ConsoleTheme.sans(14, .medium)).foregroundStyle(ConsoleTheme.fg).lineLimit(2)
                                    Text("\(WorkWords.mode(session.mode))\(session.demo ? " · Demo" : "") · \(courseTitle(session))")
                                        .font(ConsoleTheme.sans(10)).foregroundStyle(ConsoleTheme.fg3)
                                    Text(session.next).font(ConsoleTheme.sans(12)).foregroundStyle(ConsoleTheme.fg2).lineLimit(2)
                                }
                                Spacer(minLength: 8)
                                VStack(alignment: .trailing, spacing: 7) {
                                    Text(WorkWords.date(session.createdAt).formatted(date: .omitted, time: .shortened))
                                        .font(ConsoleTheme.mono(10))
                                    Text(session.state.capitalized).font(ConsoleTheme.sans(10))
                                }.foregroundStyle(ConsoleTheme.fg3).padding(.top, 3)
                                Image(systemName: "arrow.up.right").font(.system(size: 10)).foregroundStyle(ConsoleTheme.fg3).padding(.top, 3)
                            }.padding(.vertical, 18).frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                        }.buttonStyle(.plain)
                        ConsoleHairline(weight: .row)
                    }
                }
            }
        }
    }
    private func courseTitle(_ session: HormesSession) -> String {
        (work.courses ?? []).first(where: { $0.id == session.courseId })?.title ?? WorkWords.other
    }
    private func symbol(_ mode: String) -> String {
        switch mode {
        case "class": return "waveform"
        case "study", "exam": return "pencil.tip"
        case "review": return "rectangle.on.rectangle"
        case "meeting": return "person.2"
        case "grocery": return "basket"
        case "travel": return "arrow.triangle.turn.up.right.diamond"
        case "coding": return "chevron.left.forwardslash.chevron.right"
        default: return "moon"
        }
    }
    private func detail(_ session: HormesSession) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(session.next).font(ConsoleTheme.sans(13))
            if let grocery = session.grocery { GroceryRecord(grocery: grocery, sources: work.sources) }
            if let meeting = session.meeting {
                MeetingRecord(meeting: meeting, sources: work.sources)
            }
            if let lecture = session.lecture {
                if let notes = lecture.notes {
                    ConsoleGroupHead(title: "Lecture notes")
                    Text("\(WorkWords.stamp(notes.at)) · Transcript revision \(notes.revision)\(notes.revision == lecture.revision ? "" : " · Earlier draft") · AI summary, review against transcript").font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.muted)
                    Text(notes.text).font(ConsoleTheme.sans(14)).lineSpacing(5).textSelection(.enabled)
                    ConsoleGroupHead(title: "Main takeaways")
                    ForEach(Array(notes.takeaways.enumerated()), id: \.offset) { item in Text("\(item.offset + 1). \(item.element)").font(ConsoleTheme.sans(13)).textSelection(.enabled) }
                }
                if let source = work.sources.first(where: { $0.id == lecture.sourceId }), !source.text.isEmpty {
                    DisclosureGroup("Original lecture transcript") { Text(source.text).font(ConsoleTheme.sans(12)).textSelection(.enabled) }
                    if work.active?.id == session.id {
                        Button("Regenerate notes from transcript") { state.workActionHandler(HormesWorkCommand(action: "lecture.notes", sessionId: session.id)) }.buttonStyle(ConsoleButtonStyle(kind: .plain)).disabled(work.busy || ["recording", "question"].contains(lecture.status))
                    }
                }
            }
            if let artifact = session.artifact, session.meeting == nil, session.lecture?.notes == nil { Text(WorkWords.artifact(artifact, sources: work.sources)).font(ConsoleTheme.sans(13)).textSelection(.enabled) }
            if work.evidence.contains(where: { $0.sessionId == session.id }) { ConsoleGroupHead(title: WorkWords.evidence) }
            ForEach(work.evidence.filter { $0.sessionId == session.id }) { evidence in
                if work.evidence.first(where: { $0.observationId == evidence.observationId })?.id == evidence.id {
                    WorkEvidenceAttempt(evidence: work.evidence.filter { $0.observationId == evidence.observationId }, busy: work.busy) { reason in
                        state.workActionHandler(HormesWorkCommand(action: "evidence.invalidate", sessionId: session.id, text: reason, evidenceId: evidence.id))
                    }
                }
            }
            if let attempts = work.recallAttempts, attempts.contains(where: { $0.sessionId == session.id }) {
                ConsoleGroupHead(title: "Recall and quiz attempts")
                ForEach(attempts.filter { $0.sessionId == session.id }) { attempt in
                    Text("\(WorkWords.stamp(attempt.at)) · \(attempt.input == "choice" ? "MCQ" : "Spoken recall") · \(attempt.result)\(attempt.assisted ? " · helped" : "")\(attempt.demo ? " · demo" : "")").font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.muted)
                    Text(attempt.front).font(ConsoleTheme.sans(13))
                    Text("You: \(attempt.answer)\nReference: \(attempt.back)").font(ConsoleTheme.sans(12)).textSelection(.enabled)
                    Text("Next due: \(WorkWords.stamp(attempt.nextDueAt)) · Authored-reference check; broader mastery unassessed").font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.muted)
                }
            }
            if work.observations.contains(where: { $0.sessionId == session.id && ["question", "tutor", "recap"].contains($0.kind) }) { ConsoleGroupHead(title: WorkWords.notes) }
            ForEach(work.observations.filter { $0.sessionId == session.id && ["question", "tutor", "recap"].contains($0.kind) }) { observation in
                Text("\(WorkWords.stamp(observation.at)) · \(observation.actor == "student" ? "You" : "Hormes")").font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.muted)
                Text(observation.text).font(ConsoleTheme.sans(12)).textSelection(.enabled)
            }
            ForEach(work.sources.filter { session.sourceIds.contains($0.id) }) { source in
                Text(source.title).font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.muted)
            }
        }
    }
}

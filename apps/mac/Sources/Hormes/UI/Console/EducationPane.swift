import SwiftUI

/// Education starts with a goal and a useful next action. The curriculum and records are secondary.
struct EducationPane: View {
    @EnvironmentObject private var state: AppState
    @EnvironmentObject private var console: ConsoleSession
    @State private var exploring = false
    @State private var subjectId: String?
    @State private var skillId: String?
    @State private var selectedGoalId: String?
    @State private var demo = false
    @State private var editingGoal = false
    @State private var pending: HormesWorkCommand?
    @State private var queuedSkillId: String?
    @State private var canRetry = false
    @State private var message: String?
    init(initialStageId: String = "today", initialSkillId: String? = nil) {
        _exploring = State(initialValue: initialStageId != "today")
        _skillId = State(initialValue: initialSkillId)
    }
    private var work: HormesWorkState { state.work }
    private var education: HormesEducation? { work.education }
    private var selected: HormesEducationSkill? { education?.skills.first { $0.id == skillId } }
    private var goal: HormesGoal? { EducationPresentation.focusGoal(work: work, selectedId: selectedGoalId, demo: demo) }
    private var ready: Bool { state.connected && !work.busy && !work.quiet && pending == nil }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 30) {
                heading
                if let education {
                    if let selected { skillDetail(selected) }
                    else if exploring { explore(education) }
                    else { learningHome }
                } else {
                    Text(state.connected ? "Getting your learning ready…" : "Connect to Hormes to pick up your learning.")
                        .font(ConsoleTheme.sans(15)).foregroundStyle(ConsoleTheme.fg2)
                }
                if work.quiet { Text("Enjoy your break. Your learning will be here when you return.").font(ConsoleTheme.sans(12)).foregroundStyle(ConsoleTheme.fg2) }
                if !state.connected { Text("Connect to Hormes to continue. Your saved work stays here.").font(ConsoleTheme.sans(12)).foregroundStyle(ConsoleTheme.fg2) }
                if let message { Text(message).font(ConsoleTheme.sans(13)).foregroundStyle(ConsoleTheme.fg2).textSelection(.enabled) }
                if let pending {
                    HStack(spacing: 12) {
                        Text(pending.action == "inspect" ? "Opening your saved work…" : "Getting your lesson ready…")
                            .font(ConsoleTheme.sans(13)).foregroundStyle(ConsoleTheme.fg2)
                        if canRetry {
                            Button("Retry") { send(pending) }.buttonStyle(ConsoleButtonStyle(kind: .plain)).disabled(!state.connected)
                        }
                    }
                }
            }
            .padding(32).frame(maxWidth: 880, alignment: .leading).frame(maxWidth: .infinity)
        }
        .background(ConsoleTheme.ground)
        .tint(ConsoleTheme.fg2)
        .sheet(isPresented: $editingGoal) {
            GoalEditor(goal: nil, courseId: goal?.courseId, saved: { id in
                editingGoal = false; selectedGoalId = id; skillId = nil; exploring = false
            }, cancel: { editingGoal = false })
        }
        .onReceive(state.workReplies) { reply in
            guard let command = pending, reply.requestId == command.requestId else { return }
            pending = nil; canRetry = false
            guard reply.ok else { queuedSkillId = nil; message = reply.message ?? "That action could not finish. Your work is saved."; return }
            message = nil
            if command.action == "inspect", let id = command.sessionId { console.openWork(id) }
            if let skill = queuedSkillId {
                queuedSkillId = nil
                // Bootstrap only from this acknowledged real course session, never from rehearsal.
                if let next = EducationPresentation.bootstrappedPractice(skillId: skill, work: reply.state) {
                    send(next)
                } else { message = "Your lesson is ready. Continue from your learning goal." }
            }
        }
        .task(id: pending?.requestId) {
            guard pending != nil else { return }
            try? await Task.sleep(for: .seconds(12))
            guard !Task.isCancelled else { return }
            canRetry = true
        }
    }

    private var heading: some View {
        HStack(alignment: .firstTextBaseline, spacing: 16) {
            if selected != nil {
                Button { skillId = nil } label: { Label(exploring ? "Explore concepts" : "Your learning", systemImage: "arrow.left") }
                    .buttonStyle(ConsoleButtonStyle(kind: .plain))
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    Text(exploring ? "Explore concepts" : "Your learning")
                        .font(ConsoleTheme.sans(27, .medium)).foregroundStyle(ConsoleTheme.fg)
                    Text(exploring ? "Find something that supports the work you care about." : "Pick up your work. Take the next step.")
                        .font(ConsoleTheme.sans(13)).foregroundStyle(ConsoleTheme.fg2)
                }
            }
            Spacer(minLength: 8)
            if demo { Text("Rehearsal").font(ConsoleTheme.sans(11, .medium)).foregroundStyle(ConsoleTheme.fg2) }
            Button {
                skillId = nil; exploring.toggle(); subjectId = nil
            } label: { Label(exploring ? "Your learning" : "Explore concepts", systemImage: exploring ? "arrow.left" : "arrow.up.right") }
                .buttonStyle(ConsoleButtonStyle(kind: .plain)).accessibilityIdentifier("education.explore")
        }
    }

    @ViewBuilder private var learningHome: some View {
        if let goal {
            goalCard(goal)
            let suggested = EducationPresentation.suggestedSkills(goal: goal, demo: demo, work: work)
            if !suggested.isEmpty {
                VStack(alignment: .leading, spacing: 14) {
                    Text("Practice next").font(ConsoleTheme.sans(18, .medium)).foregroundStyle(ConsoleTheme.fg)
                    Text("Small steps toward \(goal.title.lowercased()).").font(ConsoleTheme.sans(12)).foregroundStyle(ConsoleTheme.fg2)
                    ForEach(suggested) { skill in conceptRow(skill, goalId: goal.id) }
                }
            }
            let otherGoals = work.goals.filter { $0.kind == "learning" && $0.state != "complete" && $0.id != goal.id }
            if !otherGoals.isEmpty {
                ConsoleDisclosure(id: "education.other-goals", title: "Other learning goals", count: String(otherGoals.count)) {
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(otherGoals) { other in
                            Button { selectedGoalId = other.id; skillId = nil } label: {
                                HStack { Text(other.title).font(ConsoleTheme.sans(14)); Spacer(); Image(systemName: "arrow.right") }
                            }.buttonStyle(ConsoleButtonStyle(kind: .plain))
                        }
                    }.padding(.top, 12)
                }
            }
            recentPractice(goal)
            phoneReviews
        } else {
            VStack(alignment: .leading, spacing: 18) {
                Text("What would you like to understand?").font(ConsoleTheme.sans(25, .medium)).foregroundStyle(ConsoleTheme.fg)
                Text("Start with exchange economies, or choose a learning goal of your own. Your work will be here when you return.")
                    .font(ConsoleTheme.sans(15)).foregroundStyle(ConsoleTheme.fg2).lineSpacing(5)
                HStack(spacing: 14) {
                    Button("Start exchange economies") { send(HormesWorkCommand(action: "start", mode: "study")) }
                        .buttonStyle(ConsoleButtonStyle(kind: .primary, height: 36)).disabled(!ready || demo)
                    Button("Choose a learning goal") { editingGoal = true }.buttonStyle(ConsoleButtonStyle(kind: .ghost, height: 36)).disabled(demo)
                }
            }.padding(26).frame(maxWidth: .infinity, alignment: .leading).background(ConsoleTheme.raised, in: RoundedRectangle(cornerRadius: 16))
        }
    }

    private func goalCard(_ goal: HormesGoal) -> some View {
        let saved = EducationPresentation.sessions(for: goal, demo: demo, work: work).first
        let command = EducationPresentation.continuation(for: goal, demo: demo, work: work)
        return VStack(alignment: .leading, spacing: 20) {
            HStack {
                Text(saved == nil ? "START SOMETHING THAT MATTERS" : "PICK UP WHERE YOU LEFT OFF")
                    .font(ConsoleTheme.sans(10, .medium)).tracking(0.6).foregroundStyle(ConsoleTheme.fg3)
                Spacer()
                Image(systemName: "book").font(.system(size: 18)).foregroundStyle(ConsoleTheme.fg2)
            }
            VStack(alignment: .leading, spacing: 10) {
                Text(goal.title).font(ConsoleTheme.sans(26, .medium)).foregroundStyle(ConsoleTheme.fg)
                if let outcome = goal.outcome, outcome != goal.title {
                    Text(outcome).font(ConsoleTheme.sans(15)).foregroundStyle(ConsoleTheme.fg2).lineSpacing(5)
                } else if goal.courseId == "microeconomics" {
                    Text("Understand how endowments, budgets and prices shape trade.").font(ConsoleTheme.sans(15)).foregroundStyle(ConsoleTheme.fg2).lineSpacing(5)
                }
            }
            if let saved {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Next step").font(ConsoleTheme.sans(11, .medium)).foregroundStyle(ConsoleTheme.fg3)
                    Text(saved.next).font(ConsoleTheme.sans(14)).foregroundStyle(ConsoleTheme.fg2).lineSpacing(4)
                }
            }
            HStack(spacing: 16) {
                Button { if let command { send(command) } } label: {
                    HStack(spacing: 10) { Text(saved == nil ? "Start learning" : "Continue learning"); Image(systemName: "arrow.right") }
                }.buttonStyle(ConsoleButtonStyle(kind: .primary, height: 38))
                    .disabled(command == nil || !ready).accessibilityIdentifier("education.continue")
                if let saved {
                    Button("View your work") { send(HormesWorkCommand(action: "inspect", sessionId: saved.id)) }
                        .buttonStyle(ConsoleButtonStyle(kind: .plain)).disabled(!state.connected || pending != nil)
                }
            }
            if let saved {
                Text("\(WorkWords.mode(saved.mode)) · \(EducationPresentation.stamp(saved.updatedAt))")
                    .font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.fg3)
            } else if demo { Text("Open a rehearsal lesson from Library to continue it here.").font(ConsoleTheme.sans(12)).foregroundStyle(ConsoleTheme.fg2) }
        }.padding(26).frame(maxWidth: .infinity, alignment: .leading)
            .background(ConsoleTheme.raised, in: RoundedRectangle(cornerRadius: 16)).environment(\.consoleSurface, .raised)
    }

    private func conceptRow(_ skill: HormesEducationSkill, goalId: String?) -> some View {
        let records = EducationPresentation.evidence(skill, goalId: goalId, demo: demo)
        return Button { skillId = skill.id } label: {
            HStack(alignment: .center, spacing: 16) {
                Image(systemName: "book").font(.system(size: 16)).foregroundStyle(ConsoleTheme.fg2)
                    .frame(width: 36, height: 36).background(ConsoleTheme.hover, in: RoundedRectangle(cornerRadius: 9))
                VStack(alignment: .leading, spacing: 6) {
                    Text(skill.title).font(ConsoleTheme.sans(15, .medium)).foregroundStyle(ConsoleTheme.fg)
                    Text(EducationPresentation.relevance(skill)).font(ConsoleTheme.sans(12)).foregroundStyle(ConsoleTheme.fg2).multilineTextAlignment(.leading)
                }
                Spacer(minLength: 12)
                if !records.isEmpty { Text(EducationPresentation.practiceSummary(records)).font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.fg3) }
                Image(systemName: "chevron.right").font(.system(size: 11)).foregroundStyle(ConsoleTheme.fg3)
            }.padding(.vertical, 14).contentShape(Rectangle())
        }.buttonStyle(.plain).accessibilityIdentifier("education.skill.\(skill.id)")
    }

    private func explore(_ education: HormesEducation) -> some View {
        VStack(alignment: .leading, spacing: 24) {
            HStack(spacing: 12) {
                subjectButton("All", id: nil)
                ForEach(education.subjects) { subject in subjectButton(subject.title, id: subject.id) }
            }
            ForEach(education.subjects.filter { subjectId == nil || $0.id == subjectId }) { subject in
                VStack(alignment: .leading, spacing: 6) {
                    Text(subject.title).font(ConsoleTheme.sans(18, .medium)).foregroundStyle(ConsoleTheme.fg).padding(.bottom, 6)
                    ForEach(education.skills.filter { $0.subjectId == subject.id }) { skill in conceptRow(skill, goalId: goal?.id) }
                }
            }
            ConsoleDisclosure(id: "education.map-notes", title: "About these concepts") {
                Text(education.limitation).font(ConsoleTheme.sans(12)).foregroundStyle(ConsoleTheme.fg2).lineSpacing(4).padding(.top, 10)
            }
            ConsoleDisclosure(id: "education.preview-tools", title: "Preview tools") {
                Button(demo ? "Return to your learning" : "View rehearsal learning") {
                    demo.toggle(); selectedGoalId = nil; skillId = nil; message = nil
                }.buttonStyle(ConsoleButtonStyle(kind: .plain)).disabled(pending != nil).padding(.top, 8)
                Text("Rehearsal work is kept separate from your own practice.").font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.fg3)
            }
        }
    }
    private func subjectButton(_ title: String, id: String?) -> some View {
        Button { subjectId = id } label: { Text(title) }
            .buttonStyle(ConsoleButtonStyle(kind: subjectId == id ? .primary : .ghost))
            .accessibilityAddTraits(subjectId == id ? .isSelected : [])
    }

    private func skillDetail(_ skill: HormesEducationSkill) -> some View {
        let progress = EducationPresentation.progress(skill, demo: demo)
        let records = EducationPresentation.evidence(skill, goalId: goal?.id, demo: demo)
        return VStack(alignment: .leading, spacing: 28) {
            VStack(alignment: .leading, spacing: 18) {
                Text(skill.title).font(ConsoleTheme.sans(30, .medium)).foregroundStyle(ConsoleTheme.fg)
                Text(EducationPresentation.relevance(skill)).font(ConsoleTheme.sans(16)).foregroundStyle(ConsoleTheme.fg2).lineSpacing(5)
                if let goal { Text("For your goal: \(goal.title)").font(ConsoleTheme.sans(12)).foregroundStyle(ConsoleTheme.fg3) }
                practiceControls(skill, progress: progress)
            }.padding(26).frame(maxWidth: .infinity, alignment: .leading)
                .background(ConsoleTheme.raised, in: RoundedRectangle(cornerRadius: 16)).environment(\.consoleSurface, .raised)
            if !skill.prerequisiteIds.isEmpty {
                ConsoleDisclosure(id: "education.\(skill.id).foundations", title: "Useful foundations") {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach((education?.skills ?? []).filter { skill.prerequisiteIds.contains($0.id) }) { prerequisite in
                            Button { skillId = prerequisite.id } label: { Label(prerequisite.title, systemImage: "arrow.turn.up.left") }
                                .buttonStyle(ConsoleButtonStyle(kind: .plain))
                        }
                    }.padding(.top, 12)
                }
            }
            if records.isEmpty {
                Text("Start with one example. You can ask for a small hint whenever you need it.").font(ConsoleTheme.sans(14)).foregroundStyle(ConsoleTheme.fg2)
            } else {
                ConsoleDisclosure(id: "education.\(skill.id).practice.\(demo ? "demo" : "real")", title: "Your practice", count: String(records.count)) {
                    VStack(alignment: .leading, spacing: 18) { ForEach(Array(records.reversed())) { record in evidenceRow(record) } }.padding(.top, 14)
                }
            }
            ConsoleDisclosure(id: "education.\(skill.id).about", title: "About this concept") {
                VStack(alignment: .leading, spacing: 10) {
                    Text(skill.description).font(ConsoleTheme.sans(12)).foregroundStyle(ConsoleTheme.fg2)
                    if let stage = education?.stages.first(where: { $0.id == skill.stageId }) {
                        Text("Concept grouping: \(stage.title)").font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.fg3)
                    }
                }.padding(.top, 10)
            }
        }
    }
    @ViewBuilder private func practiceControls(_ skill: HormesEducationSkill, progress: HormesEducationProgress) -> some View {
        if let practice = progress.nextPractice, goal == nil || practice.goalId == goal?.id {
            let command = EducationPresentation.practiceCommand(practice, demo: demo, work: work, inspectedId: console.selectedWorkSessionId)
            let records = EducationPresentation.evidence(skill, goalId: practice.goalId, demo: demo)
            Text(EducationPresentation.practiceSummary(records)).font(ConsoleTheme.sans(13)).foregroundStyle(ConsoleTheme.fg2)
            Button { if let command { send(command) } } label: { Label("Practice \(skill.title.lowercased())", systemImage: "arrow.right") }
                .buttonStyle(ConsoleButtonStyle(kind: .primary, height: 38)).disabled(command == nil || !ready)
                .accessibilityIdentifier("education.practice")
            if command == nil { Text("Open a matching rehearsal lesson in Library first.").font(ConsoleTheme.sans(12)).foregroundStyle(ConsoleTheme.fg2) }
            if let origin = EducationPresentation.context(for: practice, demo: demo, work: work, inspectedId: console.selectedWorkSessionId),
               EducationPresentation.offersReturn(origin, skillId: skill.id) {
                Button("Apply this in economics") { send(HormesWorkCommand(action: "education.return", sessionId: origin.id)) }
                    .buttonStyle(ConsoleButtonStyle(kind: .plain)).disabled(origin.state != "active" || !ready)
            }
        } else if goal == nil && skill.id != "functions" && !demo && work.goals.first(where: { $0.id == "goal_learning" }) == nil {
            // The course must be acknowledged before a fresh prerequisite can bind to it.
            Button { queuedSkillId = skill.id; send(HormesWorkCommand(action: "start", mode: "study")) } label: { Label("Practice \(skill.title.lowercased())", systemImage: "arrow.right") }
                .buttonStyle(ConsoleButtonStyle(kind: .primary, height: 38)).disabled(!ready)
                .accessibilityIdentifier("education.practice")
            Text("We'll connect this practice to an exchange-economy learning goal.").font(ConsoleTheme.sans(12)).foregroundStyle(ConsoleTheme.fg2)
        } else {
            Text("Choose an outcome for this topic, then work through it with the tutor. New topics use guided learning without an automatic score.")
                .font(ConsoleTheme.sans(14)).foregroundStyle(ConsoleTheme.fg2).lineSpacing(5)
            Button("Set a learning goal") { editingGoal = true }.buttonStyle(ConsoleButtonStyle(kind: .primary, height: 38)).disabled(demo)
                .accessibilityIdentifier("education.set-goal")
            if let goal, let command = EducationPresentation.continuation(for: goal, demo: demo, work: work) {
                Button("Continue \(goal.title)") { send(command) }.buttonStyle(ConsoleButtonStyle(kind: .plain)).disabled(!ready)
            }
        }
    }
    private func recentPractice(_ goal: HormesGoal) -> some View {
        let records = (education?.skills ?? []).flatMap { EducationPresentation.evidence($0, goalId: goal.id, demo: demo) }
        let independent = Set(records.filter { $0.assistance == "independent" }.map(\.observationId)).count
        let helped = Set(records.filter { $0.assistance != "independent" }.map(\.observationId)).count
        return ConsoleDisclosure(id: "education.history.\(goal.id).\(demo ? "demo" : "real")", title: "Your practice", summary: [.words("\(independent) on your own · \(helped) with help")]) {
            VStack(alignment: .leading, spacing: 16) {
                Text("Each attempt is saved with the help you used. These counts describe practice, not a percentage of the subject learned.")
                    .font(ConsoleTheme.sans(12)).foregroundStyle(ConsoleTheme.fg2)
                if records.isEmpty { Text("Your first attempt will appear here.").font(ConsoleTheme.sans(13)).foregroundStyle(ConsoleTheme.fg2) }
                ForEach(EducationPresentation.sessions(for: goal, demo: demo, work: work).prefix(4)) { saved in
                    Button { send(HormesWorkCommand(action: "inspect", sessionId: saved.id)) } label: {
                        HStack { Text(saved.title); Spacer(); Text(EducationPresentation.stamp(saved.updatedAt)).font(ConsoleTheme.sans(11)); Image(systemName: "arrow.up.right") }
                    }.buttonStyle(ConsoleButtonStyle(kind: .plain)).disabled(!state.connected || pending != nil)
                }
            }.padding(.top, 12)
        }
    }
    @ViewBuilder private var phoneReviews: some View {
        let attempts = (work.recallAttempts ?? []).filter { $0.origin == "iphone" && $0.demo == demo && (goal == nil || $0.goalId == goal?.id) }
        if !attempts.isEmpty {
            ConsoleDisclosure(id: "education.phone.\(demo ? "demo" : "real")", title: "Between-class review", count: String(attempts.count)) {
                VStack(alignment: .leading, spacing: 14) {
                    Text("Short reviews from your iPhone. Your answers stay connected to this course.").font(ConsoleTheme.sans(12)).foregroundStyle(ConsoleTheme.fg2)
                    ForEach(Array(attempts.suffix(4).reversed())) { attempt in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(attempt.front).font(ConsoleTheme.sans(13))
                            Text("\(attempt.answer) · \(attempt.result == "correct" ? "Matched the reference" : "Review again")\(attempt.assisted ? " · with help" : "")")
                                .font(ConsoleTheme.sans(12)).foregroundStyle(ConsoleTheme.fg2)
                            Text(EducationPresentation.stamp(attempt.at)).font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.fg3)
                        }
                    }
                    Text("Review answers describe recall of these questions; they do not complete a learning goal.").font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.fg3)
                }.padding(.top, 12)
            }
        }
    }
    private func evidenceRow(_ evidence: HormesEducationEvidence) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack {
                Text(evidence.correct ? "You got this example" : "Another chance to work through it").font(ConsoleTheme.sans(14, .medium)).foregroundStyle(ConsoleTheme.fg)
                Spacer(minLength: 8)
                Text(evidence.assistance == "independent" ? "On your own" : "With help").font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.fg3)
            }
            Text(EducationPresentation.stamp(evidence.at)).font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.fg3)
            Text("Example check: \(evidence.criterion.replacingOccurrences(of: "-", with: " "))")
                .font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.fg2)
            Text("Your answer: \(evidence.answer)").font(ConsoleTheme.sans(13)).foregroundStyle(ConsoleTheme.fg2).textSelection(.enabled)
            Text(evidence.feedback).font(ConsoleTheme.sans(13)).foregroundStyle(ConsoleTheme.fg2).textSelection(.enabled)
            Text(evidence.limitations).font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.fg3).lineSpacing(3)
            Button("Open this practice session") { send(HormesWorkCommand(action: "inspect", sessionId: evidence.sessionId)) }
                .buttonStyle(ConsoleButtonStyle(kind: .plain)).disabled(!state.connected || pending != nil)
                .accessibilityLabel("Open practice from \(EducationPresentation.stamp(evidence.at))")
        }
    }
    private func send(_ command: HormesWorkCommand) {
        if pending?.requestId != command.requestId { canRetry = false }
        pending = command; message = nil
        if command.action == "inspect" { state.send(.work(command)) }
        else { state.workActionHandler(command) }
    }
}

import Foundation

/// Presentation never supplies a mastery threshold or combines real work with rehearsal.
enum EducationPresentation {
    static func progress(_ skill: HormesEducationSkill, demo: Bool) -> HormesEducationProgress {
        demo ? skill.demo : skill.real
    }
    static func context(for practice: HormesEducationPractice, demo: Bool, work: HormesWorkState, inspectedId: String?) -> HormesSession? {
        let inspected = work.sessions.first { $0.id == inspectedId }
        let candidates = [inspected, work.active].compactMap { $0 } + work.sessions
        return candidates.first {
            $0.goalId == practice.goalId && $0.courseId == practice.courseId && $0.demo == demo &&
            ["study", "exam", "review"].contains($0.mode) && $0.classReview == nil
        }
    }
    static func practiceCommand(_ practice: HormesEducationPractice, demo: Bool, work: HormesWorkState, inspectedId: String?) -> HormesWorkCommand? {
        let origin = context(for: practice, demo: demo, work: work, inspectedId: inspectedId)
        guard !demo || origin != nil else { return nil }
        var command = HormesWorkCommand(action: "education.practice", sessionId: origin?.id)
        command.skillId = practice.skillId; command.goalId = practice.goalId; command.courseId = practice.courseId
        return command
    }
    static func bootstrappedPractice(skillId: String, work: HormesWorkState) -> HormesWorkCommand? {
        guard let origin = work.active, !origin.demo, origin.courseId == "microeconomics",
              let practice = work.education?.skills.first(where: { $0.id == skillId })?.real.nextPractice,
              practice.skillId == skillId, practice.goalId == origin.goalId,
              practice.courseId == origin.courseId else { return nil }
        var command = HormesWorkCommand(action: "education.practice", sessionId: origin.id)
        command.goalId = origin.goalId; command.courseId = origin.courseId; command.skillId = skillId
        return command
    }
    static func offersReturn(_ session: HormesSession, skillId: String) -> Bool {
        session.education?.skillId == skillId && session.education?.returnSessionId != nil &&
        ["foundation", "review"].contains(session.exercise?.kind ?? "")
    }
    static func stamp(_ at: Double) -> String {
        Date(timeIntervalSince1970: at / 1000).formatted(date: .abbreviated, time: .shortened)
    }
    static let learningModes = ["class", "study", "exam", "review"]
    static func sessions(for goal: HormesGoal, demo: Bool, work: HormesWorkState) -> [HormesSession] {
        let active = work.active.map { [$0] } ?? []
        var seen = Set<String>()
        return (active + work.sessions).filter {
            $0.goalId == goal.id && $0.demo == demo && learningModes.contains($0.mode) && seen.insert($0.id).inserted
        }
    }
    static func focusGoal(work: HormesWorkState, selectedId: String?, demo: Bool) -> HormesGoal? {
        let goals = work.goals.filter { $0.kind == "learning" && $0.state != "complete" }
        if let selected = goals.first(where: { $0.id == selectedId }) { return selected }
        let sessions = (work.active.map { [$0] } ?? []) + work.sessions
        for session in sessions where session.demo == demo && learningModes.contains(session.mode) {
            if let goal = goals.first(where: { $0.id == session.goalId }) { return goal }
        }
        return goals.first
    }
    static func continuation(for goal: HormesGoal, demo: Bool, work: HormesWorkState) -> HormesWorkCommand? {
        if let saved = sessions(for: goal, demo: demo, work: work).first {
            return HormesWorkCommand(action: "resume", sessionId: saved.id)
        }
        guard !demo else { return nil }
        var command = HormesWorkCommand(action: "start", mode: "study")
        command.goalId = goal.id; command.courseId = goal.courseId
        return command
    }
    static func evidence(_ skill: HormesEducationSkill, goalId: String?, demo: Bool) -> [HormesEducationEvidence] {
        progress(skill, demo: demo).evidence.filter { goalId == nil || $0.goalId == goalId }
    }
    static func suggestedSkills(goal: HormesGoal, demo: Bool, work: HormesWorkState) -> [HormesEducationSkill] {
        let candidates = (work.education?.skills ?? []).filter { progress($0, demo: demo).nextPractice?.goalId == goal.id }
        let order = ["exchange-income", "exchange-price", "exchange-allocation", "ratios", "linear-equations", "fractions"]
        return candidates.sorted { a, b in
            let aMiss = evidence(a, goalId: goal.id, demo: demo).last?.correct == false
            let bMiss = evidence(b, goalId: goal.id, demo: demo).last?.correct == false
            if aMiss != bMiss { return aMiss }
            return (order.firstIndex(of: a.id) ?? 100) < (order.firstIndex(of: b.id) ?? 100)
        }.prefix(3).map { $0 }
    }
    static func relevance(_ skill: HormesEducationSkill) -> String {
        switch skill.id {
        case "exchange-income": return "Connect what you own with what you can spend."
        case "exchange-price": return "Find a price that makes supply and demand agree."
        case "exchange-allocation": return "Work out what each person receives after trade."
        case "fractions": return "Make the fractional quantities in your calculations easier to handle."
        case "ratios": return "Understand relative prices and compare quantities."
        case "linear-equations": return "Solve the budget and market-clearing equations."
        default: return "Explore how this concept connects to your coursework."
        }
    }
    static func practiceSummary(_ evidence: [HormesEducationEvidence]) -> String {
        guard let last = evidence.last else { return "Try your first example" }
        if !last.correct { return "Try a fresh example" }
        return last.assistance == "independent" ? "Solved on your own" : "Try it on your own next"
    }
}

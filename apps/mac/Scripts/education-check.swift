import Foundation

public struct LedgerHit: Equatable {}

@main struct EducationChecks {
    static func main() throws {
        var checks = 0
        func check(_ value: Bool, _ label: String) {
            precondition(value, label); checks += 1; print("PASS: \(label)")
        }
        func goal(_ id: String = "economics", course: String = "microeconomics") -> HormesGoal {
            HormesGoal(id: id, title: "Understand exchange economies", kind: "learning", state: "in-progress", criteria: ["Try a fresh problem"], next: "Try again", version: 1, updatedAt: 1000, courseId: course)
        }
        func session(_ id: String, goalId: String = "economics", demo: Bool = false, mode: String = "study") -> HormesSession {
            HormesSession(id: id, goalId: goalId, mode: mode, title: "Saved problem", state: "paused", createdAt: 1000, updatedAt: 1000, next: "Continue the budget", version: 1, courseId: "microeconomics", demo: demo, sceneRevision: 3, sourceIds: [], artifactSourceIds: [])
        }
        var work = HormesWorkState.empty
        let economics = goal(), biology = goal("biology", course: "biology")
        work.goals = [economics, biology]
        work.sessions = [session("rehearsal", demo: true), session("real")]
        work.active = session("rehearsal", demo: true)
        check(EducationPresentation.focusGoal(work: work, selectedId: nil, demo: false)?.id == economics.id, "real learning finds a real saved goal despite an active rehearsal")
        check(EducationPresentation.focusGoal(work: work, selectedId: biology.id, demo: false)?.id == biology.id, "explicit goal selection overrides the active course")
        let resume = EducationPresentation.continuation(for: economics, demo: false, work: work)!
        check(resume.action == "resume" && resume.sessionId == "real", "Continue restores the saved real scene instead of starting a replacement")
        check(resume.goalId == nil && resume.text == nil, "resume supplies no new goal, answer or model instruction")
        let rehearsal = EducationPresentation.continuation(for: economics, demo: true, work: work)!
        check(rehearsal.sessionId == "rehearsal", "rehearsal continuation stays in rehearsal")
        let start = EducationPresentation.continuation(for: biology, demo: false, work: work)!
        check(start.action == "start" && start.goalId == biology.id && start.courseId == "biology", "new learning preserves a custom goal and its course")
        check(EducationPresentation.continuation(for: biology, demo: true, work: work) == nil, "a missing rehearsal cannot silently start real learning")
        work.active = session("real")
        check(EducationPresentation.sessions(for: economics, demo: false, work: work).map(\.id) == ["real"], "active and saved copies are deduplicated without mixing lanes")
        let practice = HormesEducationPractice(skillId: "ratios", goalId: economics.id, courseId: "microeconomics", label: "Practice ratios", reason: "Supports relative prices")
        work.active = nil
        let cmd = EducationPresentation.practiceCommand(practice, demo: false, work: work, inspectedId: nil)!
        check(cmd.sessionId == "real" && cmd.goalId == economics.id && cmd.skillId == "ratios", "practice retains the saved course context when the lesson is no longer active")
        var review = session("review", mode: "review")
        review.classReview = HormesClassReview(fromSessionId: "old", state: "ready", target: HormesClassTarget(title: "Next class", courseId: "microeconomics", courseTitle: "Economics"))
        work.sessions = [review]
        check(EducationPresentation.context(for: practice, demo: false, work: work, inspectedId: review.id) == nil, "unfinished next-class review is not a prerequisite practice origin")
        work.sessions = [session("wrong-goal", goalId: biology.id), session("only-demo", demo: true)]
        check(EducationPresentation.context(for: practice, demo: false, work: work, inspectedId: nil) == nil, "wrong goals and rehearsal cannot become real practice context")
        let record = HormesEducationEvidence(id: "e", sessionId: "real", goalId: economics.id, observationId: "o", exerciseId: "x", at: 2000, correct: false, assistance: "independent", criterion: "market-clearing-price", answer: "2", feedback: "Try another price", limitations: "A price check")
        let empty = HormesEducationProgress(status: "unassessed", independentCorrect: 0, independentAttempts: 0, assistedCorrect: 0, assistedAttempts: 0, evidence: [], nextPractice: practice)
        func skill(_ id: String, evidence: [HormesEducationEvidence] = [], mapped: Bool = true) -> HormesEducationSkill {
            var progress = empty; progress.evidence = evidence
            progress.nextPractice = mapped ? HormesEducationPractice(skillId: id, goalId: economics.id, courseId: "microeconomics", label: "Practice", reason: "Relevant") : nil
            return HormesEducationSkill(id: id, title: id, description: "A concept", stageId: "college", subjectId: "economics", prerequisiteIds: [], real: progress, demo: empty)
        }
        let price = skill("exchange-price", evidence: [record])
        work.education = HormesEducation(version: 1, limitation: "Curated concepts", stages: [], subjects: [], skills: [skill("functions", mapped: false), skill("exchange-income"), price, skill("exchange-allocation"), skill("fractions")], activeGoalIds: [economics.id])
        let suggested = EducationPresentation.suggestedSkills(goal: economics, demo: false, work: work)
        check(suggested.first?.id == "exchange-price" && suggested.count == 3, "next practice prioritizes an actual missed check and limits competing choices")
        check(!suggested.contains { $0.id == "functions" }, "an unavailable automatic exercise is not promoted as ready practice")
        check(EducationPresentation.suggestedSkills(goal: biology, demo: false, work: work).isEmpty, "custom courses never inherit economics recommendations")
        work.active = session("acknowledged-real")
        let bootstrapped = EducationPresentation.bootstrappedPractice(skillId: "exchange-price", work: work)
        check(bootstrapped?.sessionId == "acknowledged-real" && bootstrapped?.goalId == economics.id, "first practice binds to the acknowledged real lesson")
        work.active = session("acknowledged-demo", demo: true)
        check(EducationPresentation.bootstrappedPractice(skillId: "exchange-price", work: work) == nil, "rehearsal acknowledgement cannot bootstrap real practice")
        work.active = session("another-goal", goalId: biology.id)
        check(EducationPresentation.bootstrappedPractice(skillId: "exchange-price", work: work) == nil, "another goal cannot bootstrap the requested practice")
        work.active = session("wrong-course"); work.active?.courseId = "biology"
        check(EducationPresentation.bootstrappedPractice(skillId: "exchange-price", work: work) == nil, "a different course cannot bootstrap economics practice")
        work.active = session("no-exercise")
        check(EducationPresentation.bootstrappedPractice(skillId: "functions", work: work) == nil, "a concept without a supported exercise cannot bootstrap a score")
        check(EducationPresentation.evidence(price, goalId: biology.id, demo: false).isEmpty, "another goal's attempts cannot fill the displayed progress")
        check(EducationPresentation.evidence(price, goalId: economics.id, demo: true).isEmpty, "real answers never fill rehearsal progress")
        check(EducationPresentation.practiceSummary([record]) == "Try a fresh example", "a missed check offers an action without diagnosing a misconception")
        var helped = record; helped.correct = true; helped.assistance = "assisted"
        check(EducationPresentation.practiceSummary([helped]) == "Try it on your own next", "assisted success prompts independent practice")
        var independent = helped; independent.assistance = "independent"
        check(EducationPresentation.practiceSummary([independent]) == "Solved on your own", "success describes the example without claiming subject mastery")
        work.goals = [economics]; work.goals[0].state = "complete"
        check(EducationPresentation.focusGoal(work: work, selectedId: economics.id, demo: false) == nil, "completed goals do not become the current unfinished goal")
        let roundtrip = try JSONDecoder().decode(HormesWorkCommand.self, from: JSONEncoder().encode(start))
        check(roundtrip == start, "new primary action preserves protocol fields through encoding")
        print("\(checks) Education routing and presentation checks passed")
    }
}

import type { WorkEducation, WorkEducationEvidence, WorkEducationProgress, WorkEducationSkill, WorkEvidence, WorkGoal, WorkObservation, WorkSession } from "@hormes/protocol";

type SkillDefinition = Omit<WorkEducationSkill, "real" | "demo"> & { criterion?: string; exerciseKind?: "foundation" | "exchange" | "review" };
/** A deliberately small prerequisite map, not a prescribed or assessed curriculum. */
const SKILLS: readonly SkillDefinition[] = [
  { id: "fractions", title: "Fractions", description: "Divide fractions. A saved check assesses this operation only.", stageId: "grade-5", subjectId: "mathematics", prerequisiteIds: [], criterion: "fraction-division", exerciseKind: "foundation" },
  { id: "ratios", title: "Equivalent ratios", description: "Check a ratio’s numeric value; this does not assess lowest-term notation.", stageId: "middle-school", subjectId: "mathematics", prerequisiteIds: ["fractions"], criterion: "ratio-reduction", exerciseKind: "foundation" },
  { id: "linear-equations", title: "Linear equations", description: "Solve a one-variable linear equation.", stageId: "high-school", subjectId: "mathematics", prerequisiteIds: ["ratios"], criterion: "linear-equation", exerciseKind: "foundation" },
  { id: "functions", title: "Functions and graphs", description: "Connect variables, expressions and graphs. No supported assessment has been mapped yet.", stageId: "high-school", subjectId: "mathematics", prerequisiteIds: ["linear-equations"] },
  { id: "exchange-income", title: "Endowments and income", description: "Check income under the declared relative-price convention.", stageId: "college", subjectId: "economics", prerequisiteIds: ["ratios", "linear-equations"], criterion: "price-convention-recall", exerciseKind: "review" },
  { id: "exchange-price", title: "Market-clearing price", description: "Check the relative price in the supported exchange-economy exercise family.", stageId: "college", subjectId: "economics", prerequisiteIds: ["exchange-income"], criterion: "market-clearing-price", exerciseKind: "exchange" },
  { id: "exchange-allocation", title: "Market-clearing allocations", description: "Check both consumers' allocations against their budgets and total supply.", stageId: "college", subjectId: "economics", prerequisiteIds: ["exchange-price"], criterion: "market-clearing-allocation", exerciseKind: "exchange" },
];

export interface EducationInput {
  goals: readonly WorkGoal[];
  sessions: readonly WorkSession[];
  observations: readonly WorkObservation[];
  /** Durable insertion order, not wall-clock order or sorted correctness. */
  evidence: readonly WorkEvidence[];
  /** Eligibility comes from the store's existing application-owned verifier rule. */
  practiceGoalIds: readonly string[];
}

/** Pure projection. It does not write progress, infer past grades, or complete goals. */
export function deriveEducation(input: EducationInput): WorkEducation {
  const goals = new Map(input.goals.map(g => [g.id, g]));
  const sessions = new Map(input.sessions.map(s => [s.id, s]));
  const observations = new Map(input.observations.map(o => [o.id, o]));
  const excluded = new Set(input.evidence.filter(e => e.invalidated).map(e => e.observationId));
  const eligibleGoals = input.practiceGoalIds.filter(id => {
    const goal = goals.get(id);
    return goal?.kind === "learning" && goal.courseId === "microeconomics";
  });
  const progress = (skill: SkillDefinition, demo: boolean): WorkEducationProgress => {
    const seen = new Set<string>();
    const evidence: WorkEducationEvidence[] = [];
    for (const e of input.evidence) {
      const s = sessions.get(e.sessionId), o = observations.get(e.observationId), g = goals.get(e.goalId);
      const courseMatches = s?.courseId === "microeconomics" || (!s?.courseId && s?.sourceIds.includes("course_exchange"));
      if (!skill.criterion || e.criterion !== skill.criterion || e.invalidated || excluded.has(e.observationId) || e.method !== "reference-check" ||
          g?.kind !== "learning" || (g.courseId !== undefined && g.courseId !== "microeconomics") ||
          !s || s.demo !== demo || s.goalId !== e.goalId || !courseMatches || !["study", "exam", "review"].includes(s.mode) ||
          s.exercise?.id !== e.exerciseId || s.exercise.kind !== skill.exerciseKind ||
          (skill.exerciseKind === "foundation" && s.education?.skillId !== skill.id) ||
          !o || o.actor !== "student" || o.kind !== "answer" || o.sessionId !== s.id || o.goalId !== e.goalId || o.exerciseId !== e.exerciseId) continue;
      // A numeric answer can have one price and one allocation row. Each skill
      // counts that underlying answer once, even if a duplicate row was saved.
      const key = `${e.observationId}:${e.criterion}`;
      if (seen.has(key)) continue;
      seen.add(key);
      evidence.push({ id: e.id, sessionId: e.sessionId, goalId: e.goalId, observationId: e.observationId, exerciseId: e.exerciseId, at: e.at,
        correct: e.correct, assistance: e.assistance, criterion: e.criterion, answer: e.answer, feedback: e.feedback, limitations: e.limitations });
    }
    const independent = evidence.filter(e => e.assistance === "independent");
    const assisted = evidence.filter(e => e.assistance === "assisted");
    const last = evidence.at(-1);
    const goalId = evidence.findLast(e => eligibleGoals.includes(e.goalId))?.goalId ?? eligibleGoals[0];
    const reason = last
      ? last.correct
        ? last.assistance === "assisted"
          ? "The last recorded check used help. Try a fresh problem independently; this does not erase the assisted attempt."
          : "A recorded independent check passed. Try a fresh problem to collect more evidence; broader mastery remains unassessed."
        : "The last recorded answer failed this specific check. Revisit it with a fresh problem; the cause has not been diagnosed."
      : "No supported attempt is recorded for this skill. Check it explicitly; a later skill does not establish its prerequisites.";
    return {
      status: !last ? "unassessed" : last.correct && last.assistance === "independent" ? "independent-checks" : "practicing",
      independentCorrect: independent.filter(e => e.correct).length, independentAttempts: independent.length,
      assistedCorrect: assisted.filter(e => e.correct).length, assistedAttempts: assisted.length, evidence,
      ...(skill.criterion && goalId ? { nextPractice: { skillId: skill.id, goalId, courseId: "microeconomics", label: `${last ? "Practice" : "Check"} ${skill.title.toLowerCase()}`, reason: reason + (demo ? " This is rehearsal evidence, separate from real learning." : "") } } : {}),
    };
  };
  return {
    version: 1,
    limitation: "A small curated prerequisite map, not an official grade-by-grade curriculum or your personal school history. Stage labels organize concepts; earlier schooling is unassessed. Only linked, valid student attempts count. Checks assess the named operation, not broad mastery. Demo work is separate. Unmapped quizzes, recall and open-ended work remain in saved sessions.",
    stages: [
      { id: "grade-5", title: "Grade 5 foundations", description: "An entry point for foundational mathematics, not a claim about when you learned it." },
      { id: "middle-school", title: "Middle school", description: "A suggested conceptual progression; curricula vary." },
      { id: "high-school", title: "High school", description: "Algebraic tools that support later work; no past attainment is assumed." },
      { id: "college", title: "College", description: "The supported Intermediate Microeconomics exercise family." },
      { id: "today", title: "Today", description: "Your saved open learning goals and the next supported practice." },
    ],
    subjects: [{ id: "mathematics", title: "Mathematics" }, { id: "economics", title: "Economics" }],
    skills: SKILLS.map(definition => {
      const { criterion: _criterion, exerciseKind: _kind, ...skill } = definition;
      return { ...skill, prerequisiteIds: [...skill.prerequisiteIds], real: progress(definition, false), demo: progress(definition, true) };
    }),
    activeGoalIds: input.goals.filter(g => g.kind === "learning" && g.state === "in-progress").map(g => g.id),
  };
}

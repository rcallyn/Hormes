import type { WorkEvidence, WorkObservation, WorkSession } from "@hormes/protocol";

type Target = "market-clearing-price" | "market-clearing-allocation";
type Parameters = { a: [number, number]; b: [number, number] };
export interface ExchangePracticeSelection {
  policy: "exchange-practice-v1";
  target: Target | "mixed";
  demo: boolean;
  reason: string;
  evidenceIds: string[];
  observationIds: string[];
  sessionIds: string[];
  questionLines: string[];
}
export interface ExchangePracticeInput {
  goalId: string;
  courseId: string;
  demo: boolean;
  ordinal: number;
  sessions: readonly WorkSession[];
  observations: readonly WorkObservation[];
  /** Durable insertion order (WorkStore records.rowid), never wall-clock order. */
  evidence: readonly WorkEvidence[];
  previousExercises: readonly (Parameters & { id: string; kind: "exchange" | "review" })[];
}

const targetOf = (criterion: string): Target | undefined => {
  // Income recall needs a fresh income-recall question and its own check. An
  // equilibrium-price success cannot establish that different criterion.
  if (criterion === "market-clearing-price") return "market-clearing-price";
  if (criterion === "market-clearing-allocation") return "market-clearing-allocation";
  return undefined;
};
const parameterKey = ({ a, b }: Parameters): string => JSON.stringify([a, b]);

/** Select practice, never grade or infer a misconception from activity/silence.
 * The caller persists the receipt with the new private exercise and a tool
 * observation. Only questions and cited record IDs leave this helper, no answers.
 */
export function selectExchangePractice(input: ExchangePracticeInput): Parameters & { selection: ExchangePracticeSelection } {
  if (!Number.isSafeInteger(input.ordinal) || input.ordinal < 0) throw new Error("Practice ordinal must be a nonnegative safe integer.");
  if (input.courseId !== "microeconomics") throw new Error("Exchange practice requires the Microeconomics course.");
  const sessions = new Map(input.sessions.map(s => [s.id, s]));
  const observations = new Map(input.observations.map(o => [o.id, o]));
  const exercises = new Map(input.previousExercises.map(e => [e.id, e]));
  const checked = input.evidence.map(evidence => ({ evidence })).filter(({ evidence: e }) => {
    const session = sessions.get(e.sessionId), observation = observations.get(e.observationId);
    // Retain legacy course association only when its saved source identifies it.
    const courseMatches = session?.courseId === input.courseId || (!session?.courseId && session?.sourceIds.includes("course_exchange"));
    return !e.invalidated && e.method === "reference-check" && targetOf(e.criterion) !== undefined &&
      e.goalId === input.goalId && session?.goalId === input.goalId && session.demo === input.demo && courseMatches &&
      ["study", "exam", "review"].includes(session.mode) && session.exercise?.id === e.exerciseId &&
      observation?.sessionId === e.sessionId && observation.goalId === e.goalId && observation.exerciseId === e.exerciseId &&
      observation.kind === "answer" && observation.actor === "student";
  });
  // The database preserves insertion order across revisions/restarts. `at` is
  // a display timestamp and may move backward after a system-clock correction.

  // A correction to the same exercise, or one reached with help, does not
  // demonstrate independent transfer. A later different exercise can retire
  // this target only for the exact checked criterion. Withdrawn rows were
  // removed above, so excluding a later success makes the earlier gap eligible.
  const unresolved = checked.filter(({ evidence: failure }, index) => !failure.correct && !checked.slice(index + 1).some(({ evidence: success }) => {
    const before = exercises.get(failure.exerciseId), after = exercises.get(success.exerciseId);
    return success.correct && success.assistance === "independent" && success.criterion === failure.criterion && success.exerciseId !== failure.exerciseId &&
      before && after && before.kind === after.kind && parameterKey(before) !== parameterKey(after);
  }));
  let selected = unresolved.at(-1)?.evidence;
  if (selected?.criterion === "market-clearing-allocation") {
    // When one submission missed both checks, start with price. Do not diagnose
    // an allocation misconception from quantities derived from a wrong price.
    selected = unresolved.findLast(({ evidence }) => evidence.observationId === selected!.observationId && targetOf(evidence.criterion) === "market-clearing-price")?.evidence ?? selected;
  }
  const target = selected ? targetOf(selected.criterion)! : "mixed";
  const questionLines = target === "market-clearing-price"
    ? ["Find the market-clearing p first.", "Then find A's and B's allocations."]
    : target === "market-clearing-allocation"
      ? ["Find p and each consumer's (x, y).", "Give both A's and B's allocations."]
      : ["Find p and both market-clearing allocations."];
  const label = target === "market-clearing-price" ? "market-clearing price" : "market-clearing allocation";
  const reason = selected
    ? `Fresh independent practice targets ${label}: a recorded student answer failed that reference check, with no later independent success on a different exercise for that criterion. This selects practice; it does not diagnose the cause or establish mastery.${input.demo ? " Hypothetical-day rehearsal only." : ""}`
    : `Fresh mixed practice: no unresolved supported reference-check failure in this goal and ${input.demo ? "demo" : "real"} context. Absence of a recorded failure is not evidence of mastery.`;

  const used = new Set(input.previousExercises.filter(e => e.kind === "exchange").map(parameterKey));
  let ordinal = input.ordinal, parameters: Parameters;
  do {
    // Two narrow authored variants exercise the same independently checked
    // price/allocation contract. Targeting changes the actual problem and its
    // question order, while keeping reference answers private in the grader.
    parameters = target === "market-clearing-price"
      ? { a: [2 + ordinal, 1], b: [1, 6 + ordinal] }
      : target === "market-clearing-allocation"
        ? { a: [5 + ordinal, 1], b: [1, 2 + ordinal] }
        : { a: [4 + ordinal, 1], b: [2, 2 + ordinal] };
    if (parameters.a.some(n => !Number.isSafeInteger(n)) || parameters.b.some(n => !Number.isSafeInteger(n))) throw new Error("Practice parameters exceed the supported numeric range.");
    ordinal++;
  } while (used.has(parameterKey(parameters)));

  return { ...parameters, selection: {
    policy: "exchange-practice-v1", target, demo: input.demo, reason,
    evidenceIds: selected ? [selected.id] : [], observationIds: selected ? [selected.observationId] : [], sessionIds: selected ? [selected.sessionId] : [], questionLines,
  } };
}

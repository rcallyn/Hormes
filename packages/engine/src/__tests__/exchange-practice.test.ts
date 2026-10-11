import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { WorkCommand, WorkEvidence, WorkObservation, WorkSession } from "@hormes/protocol";
import { selectExchangePractice, type ExchangePracticeInput, type ExchangePracticeSelection } from "../work/exchange-practice.ts";
import { WorkStore, exchangeAnswer } from "../work/store.ts";

function history(): ExchangePracticeInput {
  return { goalId: "learning", courseId: "microeconomics", demo: false, ordinal: 0, sessions: [], observations: [], evidence: [], previousExercises: [] };
}
function attempt(input: ExchangePracticeInput, key: string, options: Partial<WorkEvidence> = {}, parameters = { a: [2, 1] as [number, number], b: [1, 5] as [number, number] }) {
  const at = input.evidence.length + 1, exerciseId = options.exerciseId ?? `exercise_${key}`;
  const session: WorkSession = {
    id: `session_${key}`, goalId: input.goalId, courseId: input.courseId, mode: "exam", demo: input.demo, state: "paused", title: key,
    createdAt: at, updatedAt: at, next: "Try again", version: 1, sceneRevision: 0, sourceIds: ["course_exchange"], artifactSourceIds: [],
    exercise: { id: exerciseId, title: "Exchange economy", kind: "exchange", prompt: "Find p and allocations", sourceId: "course_exchange", independent: true },
  };
  const observation: WorkObservation = { id: `observation_${key}`, goalId: input.goalId, sessionId: session.id, exerciseId, at, actor: "student", kind: "answer", input: "voice", utteranceId: key, text: "The price is nine" };
  const evidence: WorkEvidence = {
    id: `evidence_${key}`, goalId: input.goalId, sessionId: session.id, exerciseId, observationId: observation.id, at,
    criterion: "market-clearing-price", correct: false, assistance: "independent", method: "reference-check", answer: "PRIVATE_SUBMITTED_VALUE", feedback: "PRIVATE_GRADER_FEEDBACK", limitations: "Numeric criterion only", ...options,
  };
  input.sessions = [...input.sessions, session]; input.observations = [...input.observations, observation]; input.evidence = [...input.evidence, evidence];
  if (!input.previousExercises.some(e => e.id === exerciseId)) input.previousExercises = [...input.previousExercises, { id: exerciseId, kind: "exchange", ...parameters }];
  return { session, observation, evidence };
}

test("without a checked mistake, a fresh mixed problem preserves the existing first exam", () => {
  const input = history();
  input.observations = [{ id: "silent_or_busy", sessionId: "unknown", goalId: input.goalId, at: 1, kind: "question", actor: "student", text: "I paused a video about allocations" }];
  const selected = selectExchangePractice(input);
  assert.deepEqual([selected.a, selected.b], [[4, 1], [2, 2]]);
  assert.equal(selected.selection.target, "mixed");
  assert.deepEqual(selected.selection.evidenceIds, []);
  assert.match(selected.selection.reason, /not evidence of mastery/);
});

test("a price mistake selects a different problem with exact provenance and no answer leakage", () => {
  const input = history(), wrong = attempt(input, "price");
  const before = JSON.stringify(input), selected = selectExchangePractice(input);
  assert.equal(selected.selection.target, "market-clearing-price");
  assert.deepEqual(selected.selection.evidenceIds, [wrong.evidence.id]);
  assert.deepEqual(selected.selection.observationIds, [wrong.observation.id]);
  assert.deepEqual(selected.selection.sessionIds, [wrong.session.id]);
  assert.notDeepEqual([selected.a, selected.b], [[4, 1], [2, 2]], "the target changes the actual exercise");
  assert.match(selected.selection.questionLines.join(" "), /p first/);
  assert.doesNotMatch(JSON.stringify(selected), /PRIVATE_|misconception|p\s*=\s*\d|x\s*=\s*\d/);
  assert.match(selected.selection.reason, /does not diagnose/);
  assert.equal(JSON.stringify(input), before, "selection does not rewrite evidence or completion state");
});

test("a correct price with explicitly wrong allocations targets allocations; two failed checks start with price", () => {
  const input = history(), answer = attempt(input, "both", { correct: true });
  const allocation = { ...answer.evidence, id: "allocation_check", criterion: "market-clearing-allocation", correct: false };
  input.evidence = [...input.evidence, allocation];
  let selected = selectExchangePractice(input);
  assert.equal(selected.selection.target, "market-clearing-allocation");
  assert.deepEqual(selected.selection.evidenceIds, [allocation.id]);
  assert.match(selected.selection.questionLines.join(" "), /both A's and B's allocations/);
  assert.notDeepEqual([selected.a, selected.b], [[4, 1], [2, 2]]);
  answer.evidence.correct = false;
  selected = selectExchangePractice(input);
  assert.equal(selected.selection.target, "market-clearing-price");
  assert.deepEqual(selected.selection.evidenceIds, [answer.evidence.id]);
});

test("durable attempt order wins when the wall clock moves backward", () => {
  const input = history();
  attempt(input, "earlier_success", { correct: true, at: 20_000 });
  const laterFailure = attempt(input, "later_failure", { correct: false, at: 10_000 }, { a: [4, 1], b: [2, 2] });
  assert.deepEqual(selectExchangePractice(input).selection.evidenceIds, [laterFailure.evidence.id], "an earlier success cannot retire a later recorded failure after clock rollback");
  attempt(input, "latest_success", { correct: true, at: 5_000 }, { a: [5, 1], b: [2, 3] });
  assert.equal(selectExchangePractice(input).selection.target, "mixed", "a later durable independent success can retire the exact criterion even with an earlier timestamp");
});

test("income-recall failures are retained but cannot select an exchange-only follow-up", () => {
  const input = history(), recall = attempt(input, "income", { criterion: "price-convention-recall" });
  const before = JSON.stringify(input.evidence);
  const selection = selectExchangePractice(input).selection;
  assert.equal(selection.target, "mixed", "this selector cannot generate a fresh income-recall check");
  assert.deepEqual(selection.evidenceIds, []);
  assert.equal(JSON.stringify(input.evidence), before, "unsupported recall evidence remains available for a suitable future exercise");
  assert.equal(recall.evidence.correct, false);
});

test("an assisted correction remains eligible until a fresh independent success, and invalidation restores the target", () => {
  const input = history(), wrong = attempt(input, "wrong");
  attempt(input, "same_problem", { correct: true }, { a: [2, 1], b: [1, 5] });
  attempt(input, "assisted", { correct: true, assistance: "assisted" }, { a: [4, 1], b: [2, 2] });
  assert.equal(selectExchangePractice(input).selection.target, "market-clearing-price");
  const independent = attempt(input, "independent", { correct: true }, { a: [5, 1], b: [2, 3] });
  assert.equal(selectExchangePractice(input).selection.target, "mixed");
  independent.evidence.invalidated = { at: 100, reason: "The answer was misheard" };
  assert.deepEqual(selectExchangePractice(input).selection.evidenceIds, [wrong.evidence.id]);
  wrong.evidence.invalidated = { at: 101, reason: "The original mistake was misheard too" };
  assert.equal(selectExchangePractice(input).selection.target, "mixed");
});

test("real and hypothetical-day lanes never select or clear each other's mistakes", () => {
  const input = history(), real = attempt(input, "real_wrong");
  input.demo = true;
  const synthetic = attempt(input, "demo_wrong", { criterion: "market-clearing-allocation", assistance: "assisted" });
  assert.deepEqual(selectExchangePractice(input).selection.evidenceIds, [synthetic.evidence.id]);
  assert.equal(selectExchangePractice(input).selection.demo, true);
  assert.match(selectExchangePractice(input).selection.reason, /rehearsal only/);
  attempt(input, "demo_correct", { correct: true }, { a: [4, 1], b: [2, 2] });
  input.demo = false;
  assert.deepEqual(selectExchangePractice(input).selection.evidenceIds, [real.evidence.id], "demo success cannot retire a real mistake");
  real.evidence.invalidated = { at: 10, reason: "Withdrawn" };
  assert.equal(selectExchangePractice(input).selection.target, "mixed", "demo mistakes cannot affect real practice");
});

test("unsupported, orphaned, other-course, other-goal and assistant-generated claims are not learning targets", () => {
  const cases: Array<(row: ReturnType<typeof attempt>) => void> = [
    row => { row.evidence.invalidated = { at: 2, reason: "Withdrawn" }; },
    row => { row.session.courseId = "physics"; },
    row => { row.session.goalId = "another_goal"; },
    row => { row.evidence.goalId = "another_goal"; },
    row => { row.observation.goalId = "another_goal"; },
    row => { row.observation.actor = "assistant"; },
    row => { row.observation.kind = "tutor"; },
    row => { row.observation.exerciseId = "another_exercise"; },
    row => { row.evidence.observationId = "missing"; },
    row => { row.evidence.sessionId = "missing"; },
    row => { row.session.mode = "meeting"; },
    row => { row.evidence.criterion = "semantic_guess"; },
  ];
  for (const mutate of cases) {
    const input = history(); mutate(attempt(input, "untrusted"));
    assert.equal(selectExchangePractice(input).selection.target, "mixed");
  }
});

test("only the exact criterion is cleared, and the latest remaining checked failure drives the next problem", () => {
  const input = history();
  attempt(input, "price");
  const allocation = attempt(input, "allocation", { criterion: "market-clearing-allocation" });
  attempt(input, "fresh_price", { correct: true }, { a: [4, 1], b: [2, 2] });
  assert.deepEqual(selectExchangePractice(input).selection.evidenceIds, [allocation.evidence.id]);
  attempt(input, "fresh_allocation", { criterion: "market-clearing-allocation", correct: true }, { a: [5, 1], b: [2, 3] });
  assert.equal(selectExchangePractice(input).selection.target, "mixed");
  assert.deepEqual(selectExchangePractice(input).selection.evidenceIds, []);
});

test("freshness compares saved parameters, not exercise IDs, and missing specs cannot prove transfer", () => {
  const input = history(), wrong = attempt(input, "wrong");
  attempt(input, "new_id_same_parameters", { correct: true });
  const newProblem = attempt(input, "new_parameters", { correct: true }, { a: [4, 1], b: [2, 2] });
  input.previousExercises = input.previousExercises.filter(e => e.id !== newProblem.evidence.exerciseId);
  assert.deepEqual(selectExchangePractice(input).selection.evidenceIds, [wrong.evidence.id]);
});

test("new parameters avoid every already-used exchange problem deterministically", () => {
  for (const target of ["mixed", "market-clearing-price", "market-clearing-allocation"] as const) {
    const input = history();
    if (target !== "mixed") attempt(input, "wrong", { criterion: target });
    const first = selectExchangePractice(input);
    input.previousExercises = [...input.previousExercises, { id: "first", kind: "exchange", a: first.a, b: first.b }];
    const second = selectExchangePractice(input);
    assert.notDeepEqual([second.a, second.b], [first.a, first.b]);
    assert.deepEqual(selectExchangePractice(input), second);
    assert.equal(second.selection.target, target);
  }
  assert.throws(() => selectExchangePractice({ ...history(), ordinal: -1 }), /ordinal/);
  assert.throws(() => selectExchangePractice({ ...history(), ordinal: Number.MAX_SAFE_INTEGER }), /numeric range/);
  assert.throws(() => selectExchangePractice({ ...history(), courseId: "physics" }), /Microeconomics/);
});

test("actual spoken mistake, delivered hint, corrected answer and saved invalidation survive reopen without fabricated mastery", t => {
  const dir = mkdtempSync(join(tmpdir(), "hormes-targeted-practice-"));
  const store = new WorkStore(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const send = (command: Omit<WorkCommand, "requestId">) => store.command({ ...command, requestId: randomUUID() });
  const select = () => {
    const state = store.state(), active = state.active!;
    const db = new DatabaseSync(join(dir, "work", "work.sqlite"), { readOnly: true });
    try {
      const previousExercises = db.prepare("SELECT value FROM records WHERE kind='exercise'").all().map(row => JSON.parse(String(row.value))) as ExchangePracticeInput["previousExercises"];
      return selectExchangePractice({ goalId: active.goalId, courseId: active.courseId!, demo: active.demo, ordinal: state.sessions.filter(s => s.mode === "exam").length, sessions: state.sessions, observations: state.observations, evidence: state.evidence, previousExercises });
    } finally { db.close(); }
  };
  send({ action: "start", mode: "study" });
  const scope = store.scope()!;
  store.voice(scope, "wrong", "The price is nine");
  const wrong = store.state().evidence[0]!;
  store.recordSpeech(scope, "Try checking the budget at the stated price convention.");
  store.voice(scope, "corrected", "The price is one half");
  assert.equal(store.state().evidence.at(-1)!.correct, true);
  assert.equal(store.state().evidence.at(-1)!.assistance, "assisted");
  const before = select();
  assert.deepEqual(before.selection.evidenceIds, [wrong.id]);
  assert.equal(store.state().goals[0]!.state, "in-progress");
  store.close();
  assert.deepEqual(select(), before, "selection follows persisted evidence after restart");
  send({ action: "evidence.invalidate", sessionId: scope.sessionId, evidenceId: wrong.id, text: "The original spoken number was transcribed incorrectly." });
  store.close();
  assert.equal(select().selection.target, "mixed");
  assert.equal(store.state().goals[0]!.state, "in-progress");
});

test("exam start writes a targeted problem, accepts a fresh independent spoken attempt and preserves its selection on reopen", t => {
  const dir = mkdtempSync(join(tmpdir(), "hormes-targeted-exam-")), store = new WorkStore(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const send = (command: Omit<WorkCommand, "requestId">) => store.command({ ...command, requestId: randomUUID() });
  const selection = (): ExchangePracticeSelection => JSON.parse(store.state().observations.findLast(o => o.sessionId === store.state().active!.id && o.actor === "tool" && o.text.startsWith('{"practiceSelection":'))!.text).practiceSelection;
  send({ action: "start", mode: "study" });
  const earlier = store.scope()!;
  store.voice(earlier, "wrong", "The price is nine");
  const failure = store.state().evidence[0]!;
  store.recordSpeech(earlier, "Check which good the price ratio refers to.");
  store.voice(earlier, "corrected", "The price is one half");
  send({ action: "start", mode: "exam" });
  const exam = store.state().active!, scope = store.scope()!, receipt = selection();
  assert.equal(receipt.target, "market-clearing-price");
  assert.deepEqual(receipt.evidenceIds, [failure.id]);
  assert.deepEqual(receipt.observationIds, [failure.observationId]);
  assert.equal(exam.exercise!.independent, true);
  assert.match(exam.exercise!.prompt, /A owns \(2, 1\); B owns \(1, 6\)/);
  assert.match(exam.exercise!.prompt, /Find the market-clearing p first/);
  send({ action: "lesson.prepare" });
  const problem = store.state().active!.pendingPlan!;
  const lines = JSON.parse(problem.json).operations.map((op: { type: string; text: string }) => { assert.equal(op.type, "write"); return op.text; });
  assert.deepEqual(lines.slice(-receipt.questionLines.length), receipt.questionLines, "the actual handwritten question follows the selected target");
  assert.equal(problem.purpose, "problem");
  const answer = exchangeAnswer([2, 1], [1, 6]);
  assert.equal(store.context(scope).includes(String(answer.price)), false, "the independent voice context does not contain the fresh reference answer");
  send({ action: "board.applied", planId: problem.id, success: true });
  assert.equal(store.state().observations.some(o => o.sessionId === exam.id && o.kind === "hint"), false);
  const [ax, ay, bx, by] = answer.allocation;
  store.voice(scope, "fresh_independent", `The price is ${answer.price}. A gets ${ax} of x and ${ay} of y. B gets ${bx} of x and ${by} of y.`);
  const checked = store.state().evidence.filter(e => e.sessionId === exam.id);
  assert.equal(checked.length, 2);
  assert.ok(checked.every(e => e.correct && e.assistance === "independent" && !e.invalidated));
  assert.equal(store.state().goals[0]!.state, "in-progress", "one transfer attempt does not establish the entire goal");
  const saved = store.state(); store.close();
  assert.deepEqual(store.state().active, saved.active);
  assert.deepEqual(store.state().evidence, saved.evidence);
  assert.deepEqual(selection(), receipt);
  const db = new DatabaseSync(join(dir, "work", "work.sqlite"), { readOnly: true });
  try {
    const spec = JSON.parse(String(db.prepare("SELECT value FROM records WHERE kind='exercise' AND id=?").get(exam.exercise!.id)!.value));
    assert.deepEqual(spec.selection, receipt, "private exercise and public audit describe the same saved decision");
  } finally { db.close(); }
  send({ action: "start", mode: "exam" });
  assert.equal(selection().target, "mixed", "supported independent transfer retires this specific price target");
  send({ action: "evidence.invalidate", sessionId: exam.id, evidenceId: checked[0]!.id, text: "This answer was transcribed incorrectly." });
  send({ action: "start", mode: "exam" });
  assert.deepEqual(selection().evidenceIds, [failure.id], "a withdrawn success cannot keep the old target cleared");
});

test("a hypothetical-day mistake carries into targeted ink while real exams keep an isolated history", t => {
  const dir = mkdtempSync(join(tmpdir(), "hormes-targeted-demo-")), store = new WorkStore(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const send = (command: Omit<WorkCommand, "requestId">) => store.command({ ...command, requestId: randomUUID() });
  send({ action: "demo", blockId: "study" });
  send({ action: "submit", text: "0.5;9,9,9,9" });
  const wrong = store.state().evidence.find(e => !e.correct)!;
  send({ action: "demo", blockId: "exam" });
  let exam = store.state().active!;
  assert.equal(exam.demo, true);
  assert.match(exam.exercise!.prompt, /both A's and B's allocations/);
  send({ action: "lesson.prepare" });
  assert.match(store.state().active!.pendingPlan!.json, /both A's and B's allocations/);
  const audit = store.state().observations.findLast(o => o.sessionId === exam.id && o.text.startsWith('{"practiceSelection":'))!;
  const selected = JSON.parse(audit.text).practiceSelection as ExchangePracticeSelection;
  assert.equal(selected.demo, true);
  assert.deepEqual(selected.evidenceIds, [wrong.id]);
  const answer = exchangeAnswer([5, 1], [1, 2]);
  send({ action: "submit", text: `${answer.price};${answer.allocation.join(",")}` });
  assert.ok(store.state().evidence.filter(e => e.sessionId === exam.id).every(e => e.correct && e.limitations.includes("excluded from goal completion")));
  assert.equal(store.state().goals[0]!.state, "in-progress");
  send({ action: "start", mode: "exam" }); exam = store.state().active!;
  const realSelection = JSON.parse(store.state().observations.findLast(o => o.sessionId === exam.id && o.text.startsWith('{"practiceSelection":'))!.text).practiceSelection as ExchangePracticeSelection;
  assert.equal(realSelection.target, "mixed");
  assert.deepEqual(realSelection.evidenceIds, []);
  assert.equal(realSelection.demo, false);
});

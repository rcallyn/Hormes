import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { WorkCommand, WorkEvidence, WorkGoal, WorkObservation, WorkSession } from "@hormes/protocol";
import { deriveEducation, type EducationInput } from "../work/education.ts";
import { WorkStore, exchangeAnswer } from "../work/store.ts";

function fixture(): EducationInput {
  const goal: WorkGoal = { id: "goal", kind: "learning", courseId: "microeconomics", title: "Exchange", criteria: ["Supported check"], state: "in-progress", version: 1, updatedAt: 1, next: "Continue" };
  return { goals: [goal], sessions: [], observations: [], evidence: [], practiceGoalIds: [goal.id] };
}
function addAttempt(input: EducationInput, overrides: { id?: string; correct?: boolean; assistance?: WorkEvidence["assistance"]; demo?: boolean; at?: number; criterion?: string; skillId?: string } = {}): void {
  const id = overrides.id ?? `attempt${input.evidence.length}`;
  const criterion = overrides.criterion ?? "market-clearing-price";
  const kind = overrides.skillId ? "foundation" : criterion === "price-convention-recall" ? "review" : "exchange";
  const s: WorkSession = { id: `session_${id}`, goalId: "goal", mode: "exam", title: "Saved practice", state: "paused", createdAt: 1, updatedAt: 1, next: "Continue", version: 1, demo: overrides.demo ?? false, courseId: "microeconomics", sceneRevision: 0, sourceIds: ["course_exchange"], artifactSourceIds: [], exercise: { id: `exercise_${id}`, kind, title: "Problem", prompt: "Supplied problem", independent: true, sourceId: "course_exchange" }, ...(overrides.skillId ? { education: { skillId: overrides.skillId } } : {}) };
  const o: WorkObservation = { id: `observation_${id}`, sessionId: s.id, goalId: s.goalId, exerciseId: s.exercise!.id, at: overrides.at ?? 100, kind: "answer", actor: "student", text: "2" };
  const e: WorkEvidence = { id, sessionId: s.id, goalId: s.goalId, exerciseId: s.exercise!.id, observationId: o.id, at: o.at, criterion, correct: overrides.correct ?? true, assistance: overrides.assistance ?? "independent", method: "reference-check", answer: "2", feedback: "Numeric check", limitations: "This checks one numeric criterion only." };
  input.sessions = [...input.sessions, s]; input.observations = [...input.observations, o]; input.evidence = [...input.evidence, e];
}
const skill = (input: EducationInput, id = "exchange-price") => deriveEducation(input).skills.find(s => s.id === id)!;

test("empty Education map is a curated progression, never fabricated school history", () => {
  const input = fixture(); const before = JSON.stringify(input); const map = deriveEducation(input);
  assert.deepEqual(map.stages.map(s => s.id), ["grade-5", "middle-school", "high-school", "college", "today"]);
  assert.deepEqual(map.activeGoalIds, ["goal"]);
  assert.match(map.limitation, /not an official.*personal school history/);
  for (const s of map.skills) {
    assert.equal(s.real.status, "unassessed"); assert.equal(s.demo.status, "unassessed");
    assert.equal(s.real.independentAttempts + s.real.assistedAttempts, 0);
    assert.deepEqual(s.real.evidence, []);
  }
  assert.equal(skill(input, "fractions").real.nextPractice?.goalId, "goal");
  assert.match(skill(input, "fractions").real.nextPractice!.reason, /No supported attempt/);
  assert.equal(skill(input, "functions").real.nextPractice, undefined);
  assert.equal(JSON.stringify(input), before, "projection must not change original records");
});

test("valid independent and assisted attempts are distinct and linked without inferring prerequisites", () => {
  const input = fixture(); addAttempt(input, { correct: false }); addAttempt(input, { assistance: "assisted" });
  const p = skill(input).real;
  assert.equal(p.independentAttempts, 1); assert.equal(p.independentCorrect, 0);
  assert.equal(p.assistedAttempts, 1); assert.equal(p.assistedCorrect, 1); assert.equal(p.status, "practicing");
  assert.equal(p.evidence[0]!.observationId, input.observations[0]!.id);
  assert.equal(p.evidence[1]!.sessionId, input.sessions[1]!.id);
  assert.match(p.nextPractice!.reason, /used help/);
  for (const id of ["fractions", "ratios", "linear-equations", "exchange-income", "exchange-allocation"]) assert.equal(skill(input, id).real.status, "unassessed");
  addAttempt(input); assert.equal(skill(input).real.status, "independent-checks");
  assert.match(skill(input).real.nextPractice!.reason, /broader mastery remains unassessed/);
});

test("rehearsal results never raise real progress or supply real practice rationale", () => {
  const input = fixture(); addAttempt(input, { demo: true, correct: false }); addAttempt(input, { demo: true });
  const s = skill(input);
  assert.equal(s.real.independentAttempts, 0); assert.equal(s.real.status, "unassessed");
  assert.equal(s.demo.independentAttempts, 2); assert.equal(s.demo.independentCorrect, 1);
  assert.deepEqual(s.real.evidence, []); assert.match(s.real.nextPractice!.reason, /No supported attempt/);
  assert.match(s.demo.nextPractice!.reason, /rehearsal evidence/);
});

test("withdrawn, missing, assistant-generated and cross-course observations cannot contribute progress", () => {
  const input = fixture();
  for (const id of ["withdrawn", "missing", "assistant", "wrong-goal", "wrong-exercise", "wrong-course", "meeting"]) addAttempt(input, { id });
  input.evidence[0]!.invalidated = { at: 200, reason: "Accidental answer" };
  input.observations = input.observations.filter(o => o.id !== "observation_missing");
  input.observations.find(o => o.id === "observation_assistant")!.actor = "assistant";
  input.observations.find(o => o.id === "observation_wrong-goal")!.goalId = "other";
  input.observations.find(o => o.id === "observation_wrong-exercise")!.exerciseId = "other";
  input.sessions.find(s => s.id === "session_wrong-course")!.courseId = "biology";
  input.sessions.find(s => s.id === "session_meeting")!.mode = "meeting";
  assert.equal(skill(input).real.independentAttempts, 0);
  assert.deepEqual(skill(input).real.evidence, []);
});

test("duplicate criterion rows count the underlying answer once, and invalidation excludes the entire answer", () => {
  const input = fixture(); addAttempt(input);
  const original = input.evidence[0]!;
  input.evidence = [...input.evidence, { ...original, id: "duplicate" }];
  assert.equal(skill(input).real.independentAttempts, 1);
  input.evidence = [...input.evidence, { ...original, id: "withdrawn-sibling", criterion: "market-clearing-allocation", invalidated: { at: 300, reason: "Exclude whole answer" } }];
  assert.equal(skill(input).real.independentAttempts, 0);
});

test("actual foundation checks assess the concept now without assigning school attainment", () => {
  const input = fixture(); addAttempt(input, { skillId: "fractions", criterion: "fraction-division", assistance: "assisted" });
  addAttempt(input, { skillId: "ratios", criterion: "ratio-reduction" });
  addAttempt(input, { skillId: "linear-equations", criterion: "linear-equation" });
  assert.equal(skill(input, "fractions").real.assistedCorrect, 1);
  assert.equal(skill(input, "ratios").real.independentCorrect, 1);
  assert.equal(skill(input, "linear-equations").real.independentCorrect, 1);
  assert.equal(skill(input).real.status, "unassessed");
  assert.match(deriveEducation(input).stages[0]!.description, /not a claim about when/);
  input.sessions[0]!.education!.skillId = "ratios";
  assert.equal(skill(input, "fractions").real.assistedCorrect, 0, "do not accept a mismatched foundation skill tag");
});

test("durable attempt order survives a backward clock and custom goals get no fixed exercise proposal", () => {
  const input = fixture(); addAttempt(input, { at: 1000 }); addAttempt(input, { at: 100, correct: false });
  const p = skill(input).real;
  assert.equal(p.status, "practicing"); assert.match(p.nextPractice!.reason, /last recorded answer failed/);
  assert.deepEqual(p.evidence.map(e => e.at), [1000, 100]);
  input.practiceGoalIds = [];
  assert.equal(skill(input).real.nextPractice, undefined); assert.equal(skill(input).real.independentAttempts, 2, "changing criteria does not erase original attempts");
});

test("snapshot exposes real saved checks, survives SQLite reopen and removes withdrawn progress", t => {
  const dir = mkdtempSync(join(tmpdir(), "hormes-education-")); const store = new WorkStore(dir, () => 1000);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const send = (c: Omit<WorkCommand, "requestId">) => store.command({ ...c, requestId: randomUUID() });
  send({ action: "start", mode: "exam" });
  const session = store.state().active!, prompt = session.exercise!.prompt;
  const a = prompt.match(/A owns \((\d+), (\d+)\)/)!, b = prompt.match(/B owns \((\d+), (\d+)\)/)!;
  const answer = exchangeAnswer([Number(a[1]), Number(a[2])], [Number(b[1]), Number(b[2])]);
  send({ action: "submit", text: `${answer.price};${answer.allocation.join(",")}` });
  const saved = store.state().education!;
  assert.equal(saved.skills.find(s => s.id === "exchange-price")!.real.independentCorrect, 1);
  assert.equal(saved.skills.find(s => s.id === "exchange-allocation")!.real.independentCorrect, 1);
  assert.equal(saved.skills.find(s => s.id === "fractions")!.real.independentCorrect, 0);
  assert.ok(!JSON.stringify(saved).includes('"allocation":'), "private grading parameters must not enter map");
  store.close(); assert.deepEqual(store.state().education, saved);
  const evidenceId = store.state().evidence[0]!.id;
  send({ action: "evidence.invalidate", sessionId: session.id, evidenceId, text: "I copied this answer" });
  for (const id of ["exchange-price", "exchange-allocation"]) assert.equal(store.state().education!.skills.find(s => s.id === id)!.real.independentAttempts, 0);
  assert.equal(store.state().evidence.length, 2, "original evidence is preserved");
});

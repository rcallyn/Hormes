import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { WorkCommand, WorkScope } from "@hormes/protocol";
import { WorkStore, exchangeAnswer } from "../work/store.ts";
import { foundationProblem } from "../work/foundations.ts";

function fixture(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(join(tmpdir(), "hormes-education-loop-"));
  let now = 1000;
  const store = new WorkStore(dir, () => now++);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const send = (c: Omit<WorkCommand, "requestId"> & { requestId?: string }) => store.command({ ...c, requestId: c.requestId ?? randomUUID() });
  const active = () => store.state().active!;
  const map = (id: string, demo = false) => store.state().education!.skills.find(s => s.id === id)![demo ? "demo" : "real"];
  const practice = (skillId: string, sessionId = active().id, goalId = active().goalId) => send({ action: "education.practice", skillId, sessionId, goalId });
  const speak = (text: string, scope: WorkScope = store.scope()!) => store.voice(scope, randomUUID(), text);
  return { dir, store, send, active, map, practice, speak };
}

function assertPrivateAnswerHidden(store: WorkStore, answer: number, fraction?: string) {
  const scope = store.scope()!;
  const publicText = JSON.stringify(store.state().active) + store.context(scope);
  assert.ok(!publicText.includes(String(answer)), "private numeric result must not enter public session or model context before submission");
  if (fraction) assert.ok(!publicText.includes(fraction), "fresh fraction solution must not enter the problem plan or context");
  assert.ok(!publicText.includes('"signature"'), "private exercise specification must not be exposed");
}

test("exchange → fractions wrong/hint/assisted → fresh independent → fresh exchange persists without invented mastery", t => {
  const { store, send, active, map, practice, speak } = fixture(t);
  send({ action: "start", mode: "study" }); const original = active();
  practice("fractions"); const first = active();
  assert.equal(first.education!.returnSessionId, original.id);
  assert.equal(first.exercise!.kind, "foundation"); assert.equal(first.exercise!.independent, true);
  assert.equal(store.state().sessions.find(s => s.id === original.id)!.state, "paused");
  assert.equal(first.exercise!.prompt, foundationProblem("fractions", 0).prompt);
  send({ action: "lesson.prepare", sessionId: first.id });
  const firstPlan = JSON.parse(active().pendingPlan!.json) as { operations: Array<{ text: string }> };
  assert.deepEqual(firstPlan.operations.map(o => o.text), foundationProblem("fractions", 0).lines);
  assertPrivateAnswerHidden(store, foundationProblem("fractions", 0).answer, "8/9");
  assert.match(speak("the answer is one")!.checked!, /does not satisfy/);
  const wrong = store.state().evidence.at(-1)!;
  assert.equal(wrong.criterion, "fraction-division"); assert.equal(wrong.correct, false); assert.equal(wrong.assistance, "independent");
  assert.deepEqual(speak("I need a hint"), { help: true });
  store.recordSpeech(store.scope()!, "When dividing by a fraction, multiply by its reciprocal. Try that step first.");
  assert.match(speak("the answer is eight over nine")!.checked!, /Correct numeric result.*assisted/);
  assert.equal(map("fractions").assistedCorrect, 1); assert.equal(map("fractions").independentCorrect, 0);
  assert.equal(map("exchange-price").independentCorrect, 0);
  practice("fractions"); const independent = active();
  assert.notEqual(independent.exercise!.id, first.exercise!.id);
  assert.notEqual(independent.exercise!.prompt, first.exercise!.prompt);
  assert.equal(independent.education!.returnSessionId, original.id);
  send({ action: "lesson.prepare", sessionId: independent.id });
  assertPrivateAnswerHidden(store, foundationProblem("fractions", 1).answer, "15/16");
  assert.match(speak("the answer is fifteen over sixteen")!.checked!, /Correct numeric result.*independent/);
  const independentEvidence = store.state().evidence.at(-1)!;
  assert.equal(map("fractions").independentAttempts, 2); assert.equal(map("fractions").independentCorrect, 1);
  assert.equal(map("fractions").assistedAttempts, 1);
  assert.equal(store.state().goals.find(g => g.id === original.goalId)!.state, "in-progress");
  send({ action: "education.return", sessionId: independent.id }); const returned = active();
  assert.equal(returned.mode, "exam"); assert.equal(returned.exercise!.kind, "exchange");
  assert.notEqual(returned.exercise!.id, original.exercise!.id);
  assert.notEqual(returned.exercise!.prompt, original.exercise!.prompt);
  assert.equal(returned.goalId, original.goalId); assert.equal(returned.courseId, original.courseId);
  assert.equal(returned.education!.returnSessionId, original.id);
  assert.deepEqual(store.state().sessions.find(s => s.id === original.id)!.exercise, original.exercise);
  const prompt = returned.exercise!.prompt;
  const a = prompt.match(/A owns \((\d+), (\d+)\)/)!, b = prompt.match(/B owns \((\d+), (\d+)\)/)!;
  const transfer = exchangeAnswer([Number(a[1]), Number(a[2])], [Number(b[1]), Number(b[2])]);
  send({ action: "submit", text: `${transfer.price};${transfer.allocation.join(",")}` });
  assert.equal(map("exchange-price").independentCorrect, 1);
  assert.equal(map("exchange-allocation").independentCorrect, 1);
  assert.equal(store.state().goals.find(g => g.id === original.goalId)!.state, "in-progress", "one fresh application is not the full goal or course mastery");
  const mapBefore = store.state().education; store.close();
  assert.deepEqual(store.state().education, mapBefore); assert.equal(active().id, returned.id);
  send({ action: "evidence.invalidate", sessionId: independent.id, evidenceId: independentEvidence.id, text: "I copied the fresh answer" });
  assert.equal(map("fractions").independentCorrect, 0); assert.equal(map("fractions").independentAttempts, 1);
  assert.equal(map("fractions").assistedCorrect, 1); assert.equal(store.state().evidence.length, 5);
  assert.equal(store.state().evidence.find(e => e.id === independentEvidence.id)!.invalidated!.reason, "I copied the fresh answer");
});

test("hypothetical prerequisite work and return retain demo provenance, while omitted origin starts real practice", t => {
  const { store, send, active, map, practice } = fixture(t);
  send({ action: "demo", blockId: "study" }); const origin = active();
  assert.equal(origin.demo, true); practice("fractions"); const synthetic = active();
  assert.equal(synthetic.demo, true); send({ action: "submit", text: String(foundationProblem("fractions", 0).answer) });
  assert.equal(map("fractions", true).independentCorrect, 1); assert.equal(map("fractions").independentAttempts, 0);
  send({ action: "education.return", sessionId: synthetic.id }); assert.equal(active().demo, true);
  send({ action: "education.practice", goalId: origin.goalId, skillId: "fractions" });
  assert.equal(active().demo, false); assert.equal(active().education!.returnSessionId, undefined);
  assert.equal(map("fractions").independentAttempts, 0);
  assert.ok(!store.context(store.scope()!).includes(store.state().evidence[0]!.id), "real model context must not import the rehearsal answer");
  assert.throws(() => send({ action: "education.return", sessionId: active().id }), /original|return/);
});

test("the third fresh fraction problem records its naturally spoken two-digit answer", t => {
  const { store, send, active, map, practice, speak } = fixture(t);
  send({ action: "start", mode: "study" });
  for (const answer of ["eight over nine", "fifteen over sixteen", "twenty-four over twenty-five"]) {
    practice("fractions");
    assert.match(speak(`My answer is ${answer}.`)!.checked!, /Correct numeric result.*independent/);
  }
  assert.equal(map("fractions").independentCorrect, 3);
  assert.equal(store.state().evidence.at(-1)!.answer, "24/25");
  assert.equal(store.state().evidence.at(-1)!.sessionId, active().id);
  assert.equal(map("exchange-price").independentCorrect, 0);
});

test("ratio, equation and income practice use fresh authored checks with the exact skill evidence", t => {
  const { store, send, active, map, practice } = fixture(t);
  send({ action: "start", mode: "exam" });
  for (const skillId of ["ratios", "linear-equations", "exchange-income"] as const) {
    practice(skillId);
    const expected = foundationProblem(skillId, 0);
    assert.equal(active().exercise!.prompt, expected.prompt);
    send({ action: "lesson.prepare", sessionId: active().id });
    const plan = JSON.parse(active().pendingPlan!.json) as { operations: Array<{ text: string }> };
    assert.deepEqual(plan.operations.map(o => o.text), expected.lines);
    send({ action: "submit", text: String(expected.answer) });
    assert.equal(store.state().evidence.at(-1)!.criterion, expected.criterion);
    assert.equal(map(skillId).independentCorrect, 1);
    assert.equal(store.state().evidence.at(-1)!.limitations, expected.limitation);
  }
  assert.equal(map("fractions").independentAttempts, 0);
  assert.equal(map("exchange-price").independentAttempts, 0);
});

test("unsupported skills, custom goals and mismatched origin sessions fail without mutating saved work", t => {
  const { store, send, active } = fixture(t);
  send({ action: "start", mode: "exam" }); const original = active();
  send({ action: "goal.create", goalInput: { kind: "learning", title: "Monopoly", outcome: "Understand monopoly", courseId: "microeconomics", criteria: ["Explain a new case"] } });
  const customGoal = store.state().goals.find(g => g.id !== original.goalId)!;
  send({ action: "start", mode: "study", goalId: customGoal.id }); const other = active();
  const before = store.state();
  assert.throws(() => send({ action: "education.practice", goalId: original.goalId, skillId: "functions" }), /supported|skill|prerequisite/);
  assert.throws(() => send({ action: "education.practice", goalId: "missing", skillId: "fractions" }), /goal/);
  assert.throws(() => send({ action: "education.practice", goalId: customGoal.id, skillId: "fractions" }), /supported|goal/);
  assert.throws(() => send({ action: "education.practice", goalId: original.goalId, skillId: "fractions", sessionId: other.id }), /same course and goal/);
  assert.throws(() => send({ action: "education.practice", goalId: original.goalId, skillId: "fractions", sessionId: "missing" }), /session/);
  assert.deepEqual(store.state(), before);
});

test("stale return and voice cannot replace a newer session or credit its attempt", t => {
  const { store, send, active, practice, speak } = fixture(t);
  send({ action: "start", mode: "exam" }); practice("fractions");
  const old = active(), oldScope = store.scope()!;
  send({ action: "start", mode: "meeting" }); const before = store.state();
  assert.throws(() => send({ action: "education.return", sessionId: old.id }), /active|changed|stale|current|Resume/);
  assert.throws(() => speak("the answer is eight over nine", oldScope), /active|changed|stale|current/);
  assert.deepEqual(store.state(), before);
});

test("practice is explicit and idempotent, with no model operation that manufactures a diagnostic", t => {
  const { store, send, active } = fixture(t);
  send({ action: "start", mode: "exam" }); const original = active(), scope = store.scope()!;
  const command: WorkCommand = { action: "education.practice", requestId: "one_diagnostic", goalId: original.goalId, skillId: "fractions", sessionId: original.id };
  assert.equal(store.command(command), true); const saved = store.state();
  assert.equal(store.command(command), false); assert.deepEqual(store.state(), saved);
  assert.throws(() => store.model(store.scope()!, "education.practice", { skillId: "fractions", answer: "8/9" }), /unsupported|unknown|operation/i);
  assert.deepEqual(store.state(), saved);
  assert.throws(() => store.model(scope, "board", {}), /active|changed|stale|current/);
});


test("Education cannot interrupt active lecture capture", t => {
  const { store, send, active } = fixture(t);
  send({ action: "start", mode: "exam" }); const original = active();
  send({ action: "start", mode: "class", goalId: original.goalId });
  send({ action: "lecture.begin", sessionId: active().id });
  const before = store.state();
  assert.equal(before.active!.lecture!.status, "recording");
  assert.throws(() => send({ action: "education.practice", goalId: original.goalId, skillId: "fractions", sessionId: original.id }), /pause capture/);
  assert.deepEqual(store.state(), before);
});


test("legacy source-linked course sessions can enter prerequisites and return without rewriting their course history", t => {
  const { dir, store, send, active, practice } = fixture(t);
  send({ action: "start", mode: "exam" }); const original = active(); store.close();
  const path = join(dir, "work", "work.sqlite");
  const db = new DatabaseSync(path);
  try {
    const legacy = { ...original }; delete legacy.courseId;
    db.prepare("UPDATE records SET value=? WHERE kind='session' AND id=?").run(JSON.stringify(legacy), original.id);
  } finally { db.close(); }
  assert.equal(active().courseId, "microeconomics", "Console projection recognizes the original course source");
  practice("fractions"); const foundation = active();
  assert.equal(foundation.courseId, "microeconomics");
  assert.equal(foundation.education!.returnSessionId, original.id);
  send({ action: "education.return", sessionId: foundation.id });
  assert.equal(active().exercise!.kind, "exchange");
  assert.equal(active().goalId, original.goalId);
  assert.notEqual(active().exercise!.id, original.exercise!.id);
  const readOnly = new DatabaseSync(path, { readOnly: true });
  try {
    const row = readOnly.prepare("SELECT value FROM records WHERE kind='session' AND id=?").get(original.id)!;
    assert.equal(JSON.parse(String(row.value)).courseId, undefined, "compatibility projection should preserve the historical record");
  } finally { readOnly.close(); }
});

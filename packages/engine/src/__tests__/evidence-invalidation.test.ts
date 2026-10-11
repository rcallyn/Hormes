import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { WorkStore, exchangeAnswer } from "../work/store.ts";
import type { WorkCommand, WorkEvidence, WorkObservation } from "@hormes/protocol";

const DAY = 86_400_000;
function fixture(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(join(tmpdir(), "hormes-evidence-"));
  let now = Date.UTC(2026, 9, 11);
  const store = new WorkStore(dir, () => now);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const send = (command: Omit<WorkCommand, "requestId"> & { requestId?: string }) => store.command({ ...command, requestId: command.requestId ?? randomUUID() });
  const solveExam = (index: number, demo = false) => {
    send(demo ? { action: "demo", blockId: "exam" } : { action: "start", mode: "exam" });
    const result = exchangeAnswer([4 + index, 1], [2, 2 + index]);
    send({ action: "submit", text: `${result.price};${result.allocation.join(",")}` });
    return store.state().active!;
  };
  return { dir, store, send, solveExam, advance: (ms: number) => { now += ms; } };
}

test("excluding one checked answer preserves original speech and atomically withdraws both criteria across reopen", t => {
  const { dir, store, send } = fixture(t);
  send({ action: "start", mode: "exam" });
  const session = store.state().active!;
  store.voice(store.scope()!, "heard_once", "The price is two. A gets three of x and one point five of y. B gets three of x and one point five of y.");
  const original = store.state(), checked = original.evidence[0]!;
  assert.equal(original.evidence.length, 2);
  const observation = original.observations.find(o => o.id === checked.observationId)!;
  assert.equal(observation.input, "voice");
  send({ action: "pause" });
  const correction: WorkCommand = { action: "evidence.invalidate", requestId: "exclude_once", sessionId: session.id, evidenceId: checked.id, text: "Speech recognition recorded numbers I did not say." };
  assert.equal(store.command(correction), true);
  assert.equal(store.command(correction), false);
  const after = store.state();
  assert.equal(after.active, undefined, "correcting a saved record cannot reopen its microphone/workspace");
  assert.deepEqual(after.observations.find(o => o.id === observation.id), observation);
  assert.equal(after.observations.filter(o => o.kind === "action" && o.text.includes("Excluded attempt")).length, 1);
  assert.equal(after.evidence.length, 2);
  for (const row of after.evidence) {
    const { invalidated, ...assessment } = row;
    assert.deepEqual(assessment, original.evidence.find(e => e.id === row.id));
    assert.equal(invalidated?.reason, correction.text);
  }
  const db = new DatabaseSync(join(dir, "work", "work.sqlite"), { readOnly: true });
  try {
    const history = db.prepare("SELECT value FROM activity WHERE kind='evidence' AND record_id=? ORDER BY seq").all(checked.id).map(r => JSON.parse(String(r.value)) as WorkEvidence);
    assert.equal(history.length, 2);
    assert.equal(history[0]!.invalidated, undefined);
    assert.equal(history[1]!.invalidated?.reason, correction.text);
  } finally { db.close(); }
  store.close();
  const reopened = new WorkStore(dir);
  try { assert.deepEqual(reopened.state().evidence, after.evidence); assert.deepEqual(reopened.state().goals, after.goals); }
  finally { reopened.close(); }
});

test("a completed goal reopens after a required answer is excluded and needs new valid evidence", t => {
  const { store, send, solveExam, advance } = fixture(t);
  solveExam(0); solveExam(1); advance(DAY); const third = solveExam(2);
  assert.equal(store.state().goals[0]!.state, "complete");
  const excluded = store.state().evidence.find(e => e.sessionId === third.id)!;
  send({ action: "start", mode: "meeting" });
  const otherActive = store.state().active;
  send({ action: "evidence.invalidate", sessionId: third.id, evidenceId: excluded.id, text: "I read the provided solution; this was not my independent attempt." });
  assert.deepEqual(store.state().active, otherActive, "a historical correction must not switch unrelated work");
  assert.equal(store.state().goals.find(g => g.id === third.goalId)!.state, "in-progress");
  assert.equal(store.state().evidence.filter(e => e.invalidated).length, 2);
  solveExam(3);
  assert.equal(store.state().goals.find(g => g.id === third.goalId)!.state, "complete");
  assert.equal(store.state().evidence.filter(e => e.invalidated).length, 2, "new valid practice does not resurrect excluded history");
});

test("invalidated mistakes leave tutor evidence but retain help, so a repeated answer cannot become independent", t => {
  const { store, send } = fixture(t);
  send({ action: "start", mode: "exam" }); const session = store.state().active!, scope = store.scope()!;
  send({ action: "submit", text: "9" });
  const wrong = store.state().evidence[0]!;
  store.recordSpeech(scope, "Try valuing the endowment at these prices.");
  send({ action: "evidence.invalidate", sessionId: session.id, evidenceId: wrong.id, text: "The original number was misheard." });
  const context = JSON.parse(store.context(scope)) as { evidence: WorkEvidence[]; observations: WorkObservation[] };
  assert.equal(context.evidence.some(e => e.id === wrong.id), false);
  assert.equal(context.observations.some(o => o.id === wrong.observationId), false);
  assert.ok(context.observations.some(o => o.kind === "hint"));
  assert.ok(context.observations.some(o => o.kind === "action" && o.text.includes("misheard")));
  send({ action: "submit", text: "2;3,1.5,3,1.5" });
  assert.ok(store.state().evidence.slice(-2).every(e => e.correct && e.assistance === "assisted"));
  assert.equal(store.state().goals[0]!.state, "in-progress");
});

test("corrections require a reason and exact saved session; model tools cannot exclude evidence or replace a reason", t => {
  const { store, send, solveExam } = fixture(t);
  const first = solveExam(0); const evidence = store.state().evidence[0]!;
  const second = solveExam(1);
  const before = store.state();
  for (const invalid of [
    { sessionId: first.id, evidenceId: evidence.id, text: " " },
    { sessionId: first.id, evidenceId: evidence.id, text: "x".repeat(501) },
    { sessionId: second.id, evidenceId: evidence.id, text: "Wrong session" },
    { sessionId: first.id, evidenceId: "missing", text: "Unknown attempt" },
  ]) {
    assert.throws(() => send({ action: "evidence.invalidate", ...invalid }));
    assert.deepEqual(store.state(), before, "failed corrections are atomic");
  }
  assert.throws(() => store.model(store.scope()!, "evidence.invalidate", { evidenceId: evidence.id, text: "Model wants to erase this" }), /Unknown work operation/);
  const command: WorkCommand = { action: "evidence.invalidate", requestId: "correction", sessionId: first.id, evidenceId: evidence.id, text: "The student withdrew this attempt." };
  store.command(command);
  const corrected = store.state();
  assert.throws(() => store.command({ ...command, text: "A different explanation" }), /already used/);
  assert.throws(() => send({ ...command, requestId: "replacement_reason", text: "Replace history" }), /already excluded/);
  assert.deepEqual(store.state(), corrected);
});

test("excluding demo evidence cannot promote it or turn remaining rehearsals into real mastery", t => {
  const { store, send, solveExam, advance } = fixture(t);
  const first = solveExam(0, true); solveExam(1, true); advance(DAY); solveExam(2, true);
  const evidence = store.state().evidence.find(e => e.sessionId === first.id)!;
  send({ action: "evidence.invalidate", sessionId: first.id, evidenceId: evidence.id, text: "Exclude this synthetic rehearsal." });
  assert.equal(store.state().goals[0]!.state, "in-progress");
  assert.ok(store.state().evidence.every(e => e.limitations.includes("excluded from goal completion")));
});

test("a withdrawn answer alone cannot unlock an unsolicited independent-practice hint", t => {
  const { store, send } = fixture(t);
  send({ action: "start", mode: "exam" });
  const session = store.state().active!, scope = store.scope()!;
  send({ action: "submit", text: "9" });
  const checked = store.state().evidence[0]!;
  send({ action: "evidence.invalidate", sessionId: session.id, evidenceId: checked.id, text: "This was not an intended submission." });
  const plan = { summary: "Budget cue", operations: [{ type: "write", tempId: "budget", text: "Value the endowment", x: 30, y: 30, fontSize: 20 }] };
  assert.throws(() => store.model(scope, "board", plan), /Independent practice/);
  assert.equal(store.state().active?.pendingPlan, undefined);
  send({ action: "hint" });
  assert.match(store.model(scope, "board", plan), /queued/);
});

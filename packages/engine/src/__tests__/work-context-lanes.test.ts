import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { WorkCommand, WorkDeck, WorkEvidence, WorkObservation, WorkRecallAttempt, WorkSession } from "@hormes/protocol";
import { WorkStore } from "../work/store.ts";

type Context = { session: WorkSession; observations: WorkObservation[]; evidence: WorkEvidence[]; decks: WorkDeck[]; recallAttempts: WorkRecallAttempt[]; sources: { id: string }[] };
function setup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "hormes-context-lanes-")), store = new WorkStore(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  return { dir, store, send: (command: Omit<WorkCommand, "requestId">) => store.command({ ...command, requestId: randomUUID() }), context: () => JSON.parse(store.context(store.scope()!)) as Context };
}

test("real and rehearsal tutors receive only their own attempts, evidence, decks and recall history", t => {
  const { store, send, context } = setup(t);
  send({ action: "demo", blockId: "study" }); const demoStudy = store.state().active!;
  store.voice(store.scope()!, "demo_wrong", "The price is nine");
  send({ action: "demo", blockId: "review" }); const demoReview = store.state().active!;
  store.voice(store.scope()!, "demo_recall", "five");
  send({ action: "start", mode: "study" }); const realStudy = store.state().active!;
  store.voice(store.scope()!, "real_wrong", "The price is eight");
  send({ action: "start", mode: "review" }); const realReview = store.state().active!;
  store.voice(store.scope()!, "real_recall", "five");
  const counts = { evidence: store.state().evidence.length, recall: store.state().recallAttempts!.length, decks: store.state().decks!.length };
  assert.equal(counts.evidence, 2); assert.equal(counts.recall, 2); assert.equal(counts.decks, 2);
  for (const demo of [false, true]) {
    if (demo) send({ action: "demo", blockId: "exam" }); else send({ action: "start", mode: "exam" });
    const value = context(), allowed = demo ? [demoStudy.id, demoReview.id] : [realStudy.id, realReview.id];
    const denied = demo ? [realStudy.id, realReview.id] : [demoStudy.id, demoReview.id];
    assert.equal(value.session.demo, demo);
    assert.ok(value.observations.some(o => allowed.includes(o.sessionId) && o.kind === "answer"));
    assert.ok(value.evidence.some(e => allowed.includes(e.sessionId)));
    assert.equal(value.evidence.length, 1);
    assert.equal(value.recallAttempts.length, 1);
    assert.ok(value.recallAttempts.every(a => a.demo === demo && allowed.includes(a.sessionId)));
    assert.equal(value.decks.length, 1); assert.ok(value.decks.every(d => d.demo === demo));
    assert.ok(value.observations.every(o => !denied.includes(o.sessionId)), "an unlabelled answer from the other lane must not reach the tutor");
    assert.ok(value.evidence.every(e => !denied.includes(e.sessionId)));
    assert.ok(value.sources.every(source => value.session.sourceIds.includes(source.id) || value.session.artifactSourceIds.includes(source.id)));
  }
  assert.deepEqual({ evidence: store.state().evidence.length, recall: store.state().recallAttempts!.length, decks: store.state().decks!.length }, counts, "context filtering never deletes the Console audit history");
});

test("same-lane practice from another goal does not enter this goal's tutor context", t => {
  const { store, send, context } = setup(t);
  send({ action: "start", mode: "study" }); const original = store.state().active!;
  store.voice(store.scope()!, "original_attempt", "The price is nine");
  send({ action: "goal.create", goalInput: { title: "Another microeconomics goal", outcome: "Review another result", kind: "learning", courseId: "microeconomics", criteria: ["Explain the result"] } });
  const other = store.state().goals.find(g => g.id !== original.goalId)!;
  send({ action: "start", mode: "study", goalId: other.id });
  store.voice(store.scope()!, "other_attempt", "The price is eight");
  send({ action: "start", mode: "exam", goalId: original.goalId });
  const value = context();
  assert.equal(value.evidence.length, 1);
  assert.equal(value.evidence[0]!.goalId, original.goalId);
  assert.ok(value.observations.every(o => o.goalId === original.goalId));
});

test("context rejects orphaned or cross-course saved session evidence while retaining legacy exchange course linkage", t => {
  const { dir, store, send, context } = setup(t);
  send({ action: "start", mode: "study" }); const study = store.state().active!;
  store.voice(store.scope()!, "study_attempt", "The price is nine");
  send({ action: "start", mode: "exam" });
  const db = new DatabaseSync(join(dir, "work", "work.sqlite"));
  t.after(() => db.close());
  const saved = JSON.parse(String(db.prepare("SELECT value FROM records WHERE kind='session' AND id=?").get(study.id)!.value)) as WorkSession;
  db.prepare("UPDATE records SET value=? WHERE kind='session' AND id=?").run(JSON.stringify({ ...saved, courseId: "physics" }), study.id);
  assert.equal(context().evidence.length, 0, "a matching goal ID alone cannot make a physics session a microeconomics attempt");
  assert.ok(context().observations.every(o => o.sessionId !== study.id));
  const { courseId: _course, ...legacy } = saved;
  db.prepare("UPDATE records SET value=? WHERE kind='session' AND id=?").run(JSON.stringify(legacy), study.id);
  assert.equal(context().evidence.length, 1, "legacy course_exchange source still establishes the saved course association");
  db.prepare("DELETE FROM records WHERE kind='session' AND id=?").run(study.id);
  assert.equal(context().evidence.length, 0, "an orphaned assessment cannot establish a context lane");
  assert.ok(context().observations.every(o => o.sessionId !== study.id));
});

test("a rehearsal question cannot reenter real tutor context through shared goal.next", t => {
  const { store, send, context } = setup(t);
  const privateDemoQuestion = "REHEARSAL_ONLY_UNFINISHED_QUESTION_4817";
  send({ action: "demo", blockId: "study" });
  send({ action: "question", text: privateDemoQuestion });
  assert.ok(store.state().goals[0]!.next.includes(privateDemoQuestion), "reproduce the shared legacy goal summary");
  send({ action: "start", mode: "exam" });
  const value = context();
  assert.ok(!JSON.stringify(value).includes(privateDemoQuestion), "filtered rehearsal text must not leak through a goal summary");
  assert.equal(value.session.next, store.state().active!.next, "the active session retains its actual next step");
  assert.ok(store.state().goals[0]!.next.includes(privateDemoQuestion), "reading model context does not rewrite Console history");
});

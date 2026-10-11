import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { WorkStore } from "../work/store.ts";
import type { PhoneAnswer } from "@hormes/protocol";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "hormes-phone-"));
  const store = new WorkStore(dir, () => 1000);
  store.command({ action: "start", mode: "study", requestId: randomUUID() });
  const session = store.state().active!;
  store.model(store.scope()!, "quiz", { title: "Review", sourceIds: session.sourceIds, cards: [
    { front: "Opportunity cost?", back: "Best alternative forgone", options: ["Best alternative forgone", "All costs"], correctOption: 0 },
    { front: "A budget describes?", back: "Affordability", options: ["Affordability", "Desire"], correctOption: 0 },
  ] });
  const quiz = store.phoneQuiz()!;
  const answer = (card = 0, choiceIndex = 0): PhoneAnswer => ({ attemptId: randomUUID(), quizId: quiz.id, cardId: quiz.cards[card]!.id, choiceIndex, answeredAt: 100 });
  return { store, dir, quiz, answer, close() { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test("phone answers are durable, idempotent and separate from mastery evidence", () => {
  const f = fixture();
  try {
    assert.equal(f.quiz.cards.length, 2);
    const value = f.answer(), first = f.store.phoneAnswer(value, "device");
    assert.deepEqual(f.store.phoneAnswer(value, "device"), first);
    assert.throws(() => f.store.phoneAnswer({ ...value, choiceIndex: 1 }, "device"), /already used/);
    const state = f.store.state();
    assert.equal(state.recallAttempts!.length, 1);
    assert.equal(state.recallAttempts![0]!.origin, "iphone");
    assert.equal(state.recallAttempts![0]!.at, 1000, "device time is not evidence time");
    assert.equal(state.evidence.length, 0);
    assert.equal(state.goals[0]!.state, "in-progress");
    assert.equal(state.active!.surface!.kind, "quiz");
    const reloaded = new WorkStore(f.dir, () => 2000);
    assert.deepEqual(reloaded.phoneAnswer(value, "device"), first);
    assert.equal(reloaded.state().recallAttempts!.length, 1); reloaded.close();
  } finally { f.close(); }
});
test("offline replies stay with their original session after the Mac changes work", () => {
  const f = fixture();
  try {
    f.store.command({ action: "start", mode: "review", requestId: randomUUID() });
    const next = f.store.state().active!;
    f.store.phoneAnswer(f.answer(1, 1), "device");
    const state = f.store.state();
    assert.equal(state.active!.id, next.id);
    assert.deepEqual(state.active!.surface, next.surface);
    assert.equal(state.recallAttempts![0]!.sessionId, f.quiz.sessionId);
    assert.equal(state.recallAttempts![0]!.result, "incorrect");
  } finally { f.close(); }
});
test("invalid questions, choices and goal revisions cannot manufacture phone attempts", () => {
  const f = fixture();
  try {
    assert.throws(() => f.store.phoneAnswer({ ...f.answer(), cardId: "unknown" }, "device"));
    assert.throws(() => f.store.phoneAnswer(f.answer(0, 5), "device"));
    assert.throws(() => f.store.phoneAnswer({ ...f.answer(), quizId: "unexported" }, "device"));
    assert.equal(f.store.state().recallAttempts!.length, 0);
    const goal = f.store.state().goals[0]!;
    f.store.command({ action: "goal.revise", requestId: randomUUID(), goalId: goal.id, expectedGoalVersion: goal.version, goalInput: { title: goal.title, outcome: "A new outcome", kind: "learning", courseId: "microeconomics", criteria: ["New criterion"] } });
    assert.throws(() => f.store.phoneAnswer(f.answer(), "device"), /goal changed/);
    assert.equal(f.store.state().recallAttempts!.length, 0);
  } finally { f.close(); }
});
test("Mac answers win a conflict, and Next restores already-synced phone answers", () => {
  const f = fixture();
  try {
    const s = f.store.state().active!;
    f.store.command({ action: "quiz.answer", requestId: randomUUID(), sessionId: s.id, surfaceId: s.surface!.id, choiceIndex: 1 });
    assert.throws(() => f.store.phoneAnswer(f.answer(0, 0), "device"), /already has a saved answer/);
    f.store.phoneAnswer(f.answer(1, 0), "device");
    f.store.command({ action: "tool.next", requestId: randomUUID(), sessionId: s.id });
    const surface = f.store.state().active!.surface!;
    assert.equal(surface.kind, "quiz");
    assert.ok("attemptId" in surface && surface.attemptId);
    assert.equal(f.store.state().recallAttempts!.length, 2);
  } finally { f.close(); }
});

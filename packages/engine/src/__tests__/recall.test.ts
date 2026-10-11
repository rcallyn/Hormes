import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { WorkStore } from "../work/store.ts";
import type { WorkCommand, WorkLearningSurface } from "@hormes/protocol";

function fixture(t: { after(fn: () => void): void }, mode: "study" | "review" = "review") {
  const dir = mkdtempSync(join(tmpdir(), "hormes-recall-")); let now = Date.UTC(2026, 9, 11, 10);
  const store = new WorkStore(dir, () => now);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const send = (c: Omit<WorkCommand, "requestId">) => store.command({ ...c, requestId: randomUUID() });
  send({ action: "start", mode });
  return { dir, store, send, advance: (ms: number) => { now += ms; }, time: () => now };
}
function card(store: WorkStore): Extract<WorkLearningSurface, { kind: "quiz" | "flashcard" }> {
  const surface = store.state().active!.surface!;
  assert.ok(surface.kind === "quiz" || surface.kind === "flashcard"); return surface;
}
const deck = { title: "Source recall", sourceIds: ["course_exchange"], cards: [{ front: "What is half of ten?", back: "Five", answers: ["five", "5"] }] };
const quiz = { title: "Income quiz", sourceIds: ["course_exchange"], cards: [{ front: "Income of (2,1), p=3?", back: "2 + 3 = 5", options: ["2", "5", "3"], correctOption: 1 }, { front: "With u=xy, each income share?", back: "One half", options: ["One half", "One third"], correctOption: 0 }] };

test("recall front has no back; only an actual spoken answer or I forgot flips it", t => {
  const { store, send } = fixture(t); const scope = store.scope()!;
  assert.equal(card(store).back, undefined);
  assert.throws(() => send({ action: "tool.next" }), /Speak an answer/);
  assert.throws(() => store.model(scope, "submit", { answer: "five" }), /Unknown/);
  assert.throws(() => store.model(scope, "surface", { kind: "whiteboard" }), /spoken answer/);
  store.voice(scope, "help", "Give me a hint"); assert.equal(card(store).back, undefined);
  const result = store.voice(scope, "forgot", "I forgot");
  assert.match(result!.checked!, /forgotten/); assert.equal(card(store).back, "mₐ = 2 + 3 × 1 = 5");
  const attempt = store.state().recallAttempts![0]!;
  assert.equal(attempt.result, "forgot"); assert.equal(attempt.assisted, true); assert.equal(attempt.intervalMs, 60_000);
  assert.equal(attempt.input, "voice"); assert.equal(attempt.utteranceId, "forgot");
  store.voice(scope, "forgot", "I forgot"); assert.equal(store.state().recallAttempts!.length, 1);
  assert.equal(store.state().evidence.length, 0); assert.equal(store.state().goals[0]!.state, "in-progress");
});

test("adaptive due clock survives restart, defers locked/busy ticks and never floods missed prompts", t => {
  const { store, send, advance, time, dir } = fixture(t, "study");
  const scope = store.scope()!;
  store.model(scope, "deck", deck);
  const armed = store.state().active!.recallPlan!;
  advance(60_000); assert.equal(store.learningTick(false), false);
  store.busy(true); assert.equal(store.learningTick(true), false); store.busy(false);
  assert.equal(store.learningTick(true), true); assert.equal(card(store).front, deck.cards[0]!.front);
  store.voice(scope, "correct", "The answer is five");
  assert.equal(store.state().recallAttempts![0]!.intervalMs, 300_000);
  advance(8_000); assert.equal(store.learningTick(true), true);
  assert.equal(store.state().active!.surface!.kind, "whiteboard");
  store.close(); const reopen = new WorkStore(dir, time);
  try {
    assert.equal(reopen.state().active!.recallPlan!.deckId, armed.deckId);
    advance(292_000); assert.equal(reopen.learningTick(true), true);
    assert.equal(card(reopen).back, undefined);
    reopen.voice(scope, "again", "five");
    assert.equal(reopen.state().recallAttempts![1]!.intervalMs, 1_200_000);
    assert.equal(reopen.state().recallAttempts![1]!.method, "exact-reference");
    assert.equal(reopen.state().active!.courseId, "microeconomics");
  } finally { reopen.close(); }
  send({ action: "pause" }); advance(86_400_000);
  assert.equal(store.learningTick(true), false);
});

test("MCQ clicks need no voice, check the authored reference and reject stale/replayed choices", t => {
  const { store, send, advance } = fixture(t, "study"); const scope = store.scope()!;
  store.model(scope, "quiz", quiz);
  const first = card(store);
  assert.equal(first.back, undefined); assert.deepEqual(first.options, ["2", "5", "3"]);
  assert.throws(() => send({ action: "quiz.answer", surfaceId: "old", choiceIndex: 1 }), /no longer/);
  send({ action: "quiz.answer", surfaceId: first.id, choiceIndex: 1 });
  assert.equal(store.state().recallAttempts![0]!.result, "correct");
  assert.equal(store.state().recallAttempts![0]!.input, "choice");
  assert.equal(store.state().recallAttempts![0]!.utteranceId, undefined);
  assert.throws(() => send({ action: "quiz.answer", surfaceId: first.id, choiceIndex: 0 }), /no longer/);
  advance(20_000); assert.equal(store.learningTick(true), false, "MCQs never advance while the student reads the explanation");
  assert.equal(card(store).id, first.id);
  send({ action: "tool.next" }); const second = card(store);
  send({ action: "quiz.answer", surfaceId: second.id, choiceIndex: 1 });
  assert.equal(store.state().recallAttempts![1]!.result, "incorrect");
  send({ action: "tool.next" }); assert.equal(store.state().active!.surface!.kind, "whiteboard");
  assert.equal(store.state().evidence.length, 0);
});

test("timed breaks preserve unanswered cards and resume quietly without invented attempts", t => {
  const { store, send, advance } = fixture(t); const front = card(store).front;
  send({ action: "break.start", durationSeconds: 30 });
  assert.equal(store.state().quiet, true); assert.equal(store.scope(), undefined);
  assert.equal(store.state().active!.surface!.kind, "break");
  assert.throws(() => send({ action: "lesson.begin" }), /microphone/);
  advance(30_000); assert.equal(store.learningTick(false), false);
  assert.equal(store.learningTick(true), true);
  assert.equal(store.state().quiet, false); assert.equal(card(store).front, front);
  assert.equal(card(store).back, undefined); assert.equal(store.state().recallAttempts!.length, 0);
});

test("focus timer schedules a break; ungraded speech and demo checks cannot satisfy mastery", t => {
  const { store, send, advance } = fixture(t, "study");
  store.model(store.scope()!, "deck", { ...deck, cards: [{ ...deck.cards[0], answers: [] }] });
  advance(60_000); store.learningTick(true);
  store.voice(store.scope()!, "open-ended", "I would reason from the budget");
  assert.equal(store.state().recallAttempts![0]!.result, "ungraded");
  advance(25 * 60_000); assert.equal(store.learningTick(true), true);
  assert.equal(store.state().active!.surface!.kind, "break");
  send({ action: "demo", blockId: "review" });
  store.voice(store.scope()!, "demo-answer", "five");
  assert.equal(store.state().recallAttempts!.at(-1)!.demo, true);
  assert.equal(store.state().decks!.at(-1)!.demo, true);
  assert.equal(store.state().goals[0]!.state, "in-progress");
});

test("invalid decks and image sources fail transactionally; model cannot change an unanswered surface", t => {
  const { store } = fixture(t, "study"); const scope = store.scope()!;
  assert.throws(() => store.model(scope, "quiz", { ...quiz, cards: [{ front: "Invalid", back: "No", options: ["A", "B"], correctOption: 9 }] }), /correctOption/);
  assert.equal(store.state().decks!.length, 0);
  assert.throws(() => store.model(scope, "image", { sourceId: "course_exchange", caption: "An image" }), /HTTPS image/);
  store.model(scope, "quiz", quiz);
  assert.throws(() => store.model(scope, "board", { operations: [] }), /Select the whiteboard/);
  assert.throws(() => store.model(scope, "quiz", quiz), /spoken answer/);
});


test("late transcripts cannot answer a different card and read-only image tools stay scoped", t => {
  const { store, send } = fixture(t); const scope = store.scope()!;
  const surfaceId = card(store).id;
  store.voice(scope, "first", "five", surfaceId);
  send({ action: "tool.next" });
  assert.equal(store.voice(scope, "late", "The price is three", surfaceId), undefined);
  assert.equal(store.state().recallAttempts!.length, 1);
  const sourceId = store.receipt(scope, "web_fetch", { url: "https://example.com/diagram.png" }, "Image source");
  store.model(scope, "image", { sourceId, caption: "Exchange economy diagram" });
  assert.equal(store.state().active!.surface!.kind, "image");
});

test("a scheduled break ends the paid voice and never reopens it when its clock expires", async t => {
  const { world, until } = await import("./world.ts");
  const w = world(); t.after(() => w.engine.stop());
  await w.engine.start(); await w.engine.ready();
  const send = (c: Omit<WorkCommand, "requestId">) => w.engine.command({ type: "work.command", command: { ...c, requestId: randomUUID() } });
  await send({ action: "start", mode: "review" }); await send({ action: "lesson.begin" });
  assert.equal(w.live.currentState, "started");
  await send({ action: "break.start", durationSeconds: 30 });
  const expiredScope = { sessionId: w.engine.work.store.state().active!.id, mode: "review" as const };
  const enriched = w.engine.work.enrich({ delegationId: "late", request: "open Safari", dialogue: "", confirmation: false, offsetMs: 0, signal: new AbortController().signal }, expiredScope);
  assert.deepEqual(enriched.work, expiredScope, "a closing lesson cannot become an unrestricted task");
  assert.equal(w.engine.work.isActive(expiredScope), false);
  (w.engine as unknown as { tick(): void }).tick();
  await until(() => w.live.currentState === "closed", 2000);
  w.clock.t += 30_000;
  (w.engine as unknown as { tick(): void }).tick();
  assert.equal(w.live.currentState, "closed");
  assert.equal(w.engine.work.store.state().active!.surface!.kind, "flashcard");
});


test("demo decks cannot reschedule real recall and unsolicited spoken help stays assisted", t => {
  const { store, send } = fixture(t);
  const realDeck = store.state().decks![0]!;
  store.recordSpeech(store.scope()!, "Let me show you the calculation.");
  store.voice(store.scope()!, "helped", "five");
  assert.equal(store.state().recallAttempts![0]!.assisted, true);
  assert.equal(store.state().recallAttempts![0]!.intervalMs, 60_000);
  send({ action: "demo", blockId: "review" });
  assert.throws(() => send({ action: "recall.configure", enabled: true, deckId: realDeck.id }), /real\/demo/);
});


test("saved recall decks automatically arm a new study block, while quiz banks and exam work stay separate", t => {
  const { store, send } = fixture(t, "study"); const scope = store.scope()!;
  store.model(scope, "deck", deck); const savedDeck = store.state().decks![0]!;
  store.model(scope, "quiz", quiz); assert.equal(store.state().decks![1]!.purpose, "quiz");
  send({ action: "start", mode: "study" });
  assert.equal(store.state().active!.recallPlan!.deckId, savedDeck.id);
  send({ action: "recall.configure", enabled: false });
  send({ action: "start", mode: "study" });
  assert.equal(store.state().active!.recallPlan, undefined, "a new study block respects paused recall");
  send({ action: "start", mode: "exam" });
  assert.equal(store.state().active!.recallPlan, undefined, "independent exam work doesn't automatically import recall prompts");
  send({ action: "start", mode: "review" });
  assert.equal(store.state().active!.recallPlan!.deckId, savedDeck.id);
});

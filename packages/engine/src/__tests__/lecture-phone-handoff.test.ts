import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { WorkCommand } from "@hormes/protocol";
import { world, until, tempDir, testConfig } from "./world.ts";
import { WorkStore } from "../work/store.ts";
import { LECTURE_DEMO_QUESTION, LECTURE_DEMO_ANSWER, LECTURE_DEMO_REVIEW, lectureDemoAnswer } from "../work/lecture-phone.ts";

const teacher = "In an exchange economy, people begin with goods, called their endowment. They can trade those goods, so their income is the market value of what they own. Suppose X costs two and Y costs four. We can choose X as our unit of value: divide both prices by two. X now costs one, and Y costs two. We must divide income by two as well. Someone endowed with four units of X has income eight before normalization and four afterward. They can still buy two units of Y. The numbers change; the affordable bundles do not.";
async function fixture(t: { after(fn: () => Promise<void>): void }, demo = true, paired = true) {
  const dir = tempDir("hormes-lecture-phone-");
  const w = world({ config: testConfig(dir, { openaiApiKey: "sk-test-not-used", geminiApiKey: "test-gemini-not-used" }) }, { dir, voiceProvider: "gemini" });
  t.after(() => w.engine.stop());
  let audio = 0; w.engine.on("audio", () => audio++);
  w.engine.work.setPhoneReviewEnabled(() => paired);
  await w.engine.start(); await w.engine.ready();
  const send = (c: Omit<WorkCommand, "requestId"> & { requestId?: string }) => w.engine.command({ type: "work.command", command: { ...c, requestId: c.requestId ?? randomUUID() } });
  await send(demo ? { action: "demo", blockId: "class" } : { action: "start", mode: "class" });
  await send({ action: "lecture.begin" });
  const active = () => w.engine.work.store.state().active!, live = w.lives.at(-1)!;
  const capture = (text: string, at = 1000) => { live.emit("inputTranscript", text, at, at + 600); live.emit("turnEnd", "user"); };
  return { w, dir, send, active, live, capture, audio: () => audio };
}

test("explicit rehearsal answer immediately exports four phone questions, preserving capture and real answer provenance", async t => {
  const f = await fixture(t); f.capture(teacher);
  const before = f.active(), sourceId = before.lecture!.sourceId;
  const captured = f.w.engine.work.store.state().sources.find(s => s.id === sourceId)!.text;
  const command = { action: "lecture.question" as const, requestId: "rehearsal-question", sessionId: before.id, text: LECTURE_DEMO_QUESTION };
  await f.send(command);
  assert.equal(f.active().lecture!.answer!.text, LECTURE_DEMO_ANSWER);
  assert.equal(f.active().lecture!.captureId, before.lecture!.captureId);
  assert.deepEqual(f.active().surface, before.surface);
  assert.equal(f.w.threads.brains.filter(b => b.tasks.length).length, 0, "prepared rehearsal must not pretend a model call");
  const quiz = f.w.engine.work.store.phoneQuiz()!;
  assert.equal(quiz.cards.length, 4); assert.equal(quiz.demo, true);
  assert.deepEqual(quiz.cards.map(c => c.correctOption), [0, 2, 1, 0]);
  assert.equal(f.audio(), 0); assert.equal(f.live.currentState, "started");
  const state = f.w.engine.work.store.state();
  assert.ok(state.observations.some(o => o.text.includes("Preauthored synthetic rehearsal answer")));
  assert.equal(state.sources.find(s => s.id === sourceId)!.text, captured);
  assert.equal(state.evidence.length, 0);
  const answer = { attemptId: randomUUID(), quizId: quiz.id, cardId: quiz.cards[0]!.id, choiceIndex: 0, answeredAt: 1234 };
  f.w.engine.work.store.phoneAnswer(answer, "synthetic-device");
  assert.equal(f.active().lecture!.captureId, before.lecture!.captureId);
  assert.deepEqual(f.active().surface, before.surface);
  assert.equal(f.w.engine.work.store.state().recallAttempts![0]!.demo, true);
  assert.equal(f.w.engine.work.store.state().evidence.length, 0);
  await f.send(command); assert.equal(f.w.engine.work.store.phoneQuiz()!.id, quiz.id);
  const reopened = new WorkStore(f.w.engine.config.stateDir); assert.equal(reopened.phoneQuiz()!.id, quiz.id); assert.equal(reopened.phoneQuiz()!.answers.length, 1); reopened.close();
});

test("prepared answer requires exact question, explicit demo and captured source; unpaired lecture makes no phone pack", async t => {
  assert.equal(lectureDemoAnswer(false, LECTURE_DEMO_QUESTION, teacher), undefined);
  assert.equal(lectureDemoAnswer(true, LECTURE_DEMO_QUESTION, ""), undefined);
  assert.equal(lectureDemoAnswer(true, LECTURE_DEMO_QUESTION, teacher.replace("Y costs four", "Y costs six")), undefined);
  assert.equal(lectureDemoAnswer(true, "Why can we set any price to two?", teacher), undefined);
  assert.equal(lectureDemoAnswer(true, "WHY CAN WE SET THE PRICE OF X TO ONE!", teacher), LECTURE_DEMO_ANSWER);
  const f = await fixture(t, true, false); f.capture(teacher);
  await f.send({ action: "lecture.question", sessionId: f.active().id, text: LECTURE_DEMO_QUESTION });
  assert.equal(f.active().lecture!.answer!.status, "ready"); assert.equal(f.w.engine.work.store.phoneQuiz(), null);
});

test("ordinary question uses bounded silent model review against a frozen source while capture continues", async t => {
  const f = await fixture(t, false); f.capture(teacher);
  const before = f.active();
  const captured = f.w.engine.work.store.state().sources.find(s => s.id === before.lecture!.sourceId)!.text;
  const asking = f.send({ action: "lecture.question", sessionId: before.id, text: "What determines income here?" });
  await until(() => f.w.threads.brains.some(b => b.tasks.length));
  const brain = f.w.threads.brains.find(b => b.tasks.length)!;
  brain.resolve!({ status: "done", summary: "Income is the market value of the endowment." });
  await until(() => brain.tasks.length === 2);
  assert.equal(f.active().lecture!.answer!.status, "ready");
  const snapshot = JSON.parse(brain.tasks[1]!.workContext!);
  assert.equal(snapshot.text, captured); assert.equal(snapshot.revision, 1);
  assert.equal(brain.tasks[1]!.signal, brain.tasks[0]!.signal);
  f.capture("The teacher continues with a new topic.", 3000);
  brain.sink!.commentary("This JSON must never be spoken or displayed.");
  brain.resolve!({ status: "done", summary: JSON.stringify(LECTURE_DEMO_REVIEW) }); await asking;
  const quiz = f.w.engine.work.store.phoneQuiz()!; assert.equal(quiz.cards.length, 4); assert.equal(quiz.demo, false);
  const state = f.w.engine.work.store.state(), deck = state.decks!.find(d => d.id === quiz.deckId)!;
  assert.equal(state.sources.find(s => s.id === deck.sourceIds[0])!.text, captured, "later capture does not rewrite review provenance");
  assert.equal(f.active().lecture!.revision, 2); assert.equal(f.active().lecture!.captureId, before.lecture!.captureId);
  assert.equal(f.active().lecture!.answer!.text, "Income is the market value of the endowment.");
  assert.equal(f.audio(), 0); assert.equal(state.evidence.length, 0);
});

test("invalid generated review leaves the written answer intact and sends no quiz", async t => {
  const f = await fixture(t, false); f.capture(teacher);
  const asking = f.send({ action: "lecture.question", sessionId: f.active().id, text: "Explain income" });
  await until(() => f.w.threads.brains.some(b => b.tasks.length)); const brain = f.w.threads.brains.find(b => b.tasks.length)!;
  brain.resolve!({ status: "done", summary: "It is the market value of the endowment." }); await until(() => brain.tasks.length === 2);
  brain.resolve!({ status: "done", summary: JSON.stringify({ ...LECTURE_DEMO_REVIEW, cards: LECTURE_DEMO_REVIEW.cards.slice(0, 3) }) }); await asking;
  assert.equal(f.active().lecture!.answer!.status, "ready"); assert.equal(f.active().lecture!.status, "recording");
  assert.equal(f.w.engine.work.store.phoneQuiz(), null); assert.equal(f.w.engine.work.store.state().decks!.length, 0);
});

test("pausing during phone preparation cancels late output without invalidating the ready answer", async t => {
  const f = await fixture(t, false); f.capture(teacher);
  const asking = f.send({ action: "lecture.question", sessionId: f.active().id, text: "Explain this endowment" });
  await until(() => f.w.threads.brains.some(b => b.tasks.length)); const brain = f.w.threads.brains.find(b => b.tasks.length)!;
  brain.resolve!({ status: "done", summary: "These are the goods initially owned." }); await until(() => brain.tasks.length === 2);
  await f.send({ action: "lecture.pause" }); await asking;
  assert.equal(brain.tasks[1]!.signal.aborted, true);
  assert.equal(f.active().lecture!.answer!.status, "ready"); assert.equal(f.w.engine.work.store.phoneQuiz(), null);
});

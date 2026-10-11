import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { GeminiSession, type WebSocketLike } from "@hormes/live";
import type { WorkCommand } from "@hormes/protocol";
import { world, testConfig, tempDir } from "./world.ts";
import { LESSON_OPENING } from "../work/store.ts";

class Socket implements WebSocketLike {
  readyState = 0;
  sent: Record<string, any>[] = [];
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  send(text: string): void { this.sent.push(JSON.parse(text)); }
  close(): void { this.readyState = 3; this.onclose?.({ code: 1000, reason: "" }); }
  open(): void { this.readyState = 1; this.onopen?.({}); this.receive({ setupComplete: {} }); }
  receive(message: unknown): void { this.onmessage?.({ data: JSON.stringify(message) }); }
}
function speech(text: string, marker = 7) {
  return { outputTranscription: { text }, modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: Buffer.alloc(480, marker).toString("base64") } }] } };
}
async function fixture(t: { after(fn: () => void | Promise<void>): void }) {
  const dir = tempDir("hormes-learning-voice-gate-");
  const sessions: GeminiSession[] = [], sockets: Socket[] = [], wireAudio: Buffer[] = [], wireText: string[] = [];
  const w = world({ config: testConfig(dir, { geminiApiKey: "test-gemini-only", openaiApiKey: undefined }),
    makeLive: config => {
      const session = new GeminiSession({ apiKey: "test-gemini-only", config, webSocketFactory: () => {
        const socket = new Socket(); sockets.push(socket); queueMicrotask(() => socket.open()); return socket;
      } });
      sessions.push(session); session.on("audio", pcm => wireAudio.push(pcm)); session.on("outputTranscript", text => wireText.push(text)); return session;
    },
  }, { dir, voiceProvider: "gemini" });
  t.after(() => w.engine.stop());
  await w.engine.start(); await w.engine.ready();
  const send = (command: Omit<WorkCommand, "requestId">) => w.engine.command({ type: "work.command", command: { ...command, requestId: randomUUID() } });
  const current = () => w.engine.work.store.state().active!;
  const socket = () => sockets.at(-1)!;
  const begin = async () => {
    await send({ action: "lesson.begin", sessionId: current().id });
    const plan = current().pendingPlan;
    if (plan) await send({ action: "board.applied", sessionId: current().id, planId: plan.id, success: true });
    socket().receive({ serverContent: { ...speech(LESSON_OPENING), turnComplete: true } });
    w.audio.length = 0; wireAudio.length = 0; wireText.length = 0;
  };
  return { w, send, current, socket, begin, sessions, sockets, wireAudio, wireText };
}

test("production Engine and GeminiSession route normal learning discussion through the fake socket", async t => {
  const { w, send, current, socket, begin, wireAudio, wireText } = await fixture(t);
  await send({ action: "start", mode: "study" }); await begin();
  socket().receive({ serverContent: { inputTranscription: { text: "Could you explain the budget convention?", finished: true }, ...speech("The chosen numeraire sets the units."), turnComplete: true } });
  assert.equal(w.engine.work.store.state().evidence.length, 0);
  assert.ok(w.engine.work.store.state().observations.some(o => o.kind === "question" && o.sessionId === current().id));
  assert.deepEqual(wireText, [], "the unchecked raw response is drained even for discussion");
  assert.equal(wireAudio.length, 0); assert.equal(w.audio.length, 0);
  socket().receive({ serverContent: { ...speech("The chosen numeraire sets the units."), turnComplete: true } });
  assert.deepEqual(wireText, ["The chosen numeraire sets the units."]);
  assert.equal(wireAudio.length, 1); assert.equal(w.audio.length, 1);
});

test("quiz discussion and custom ungraded boards do not become numeric answer checks", async t => {
  const { w, send, current, socket, begin, wireText } = await fixture(t);
  await send({ action: "start", mode: "study" });
  w.engine.work.store.model(w.engine.work.store.scope()!, "quiz", {
    title: "Price convention", sourceIds: current().sourceIds,
    cards: [{ front: "Which good is the numeraire?", back: "x is normalized to one.", options: ["x", "y"], correctOption: 0 }],
  });
  await begin();
  socket().receive({ serverContent: { inputTranscription: { text: "My answer is one.", finished: true }, ...speech("Choose an option when ready."), turnComplete: true } });
  assert.equal(w.engine.work.store.state().evidence.length, 0);
  assert.equal(w.engine.work.store.state().recallAttempts!.length, 0);
  const quiz = current().surface!; assert.equal(quiz.kind, "quiz");
  if (quiz.kind !== "quiz") throw new Error("Expected quiz");
  assert.equal(quiz.back, undefined);
  assert.deepEqual(wireText, ["Choose an option when ready."]);
  await send({ action: "goal.create", goalInput: { title: "Monopoly discussion", outcome: "Understand a new monopoly case", kind: "learning", courseId: "microeconomics", criteria: ["Explain a case without hints"] } });
  const custom = w.engine.work.store.state().goals.find(g => g.assessment === "user-review")!;
  await send({ action: "start", mode: "study", goalId: custom.id }); await begin();
  assert.equal(current().exercise, undefined);
  socket().receive({ serverContent: { inputTranscription: { text: "My answer is eight over nine.", finished: true }, ...speech("What does that quantity describe?"), turnComplete: true } });
  assert.equal(w.engine.work.store.state().evidence.length, 0);
  assert.deepEqual(wireText, ["What does that quantity describe?"]);
});

test("an explicit hint remains conversational and lecture capture stays silent and ungraded", async t => {
  const { w, send, current, socket, begin, wireText, sessions } = await fixture(t);
  await send({ action: "start", mode: "study" });
  await send({ action: "education.practice", goalId: current().goalId, sessionId: current().id, skillId: "fractions" }); await begin();
  socket().receive({ serverContent: { inputTranscription: { text: "I need a hint.", finished: true }, ...speech("Try multiplying by the reciprocal."), turnComplete: true } });
  assert.equal(w.engine.work.store.state().evidence.length, 0);
  assert.ok(w.engine.work.store.state().observations.some(o => o.kind === "action" && o.text === "Student requested a hint"));
  assert.deepEqual(wireText, [], "an unrequested provider continuation is not a completed backend hint");
  sessions.at(-1)!.appendCommentary(null, "Try multiplying by the reciprocal.");
  socket().receive({ serverContent: { ...speech("Try multiplying by the reciprocal."), turnComplete: true } });
  assert.deepEqual(wireText, ["Try multiplying by the reciprocal."]);
  await send({ action: "start", mode: "class" }); await send({ action: "lecture.begin" });
  w.audio.length = 0;
  socket().receive({ serverContent: { inputTranscription: { text: "My answer is eight over nine.", finished: true }, ...speech("This must not play during capture."), turnComplete: true } });
  assert.equal(w.engine.work.store.state().evidence.length, 0);
  assert.equal(w.audio.length, 0);
  assert.ok(w.engine.work.store.state().sources.some(s => s.kind === "lecture" && s.text.includes("eight over nine")));
});


const checkedInstructions = (socket: Socket) => socket.sent.filter(message => typeof message.realtimeInput?.text === "string" && message.realtimeInput.text.includes("Application check of the student's actual spoken attempt"));

test("Engine persists the actual spoken check before any feedback and drains stale combined-frame audio", async t => {
  const { w, send, current, socket, begin, wireAudio, wireText } = await fixture(t);
  await send({ action: "start", mode: "study" });
  await send({ action: "education.practice", goalId: current().goalId, sessionId: current().id, skillId: "fractions" }); await begin();
  socket().receive({ serverContent: { inputTranscription: { text: "My answer is one.", finished: true }, ...speech("Correct, one is the answer.", 1) } });
  const evidence = w.engine.work.store.state().evidence;
  assert.equal(evidence.length, 1); assert.equal(evidence[0]!.correct, false); assert.equal(evidence[0]!.answer, "1");
  assert.equal(evidence[0]!.assistance, "independent");
  assert.equal(w.audio.length, 0); assert.equal(wireAudio.length, 0); assert.deepEqual(wireText, []);
  assert.equal(checkedInstructions(socket()).length, 0, "feedback must not race the raw response");
  socket().receive({ serverContent: { ...speech("Another unchecked conclusion.", 2), turnComplete: true } });
  assert.equal(w.audio.length, 0); assert.deepEqual(wireText, []);
  const checks = checkedInstructions(socket()); assert.equal(checks.length, 1);
  assert.match(checks[0]!.realtimeInput.text, /does not satisfy this problem/);
  socket().receive({ serverContent: { ...speech("That value does not satisfy this problem.", 3), turnComplete: true } });
  assert.deepEqual(wireText, ["That value does not satisfy this problem."]);
  assert.equal(w.audio.length, 1); assert.equal(wireAudio.length, 1);
  assert.ok(w.audio[0]!.every(byte => byte === 3), "only the fresh checked-response PCM reaches output");
  assert.equal(checkedInstructions(socket()).length, 1);
  assert.equal(w.engine.work.store.state().evidence.length, 1);
  const saved = w.engine.work.store.state().evidence; w.engine.work.store.close();
  assert.deepEqual(w.engine.work.store.state().evidence, saved, "actual check survives reopening SQLite");
});

test("partial transcript blocks provider PCM until the final answer is checked", async t => {
  const { w, send, current, socket, begin, wireText } = await fixture(t);
  await send({ action: "start", mode: "study" });
  await send({ action: "education.practice", goalId: current().goalId, sessionId: current().id, skillId: "fractions" }); await begin();
  socket().receive({ serverContent: { inputTranscription: { text: "My answer is ", finished: false }, ...speech("Correct before hearing the answer.", 1) } });
  assert.equal(w.audio.length, 0); assert.deepEqual(wireText, []); assert.equal(w.engine.work.store.state().evidence.length, 0);
  socket().receive({ serverContent: { inputTranscription: { text: "eight over nine.", finished: true }, ...speech("Incorrect before checking.", 2), turnComplete: true } });
  assert.equal(w.audio.length, 0); assert.deepEqual(wireText, []);
  const evidence = w.engine.work.store.state().evidence;
  assert.equal(evidence.length, 1); assert.equal(evidence[0]!.correct, true); assert.equal(evidence[0]!.answer, "8/9");
  assert.equal(checkedInstructions(socket()).length, 1);
  socket().receive({ serverContent: { ...speech("Correct numeric result, independently.", 3), turnComplete: true } });
  assert.equal(w.audio.length, 1); assert.deepEqual(wireText, ["Correct numeric result, independently."]);
});

test("a changed learning surface or session cannot release queued feedback into new work", async t => {
  const { w, send, current, socket, begin, wireText } = await fixture(t);
  await send({ action: "start", mode: "study" });
  await send({ action: "education.practice", goalId: current().goalId, sessionId: current().id, skillId: "fractions" }); await begin();
  socket().receive({ serverContent: { inputTranscription: { text: "My answer is one.", finished: true } } });
  assert.equal(w.engine.work.store.state().evidence.length, 1);
  w.engine.work.store.model(w.engine.work.store.scope()!, "quiz", {
    title: "Fraction review", sourceIds: current().sourceIds,
    cards: [{ front: "What should you invert?", back: "The divisor.", options: ["Divisor", "Dividend"], correctOption: 0 }],
  });
  w.engine.work.publish(); // Coordinator publishes every real model surface change.
  socket().receive({ serverContent: { ...speech("Stale whiteboard conclusion.", 1), turnComplete: true } });
  assert.equal(w.audio.length, 0); assert.deepEqual(wireText, []); assert.equal(checkedInstructions(socket()).length, 0);
  socket().receive({ serverContent: { inputTranscription: { text: "Can I choose now?", finished: true }, ...speech("Yes, click an option.", 2), turnComplete: true } });
  assert.deepEqual(wireText, ["Yes, click an option."]);
  await send({ action: "education.practice", goalId: current().goalId, sessionId: current().id, skillId: "fractions" }); await begin();
  const stale = socket();
  stale.receive({ serverContent: { inputTranscription: { text: "My answer is one.", finished: true } } });
  const evidenceCount = w.engine.work.store.state().evidence.length;
  await send({ action: "start", mode: "meeting" });
  w.audio.length = 0; wireText.length = 0;
  stale.receive({ serverContent: { ...speech("Stale prior lesson feedback.", 3), turnComplete: true } });
  assert.equal(w.audio.length, 0); assert.deepEqual(wireText, []);
  assert.equal(checkedInstructions(stale).length, 0);
  assert.equal(w.engine.work.store.state().evidence.length, evidenceCount);
  assert.equal(current().mode, "meeting");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { WorkCommand, WorkReply } from "@hormes/protocol";
import { world, until } from "./world.ts";

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const w = world(); t.after(() => w.engine.stop());
  const replies: WorkReply[] = [];
  w.engine.on("event", e => { if (e.type === "work.state") replies.push(e.reply); });
  await w.engine.start(); await w.engine.ready();
  const send = async (c: Omit<WorkCommand, "requestId"> & { requestId?: string }) => {
    const requestId = c.requestId ?? randomUUID();
    await w.engine.command({ type: "work.command", command: { ...c, requestId } });
    return replies.findLast(r => r.requestId === requestId)!;
  };
  const active = () => w.engine.work.store.state().active!;
  await send({ action: "start", mode: "exam" });
  return { w, send, active, original: active() };
}

test("invalid and capture-blocked Education commands preserve the live lecture and its transcript", async t => {
  const { w, send, active, original } = await fixture(t);
  await send({ action: "start", mode: "class" }); await send({ action: "lecture.begin" });
  const capture = active(), live = w.lives.at(-1)!;
  const cancels = w.brain.cancels;
  live.emit("inputTranscript", "The endowment is valued at current relative prices.", 0, 800);
  for (const goalId of ["missing", original.goalId]) {
    const reply = await send({ action: "education.practice", goalId, sessionId: original.id, skillId: "fractions" });
    assert.equal(reply.ok, false);
    assert.equal(active().id, capture.id);
    assert.equal(active().lecture!.status, "recording");
    assert.equal(active().lecture!.captureId, capture.lecture!.captureId);
    assert.equal(live.currentState, "started"); assert.equal(w.brain.cancels, cancels);
  }
  live.emit("turnEnd", "user");
  assert.match(w.engine.work.store.state().sources.find(s => s.id === capture.lecture!.sourceId)!.text, /endowment is valued/);
});

test("Education also preserves an explicitly recording meeting until capture is paused", async t => {
  const { w, send, active, original } = await fixture(t);
  await send({ action: "start", mode: "meeting" }); await send({ action: "meeting.begin" });
  const meeting = active(), live = w.lives.at(-1)!;
  const reply = await send({ action: "education.practice", goalId: original.goalId, sessionId: original.id, skillId: "fractions" });
  assert.equal(reply.ok, false); assert.equal(active().id, meeting.id);
  assert.equal(active().meeting!.status, "recording"); assert.equal(live.currentState, "started");
});

test("a stale Education return cannot close a newer lesson microphone", async t => {
  const { w, send, active, original } = await fixture(t);
  await send({ action: "education.practice", goalId: original.goalId, sessionId: original.id, skillId: "fractions" });
  const old = active();
  await send({ action: "start", mode: "exam" }); await send({ action: "lesson.begin" });
  const current = active(), live = w.lives.at(-1)!, cancels = w.brain.cancels;
  const reply = await send({ action: "education.return", sessionId: old.id });
  assert.equal(reply.ok, false); assert.equal(active().id, current.id);
  assert.equal(live.currentState, "started"); assert.equal(w.brain.cancels, cancels);
});

test("an Education replay or request-ID collision cannot close current voice", async t => {
  const { w, send, active, original } = await fixture(t);
  const command = { action: "education.practice", goalId: original.goalId, sessionId: original.id, skillId: "fractions", requestId: "one-practice" } as const;
  await send(command); const foundation = active();
  await send({ action: "lesson.begin" }); const live = w.lives.at(-1)!;
  const cancels = w.brain.cancels;
  assert.equal((await send(command)).ok, true);
  assert.equal(active().id, foundation.id); assert.equal(live.currentState, "started");
  assert.equal((await send({ ...command, skillId: "ratios" })).ok, false);
  assert.equal(active().id, foundation.id); assert.equal(live.currentState, "started");
  assert.equal(w.brain.cancels, cancels);
});

test("a replayed Education command cannot cancel newer in-flight work", async t => {
  const { w, send, active, original } = await fixture(t);
  const command = { action: "education.practice", goalId: original.goalId, sessionId: original.id, skillId: "fractions", requestId: "saved-practice" } as const;
  await send(command); const foundation = active();
  const running = w.engine.work.command({ action: "ask", text: "Explain this prerequisite", requestId: "newer-work" });
  await until(() => w.threads.brains.some(brain => brain.tasks.length > 0), 3000);
  const brain = w.threads.brains.find(brain => brain.tasks.length > 0);
  try {
    assert.ok(brain, "the newer work reached its isolated fake brain");
    const cancels = brain.cancels;
    await send(command);
    assert.equal(brain.cancels, cancels); assert.equal(w.engine.work.store.state().busy, true);
    assert.equal(active().id, foundation.id);
  } finally { brain?.resolve?.({ status: "done", summary: "Try the reciprocal." }); await w.engine.work.cancel(); await running; }
});

test("a fresh Education transition saves the settled old attempt before switching and then closes old voice", async t => {
  const { w, send, active, original } = await fixture(t);
  await send({ action: "lesson.begin" }); const live = w.lives.at(-1)!;
  w.clock.t += 40_000; live.nowMs = 40_000;
  live.emit("inputTranscript", "the price is nine", 40_000, 40_500);
  assert.equal(w.engine.work.store.state().evidence.length, 0, "the utterance is still open");
  const reply = await send({ action: "education.practice", goalId: original.goalId, sessionId: original.id, skillId: "fractions" });
  assert.equal(reply.ok, true); assert.equal(active().exercise!.kind, "foundation");
  assert.equal(live.currentState, "closed");
  const evidence = w.engine.work.store.state().evidence;
  assert.equal(evidence.length, 1); assert.equal(evidence[0]!.sessionId, original.id);
  assert.equal(evidence[0]!.answer, "9"); assert.equal(evidence[0]!.correct, false);
});

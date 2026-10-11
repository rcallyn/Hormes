import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { WorkCommand, WorkReply } from "@hormes/protocol";
import { world, until } from "./world.ts";

const nativeNote = "HORMES_SELECTED_NOTE_V1\nx-coredata://synthetic/Note/p1\n2026-10-11\nSynthetic tasks\nSynthetic tasks\nReview exchange economies";
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
  await send({ action: "start", mode: "exam" });
  const active = () => w.engine.work.store.state().active!;
  const original = active();
  w.engine.work.store.importTasks({ action: "tasks.import", requestId: "synthetic-import" }, nativeNote);
  const task = () => w.engine.work.store.state().tasks![0]!;
  const start = (requestId: string = randomUUID()): WorkCommand => ({ action: "tasks.start", requestId, taskId: task().id, expectedTaskVersion: task().version, mode: "study", courseId: original.courseId! });
  return { w, send, active, original, task, start };
}

test("invalid or stale task start leaves the active tutor and unfinished student transcript intact", async t => {
  const { w, send, active, original, start } = await fixture(t);
  await send({ action: "lesson.begin" });
  const live = w.lives.at(-1)!, cancels = w.brain.cancels;
  w.clock.t += 40_000; live.nowMs = 40_000;
  live.emit("inputTranscript", "the price is nine", 40_000, 40_500);
  for (const command of [{ ...start(), taskId: "missing" }, { ...start(), expectedTaskVersion: 99 }]) {
    const reply = await send(command);
    assert.equal(reply.ok, false); assert.equal(reply.presentation, undefined);
    assert.equal(active().id, original.id); assert.equal(live.currentState, "started");
    assert.equal(w.brain.cancels, cancels); assert.equal(w.engine.work.store.state().evidence.length, 0);
  }
  live.emit("turnEnd", "user");
  assert.equal(w.engine.work.store.state().evidence.at(-1)!.answer, "9", "original speech was preserved until its real end");
});

for (const mode of ["class", "meeting"] as const) test(`task start cannot interrupt a recording ${mode}`, async t => {
  const { w, send, active, start } = await fixture(t);
  await send({ action: "start", mode });
  await send({ action: mode === "class" ? "lecture.begin" : "meeting.begin" });
  const capture = active(), live = w.lives.at(-1)!, cancels = w.brain.cancels;
  const sourceId = mode === "class" ? capture.lecture!.sourceId : capture.meeting!.sourceId;
  live.emit("inputTranscript", "This synthetic recording must stay intact.", 0, 800);
  const reply = await send(start());
  assert.equal(reply.ok, false); assert.equal(active().id, capture.id);
  assert.equal(live.currentState, "started"); assert.equal(w.brain.cancels, cancels);
  assert.equal(mode === "class" ? active().lecture!.status : active().meeting!.status, "recording");
  live.emit("turnEnd", "user");
  assert.match(w.engine.work.store.state().sources.find(s => s.id === sourceId)!.text, /synthetic recording must stay intact/);
});

test("task replay and request collision cannot close newer lesson voice or change its active work", async t => {
  const { w, send, active, start } = await fixture(t);
  const command = start("one-task-start");
  assert.equal((await send(command)).ok, true);
  await send({ action: "start", mode: "exam" }); await send({ action: "lesson.begin" });
  const newer = active(), live = w.lives.at(-1)!, cancels = w.brain.cancels;
  const replay = await send(command);
  assert.equal(replay.ok, true); assert.equal(replay.presentation, undefined);
  assert.equal((await send({ ...command, mode: "meeting" })).ok, false);
  assert.equal(active().id, newer.id); assert.equal(live.currentState, "started");
  assert.equal(w.brain.cancels, cancels);
});

test("replayed task start cannot cancel a newer in-flight scoped request", async t => {
  const { w, send, active, start } = await fixture(t);
  const command = start("saved-task-start"); await send(command);
  const linked = active();
  const running = w.engine.work.command({ action: "ask", text: "Explain this source concept", requestId: "newer-work" });
  await until(() => w.threads.brains.some(brain => brain.tasks.length > 0), 3000);
  const brain = w.threads.brains.find(brain => brain.tasks.length > 0);
  try {
    assert.ok(brain); const cancels = brain.cancels;
    await send(command);
    assert.equal(brain.cancels, cancels); assert.equal(w.engine.work.store.state().busy, true);
    assert.equal(active().id, linked.id);
  } finally { brain?.resolve?.({ status: "done", summary: "The original task is saved." }); await w.engine.work.cancel(); await running; }
});

test("fresh task start saves the old attempt and opens linked work only after old tutor cleanup", async t => {
  const { w, send, active, original, task, start } = await fixture(t);
  await send({ action: "lesson.begin" }); const live = w.lives.at(-1)!;
  w.clock.t += 40_000; live.nowMs = 40_000;
  live.emit("inputTranscript", "the price is nine", 40_000, 40_500);
  const command = start("fresh-task"); let publishedAfterCleanup = false;
  w.engine.on("event", e => {
    if (e.type === "work.state" && e.reply.requestId === command.requestId && e.reply.ok) {
      publishedAfterCleanup = live.currentState === "closed" && e.reply.state.active?.id === task().sessionId;
    }
  });
  const reply = await send(command);
  assert.equal(reply.ok, true); assert.equal(reply.presentation, "open"); assert.equal(publishedAfterCleanup, true);
  assert.equal(active().id, task().sessionId); assert.equal(task().status, "in-progress");
  const evidence = w.engine.work.store.state().evidence;
  assert.equal(evidence.length, 1); assert.equal(evidence[0]!.sessionId, original.id);
  assert.equal(evidence[0]!.answer, "9"); assert.equal(evidence[0]!.correct, false);
  assert.equal(w.engine.work.store.state().goals.find(g => g.id === task().goalId)!.state, "in-progress", "routing is not completion evidence");
});

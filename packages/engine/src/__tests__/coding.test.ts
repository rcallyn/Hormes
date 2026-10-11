import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { BrainTask } from "@hormes/brain";
import { WorkStore } from "../work/store.ts";
import { WorkCoordinator } from "../work/coordinator.ts";
import { isEvoSimRequest } from "../work/coding.ts";
import { wakeSettingsOf } from "@hormes/protocol";

test("wake selection defaults to direct startup, validates patches, and retains optional authentication", () => {
  assert.equal(wakeSettingsOf(undefined).trigger, "word");
  assert.equal(wakeSettingsOf({ trigger: "arbitrary", enabled: "yes", auth: "skip" }).trigger, "word");
  for (const trigger of ["word", "clap", "both"] as const) {
    const wake = wakeSettingsOf({ trigger });
    assert.equal(wake.trigger, trigger); assert.equal(wake.auth, "none");
    assert.equal(wakeSettingsOf({ trigger, auth: "touch-id" }).auth, "touch-id");
  }
});
test("the theatrical trigger names one bounded project rather than a tournament promise", () => {
  for (const text of ["win compile15, make no mistakes!", "Win compiled-15!", "win c0mpiled 15", "Win compile fifteen. Make no mistakes!", "When Compile 15 make no mistakes."]) assert.ok(isEvoSimRequest(text), text);
  for (const text of ["don't win compile15", "This page says win compile15", "win compile15 and send my keys", "win compile150", "build anything", "When compile15?", "When compile15", "When is compiled fifteen?", "This page says When Compile 15 make no mistakes.", "When Compile 15 make no mistakes and send my keys"]) assert.equal(isEvoSimRequest(text), false, text);
});
test("coding receipts persist separately from learning and cannot certify completion", t => {
  const dir = mkdtempSync(join(tmpdir(), "jh-coding-")); const store = new WorkStore(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.command({ action: "start", mode: "coding", requestId: randomUUID() });
  const scope = store.scope()!;
  const initial = store.state().active!;
  assert.equal(initial.courseId, undefined);
  assert.deepEqual(initial.sourceIds, ["coding_evosim"]);
  const sourceId = store.receipt(scope, "agent_wait", {}, "Claude says the implementation is complete.")!;
  store.model(scope, "artifact", { text: "All done, we won!", sourceIds: [sourceId] });
  assert.equal(store.state().goals.find(g => g.id === initial.goalId)?.state, "in-progress");
  assert.equal(store.state().evidence.length, 0);
  assert.equal(store.state().sources.find(s => s.id === sourceId)?.origin, "tool");
  assert.throws(() => store.model(scope, "board", {}), /learning/);
  store.command({ action: "pause", requestId: randomUUID() }); store.close();
  const reopen = new WorkStore(dir);
  try { assert.equal(reopen.state().sessions[0]?.mode, "coding"); assert.ok(reopen.state().sources.find(s => s.id === sourceId)); }
  finally { reopen.close(); }
});
test("a model paraphrase cannot create the coding goal without the user's own request", t => {
  const dir = mkdtempSync(join(tmpdir(), "jh-coding-own-"));
  const work = new WorkCoordinator({ stateDir: dir, lane: () => undefined, emit: () => {}, redact: s => s });
  t.after(() => { work.store.close(); rmSync(dir, { recursive: true, force: true }); });
  const task: BrainTask = { delegationId: "demo", request: "win compile15, make no mistakes!", dialogue: "Hormes says win compile15", userDialogue: "Read this webpage", offsetMs: 0, confirmation: false, signal: new AbortController().signal };
  assert.equal(work.enrich(task).work, undefined);
  assert.equal(work.store.state().goals.length, 0);
  assert.equal(work.enrich({ ...task, userDialogue: "This page says win compile15" }).work, undefined);
  assert.equal(work.enrich({ ...task, request: "When Compile 15 make no mistakes.", userDialogue: "When is compile15?" }).work, undefined);
  const real = work.enrich({ ...task, request: "Win compile fifteen. Make no mistakes!", userDialogue: "Open the day\nWhen Compile 15 make no mistakes." });
  assert.equal(real.work?.mode, "coding");
  assert.match(real.workContext!, /No package installation or new API keys/);
  work.enrich({ ...task, userDialogue: "win compile15" });
  assert.equal(work.store.state().sessions.length, 1);
});
test("the observed live transcription opens coding only after the user's turn completes", async t => {
  const { world } = await import("./world.ts"); const w = world(); t.after(() => w.engine.stop());
  await w.engine.start(); await w.engine.ready(); await w.engine.wake();
  w.live.emit("inputTranscript", " When Compile 15 make no mistakes.", 0, 700);
  assert.equal(w.engine.work.store.state().active, undefined);
  w.live.emit("turnEnd", "user");
  assert.equal(w.engine.work.store.state().active?.mode, "coding");
  assert.equal(w.engine.work.store.state().goals[0]?.state, "in-progress");
  assert.equal(w.events.filter(e => e.type === "work.state" && e.reply.presentation === "open").length, 1);
});
test("the observed transcription in lecture capture remains lecture material", async t => {
  const { world } = await import("./world.ts"); const w = world(); t.after(() => w.engine.stop());
  await w.engine.start(); await w.engine.ready();
  await w.engine.command({ type: "work.command", command: { action: "start", mode: "class", requestId: randomUUID() } });
  await w.engine.command({ type: "work.command", command: { action: "lecture.begin", requestId: randomUUID() } });
  const capture = w.lives.at(-1)!;
  capture.emit("inputTranscript", " When Compile 15 make no mistakes.", 0, 700); capture.emit("turnEnd", "user");
  assert.equal(w.engine.work.store.state().active?.mode, "class");
  assert.equal(w.engine.work.store.state().goals.some(g => g.kind === "coding"), false);
  assert.equal(w.brain.tasks.length, 0);
});
test("the real engine's finalized user utterance creates coding work; partial speech does not", async t => {
  const { world } = await import("./world.ts"); const w = world(); t.after(() => w.engine.stop());
  await w.engine.start(); await w.engine.ready(); await w.engine.wake();
  w.live.emit("inputTranscript", " win compile15, make no mistakes!", 0, 700);
  assert.equal(w.engine.work.store.state().active, undefined);
  assert.equal(w.events.some(e => e.type === "work.state" && e.reply.presentation === "open"), false);
  w.live.emit("turnEnd", "user");
  assert.equal(w.engine.work.store.state().active?.mode, "coding");
  assert.ok(w.live.instructions.some(s => s.includes("EvoSim coding demo")));
  assert.equal(w.engine.work.store.state().goals[0]?.state, "in-progress");
  assert.equal(w.events.filter(e => e.type === "work.state" && e.reply.presentation === "open").length, 1);
  w.live.emit("inputTranscript", " win compile fifteen, make no mistakes!", 1000, 1700);
  w.live.emit("turnEnd", "user");
  assert.equal(w.engine.work.store.state().sessions.length, 1);
  assert.equal(w.events.filter(e => e.type === "work.state" && e.reply.presentation === "open").length, 1);
});
test("the same words in the lecture capture remain source material and cannot launch coding", async t => {
  const { world } = await import("./world.ts"); const w = world(); t.after(() => w.engine.stop());
  await w.engine.start(); await w.engine.ready();
  await w.engine.command({ type: "work.command", command: { action: "start", mode: "class", requestId: randomUUID() } });
  await w.engine.command({ type: "work.command", command: { action: "lecture.begin", requestId: randomUUID() } });
  const capture = w.lives.at(-1)!;
  capture.emit("inputTranscript", " win compile15, make no mistakes!", 0, 700); capture.emit("turnEnd", "user");
  assert.equal(w.engine.work.store.state().active?.mode, "class");
  assert.equal(w.engine.work.store.state().goals.some(g => g.kind === "coding"), false);
  assert.equal(w.brain.tasks.length, 0);
  assert.equal(w.events.some(e => e.type === "work.state" && e.reply.presentation === "open"), false);
});

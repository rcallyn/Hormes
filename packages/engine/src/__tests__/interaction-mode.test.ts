import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { WorkCommand } from "@hormes/protocol";
import { world, testConfig, tempDir } from "./world.ts";
import { makeTask } from "../../../brain/src/__tests__/fakes.ts";
import { delegationPrompt } from "../../../brain/src/anthropic.ts";

for (const provider of ["openai", "gemini"] as const) test(`${provider}: saved learning is general, explicit Sage starts education, close and wake return to general`, async t => {
  const dir = tempDir("hormes-interaction-mode-");
  const w = world({ config: testConfig(dir, { geminiApiKey: "test-only", openaiApiKey: "test-only" }) }, { dir, voiceProvider: provider });
  t.after(() => w.engine.stop()); await w.engine.start(); await w.engine.ready();
  const send = (command: Omit<WorkCommand, "requestId">) => w.engine.command({ type: "work.command", command: { ...command, requestId: randomUUID() } });
  const config = () => w.lives.at(-1)!.config!;
  await send({ action: "start", mode: "study" }); await send({ action: "pause" });
  await w.engine.go();
  assert.equal(config().interactionMode, "general");
  assert.match(config().instructions!, /General mode:/);
  assert.doesNotMatch(config().instructions!, /teach one step|# Current learning tool|# Course discussion/);
  const goal = w.engine.work.store.state().goals.find(g => g.kind === "learning")!;
  await send({ action: "start", mode: "study", goalId: goal.id });
  const general = w.lives.at(-1)!;
  const inactive = w.engine.work.enrich(makeTask("What is on my calendar today?"));
  assert.equal(inactive.interactionMode, "general");
  assert.doesNotMatch(delegationPrompt(inactive), /Teach by voice|Give one small step|work\.board/);
  await send({ action: "lesson.begin" });
  assert.notEqual(w.lives.at(-1), general, "entering Sage replaces the general system prompt");
  assert.equal(general.currentState, "closed");
  assert.equal(config().interactionMode, "education");
  assert.match(config().instructions!, /Education mode: teach one step/);
  assert.match(config().instructions!, /# Current learning tool/);
  const active = w.engine.work.enrich(makeTask("Give one hint"), w.engine.work.store.scope());
  assert.equal(active.interactionMode, "education"); assert.match(delegationPrompt(active), /Give one small step/);
  // Native/browser Close flushes the board and sends this same pause command.
  await send({ action: "pause" }); await w.engine.go();
  assert.equal(config().interactionMode, "general"); assert.doesNotMatch(config().instructions!, /# Current learning tool|teach one step/);
  // Sleeping directly also ends the voice binding without erasing saved work.
  await send({ action: "start", mode: "study", goalId: goal.id }); await send({ action: "lesson.begin" });
  const saved = w.engine.work.store.state().active!.id;
  await w.engine.command({ type: "sleep" }); await w.engine.go();
  assert.equal(config().interactionMode, "general");
  assert.equal(w.engine.work.store.state().active?.id, saved);
  assert.doesNotMatch(config().instructions!, /# Current learning tool|teach one step/);
});

test("lecture capture retains its separate silent mode and never becomes general chat or Sage", async t => {
  const w = world(); t.after(() => w.engine.stop()); await w.engine.start(); await w.engine.ready();
  const send = (command: Omit<WorkCommand, "requestId">) => w.engine.command({ type: "work.command", command: { ...command, requestId: randomUUID() } });
  await send({ action: "start", mode: "class" }); await send({ action: "lecture.begin" });
  const config = w.lives.at(-1)!.config!;
  assert.equal(config.interactionMode, "capture");
  assert.match(config.instructions!, /# Lecture capture/); assert.match(config.instructions!, /Stay silent/);
  assert.doesNotMatch(config.instructions!, /General mode:|Education mode:|# Current learning tool/);
});

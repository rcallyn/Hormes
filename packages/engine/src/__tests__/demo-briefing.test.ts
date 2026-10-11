import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEMO_BRIEFING } from "../demo-briefing.ts";
import { world, tempDir, testConfig } from "./world.ts";

const fixture = () => {
  const dir = tempDir("hormes-fixed-briefing-");
  return world({ config: testConfig(dir, { geminiApiKey: "test-gemini", openaiApiKey: "sk-test-not-used" }) }, { dir, voiceProvider: "gemini" });
};

test("explicit fixed briefing answers unnamed speech after the wake window and typed commands perform no action", async () => {
  const w = fixture();
  mkdirSync(w.engine.config.stateDir, { recursive: true });
  writeFileSync(join(w.engine.config.stateDir, "demo-briefing.enabled"), "");
  let audio = 0;
  w.engine.on("audio", () => audio++);
  try {
    await w.engine.start(); await w.engine.ready(); await w.engine.go();
    const live = w.lives.at(-1)!;
    assert.equal(live.config?.fixedReply, DEMO_BRIEFING);
    w.clock.t += 30_000;
    live.emit("inputTranscript", "Hello there", live.nowMs, live.nowMs);
    live.emit("turnEnd", "user");
    live.emit("outputTranscript", DEMO_BRIEFING, live.nowMs, live.nowMs);
    const pcm = Buffer.alloc(960); for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(12000, i);
    live.emit("audio", pcm);
    assert.equal(audio, 1, "an unnamed request is audible after the ordinary exchange window");
    const before = w.hands.ops.length;
    await w.engine.sayText("open Safari");
    assert.equal(w.hands.ops.length, before, "a scripted briefing request cannot open the app");
  } finally { await w.engine.stop(); }
});

test("ordinary voice has no fixed script unless explicitly enabled", async () => {
  const w = fixture();
  try {
    await w.engine.start(); await w.engine.ready(); await w.engine.go();
    assert.equal(w.lives.at(-1)?.config?.fixedReply, undefined);
  } finally { await w.engine.stop(); }
});

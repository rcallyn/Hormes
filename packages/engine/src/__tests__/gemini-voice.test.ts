import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SETTINGS } from "@hormes/protocol";
import { Engine } from "../engine.ts";
import { FakeMemoryService, noShell, refusingFetch, world, testConfig, tempDir } from "./world.ts";

test("Gemini voice starts without an OpenAI voice key and persists a separate local brain choice", async () => {
  const dir = tempDir("jh-gemini-voice-");
  const w = world({ config: testConfig(dir, { geminiApiKey: "test-gemini", openaiApiKey: undefined }), fetch: async () => new Response("{}", { status: 200 }) }, { dir, voiceProvider: "gemini" });
  try {
    assert.equal(w.engine.snapshot().settings.voiceProvider, "gemini", "the fake transport can explicitly override the world fixture");
    w.engine.updateSettings({ voiceProvider: "gemini", geminiModel: "gemini-3.8-live", geminiVoice: "Aoede" });
    await w.engine.start();
    await w.engine.ready();
    await w.engine.go();
    assert.equal(w.engine.snapshot().phase, "listening");
    assert.equal(w.lives[0]?.config?.model, "gemini-3.8-live");
    assert.equal(w.lives[0]?.config?.audio?.output?.voice, "Aoede");
    await w.engine.command({ type: "sleep" });
    w.engine.updateSettings({ brain: "local", brainModel: "qwen3.5:27b" });
    assert.equal(w.engine.snapshot().settings.voiceProvider, "gemini");
    assert.equal(w.engine.snapshot().settings.brain, "local");
    assert.equal(w.engine.snapshot().settings.brainModel, "qwen3.5:27b");
    const before = w.engine.snapshot().settings;
    w.engine.updateSettings({ voiceProvider: "bogus", geminiModel: "../../model" } as never);
    assert.equal(w.engine.snapshot().settings.voiceProvider, before.voiceProvider);
    assert.equal(w.engine.snapshot().settings.geminiModel, before.geminiModel);
  } finally { await w.engine.stop(); }
});

test("a Gemini-shaped session can stay quiet; explicit transcript boundaries settle actual speech", async () => {
  const w = world();
  try {
    await w.engine.start(); await w.engine.ready();
    await w.engine.go(); const live = w.lives[0]!;
    Object.assign(live, { continuousFrames: false, serverFrames: 1 });
    const finals: string[] = [];
    w.engine.on("utterance", item => { if (item.speaker === "user") finals.push(item.text); });
    live.emit("inputTranscript", "The income is five.", 100, 200);
    live.emit("turnEnd", "user");
    assert.deepEqual(finals, ["The income is five."]);
    w.clock.t += 10_000;
    (w.engine as unknown as { tick(): void }).tick();
    w.clock.t += 10_000;
    (w.engine as unknown as { tick(): void }).tick();
    assert.equal(live.currentState, "started", "quiet waiting is not a dropped Gemini connection");
    assert.equal(live.terminates, 0);
  } finally { await w.engine.stop(); }
});


test("the OpenAI FakeLive fixture selects its transport without writing settings or altering the product default", async () => {
  const productProvider = DEFAULT_SETTINGS.voiceProvider;
  const w = world();
  try {
    assert.equal(w.engine.snapshot().settings.voiceProvider, "openai");
    assert.equal(DEFAULT_SETTINGS.voiceProvider, productProvider, "the product provider remains unchanged");
    assert.equal(existsSync(join(w.dir, "state", "settings.json")), false, "fixture selection does not fabricate a saved user setting");
  } finally { await w.engine.stop(); }
});


test("a bare engine defaults to Gemini and an OpenAI key cannot bypass its Gemini key requirement", async () => {
  assert.equal(DEFAULT_SETTINGS.voiceProvider, "gemini");
  const dir = tempDir("hormes-gemini-default-");
  let opened = 0;
  const engine = new Engine({
    config: testConfig(dir, { openaiApiKey: "sk-test-not-used", geminiApiKey: undefined }),
    connectors: [], probe: false, exec: noShell, fetch: refusingFetch,
    memory: { service: new FakeMemoryService() }, fallbackUserName: "User",
    makeLive: () => { opened++; throw new Error("A missing Gemini key must prevent transport construction"); },
  });
  try {
    assert.equal(engine.currentSettings.voiceProvider, "gemini");
    await engine.go();
    assert.equal(opened, 0);
    assert.equal(engine.snapshot().phase, "error");
    assert.ok(engine.typedProblems().some(problem => problem.kind === "voice.key" && problem.text.includes("GEMINI_API_KEY is missing")));
    assert.equal(engine.currentSettings.voiceProvider, "gemini", "there is no silent OpenAI fallback");
  } finally { await engine.stop(); }
});

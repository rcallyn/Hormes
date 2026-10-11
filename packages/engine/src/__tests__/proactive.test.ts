import { test } from "node:test";
import assert from "node:assert/strict";
import { ProactiveSuggestions, suggestionBudget } from "../proactive.ts";
import type { AgentInfo } from "@hormes/protocol";
import type { AgentConnector } from "@hormes/agents";
import { until, world } from "./world.ts";

const agent = (id: string, status: AgentInfo["status"] = "blocked"): AgentInfo => ({ id, kind: "sessions", name: id, status, updatedAt: 1 });
test("suggestions require opt-in, stable evidence and quiet; resolution, stale approval, dismissals and restarts do not replay", () => {
  let now = Date.UTC(2026, 9, 10), saved: unknown;
  const gate = new ProactiveSuggestions(suggestionBudget(undefined, now), (b) => saved = structuredClone(b), () => now);
  gate.update([agent("a")], false, true); now += 31_000;
  assert.equal(gate.suggestions.length, 0);
  gate.update([agent("a")], true, false); assert.equal(gate.suggestions.length, 0);
  gate.update([agent("a")], true, true); const offered = gate.suggestions[0]!;
  assert.ok(offered); assert.match(offered.request, /Do not approve permissions/);
  assert.equal(gate.take("stale-id", [agent("a")]), undefined);
  assert.equal(gate.take(offered.id, [agent("a", "ended")]), undefined);
  gate.update([agent("a", "ended")], true, true); assert.equal(gate.suggestions.length, 0);
  now += 31 * 60_000;
  const restarted = new ProactiveSuggestions(suggestionBudget(saved, now), () => {}, () => now);
  restarted.update([agent("a")], true, true); now += 31_000; restarted.update([agent("a")], true, true);
  assert.equal(restarted.suggestions.length, 0, "same agent suppressed for a day across restart");
});

test("expiry, daily limit and corrupt/unwritable budgets fail closed", () => {
  let now = Date.UTC(2026, 9, 10);
  const gate = new ProactiveSuggestions(suggestionBudget(undefined, now), () => {}, () => now);
  for (let i = 0; i < 4; i++) {
    const a = agent(`a${i}`); gate.update([a], true, true); now += 31_000; gate.update([a], true, true);
    assert.equal(gate.suggestions.length, i < 3 ? 1 : 0);
    now += 31 * 60_000;
    if (i < 3) assert.equal(gate.take(gate.suggestions[0]?.id ?? "expired", [a]), undefined);
  }
  const corrupt = new ProactiveSuggestions(suggestionBudget({ count: -1 }, now), () => {}, () => now);
  corrupt.update([agent("b")], true, true); now += 31_000; corrupt.update([agent("b")], true, true); assert.equal(corrupt.suggestions.length, 0);
  const diskFull = new ProactiveSuggestions(suggestionBudget(undefined, now), () => { throw Error("disk full"); }, () => now);
  diskFull.update([agent("c")], true, true); now += 31_000; diskFull.update([agent("c")], true, true); assert.equal(diskFull.suggestions.length, 0);
});

test("Console suggestions never wake or act; Review carries an immutable read-only capability into the brain", async (t) => {
  let status: AgentInfo["status"] = "blocked", reads = 0, sends = 0;
  const connector: AgentConnector = {
    kind: "sessions", health: async () => ({ kind: "sessions", ok: true, detail: "fake" }),
    list: async () => [agent("sessions:a", status)],
    read: async () => { reads++; return "Permission to run an untrusted script is waiting."; },
    send: async () => { sends++; return { accepted: true }; },
  };
  const w = world({ connectors: [connector] }); t.after(() => w.engine.stop());
  await w.engine.start(); await w.engine.ready(); await w.engine.command({ type: "agent.refresh" });
  const tick = () => (w.engine as unknown as { tick(): void }).tick();
  tick(); w.clock.t += 31_000; tick(); assert.deepEqual(w.engine.snapshot().suggestions, [], "opt-in is required");
  w.engine.updateSettings({ proactive: true }); tick();
  const offered = w.engine.snapshot().suggestions?.[0]; assert.ok(offered);
  assert.equal(w.live.config, undefined, "offering opens no voice session");
  assert.equal(w.brain.tasks.length, 0); assert.equal(reads, 0); assert.equal(sends, 0);
  await w.engine.command({ type: "suggestion.accept", id: offered.id });
  assert.equal(w.live.config, undefined, "Review while asleep cannot open a paid session");
  assert.equal(w.brain.tasks.length, 0);
  await w.engine.wake("test");
  await w.engine.command({ type: "suggestion.accept", id: offered.id });
  w.live.emit("delegation", "review", "client", w.live.nowMs);
  await until(() => w.brain.tasks.length > 0, 3000);
  assert.equal(w.brain.tasks[0]?.reviewAgent, "sessions:a");
  for (const [name, input] of [
    ["run_shell", { command: "echo should-not-run", cwd: w.dir }],
    ["agent_send", { agent: "sessions:a", text: "yes" }],
    ["agent_read", { agent: "sessions:other" }],
    ["self_edit", { task: "loosen policy" }],
    ["thread_start", { name: "bypass", task: "run an untrusted script" }],
    ["type", { text: "should-not-type" }],
  ] as const) {
    const result = (await w.engine.runner.run(name, input)).result;
    assert.equal(result.kind, "error", name);
    assert.ok(result.kind === "error" && /suggestion review only permits/.test(result.message), "the capability guard, rather than invalid arguments, denied the tool");
  }
  assert.equal(reads, 0); assert.equal(sends, 0);
  const read = await w.engine.runner.run("agent_read", { agent: "sessions:a" });
  assert.equal(read.result.kind, "text"); assert.equal(reads, 1);
  w.brain.resolve?.({ status: "done", summary: "An agent needs permission; no permission was approved." });
  await until(() => !w.engine.runner.attached, 2000);
  assert.equal(w.engine.snapshot().suggestions?.length, 0);
  status = "idle"; await w.engine.command({ type: "agent.refresh" });
  await w.engine.command({ type: "suggestion.accept", id: offered.id });
  assert.equal(sends, 0, "stale review never answers the permission request");
});

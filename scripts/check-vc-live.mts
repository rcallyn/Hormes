/** Opt-in, two bounded GPT turns; never opens audio, a mail transport or the user's work database. */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { readConfig } from "@hormes/core";
import { OpenAICompatibleBrain, ALL_TOOL_SPECS } from "@hormes/brain";
import { makeRunner } from "../packages/brain/src/__tests__/fakes.ts";
import { WorkCoordinator } from "../packages/engine/src/work/coordinator.ts";
import { VC_DEMO_QUOTE } from "../packages/engine/src/work/meeting.ts";
import type { WorkCommand, WorkReply } from "@hormes/protocol";

if (!process.argv.includes("--i-accept-spend")) throw new Error("This check makes two paid GPT turns. Pass --i-accept-spend explicitly.");
const config = readConfig();
if (!config.openaiApiKey) throw new Error("Configure the OpenAI key in Hormes Console first.");
const settings = JSON.parse(readFileSync(join(config.stateDir, "settings.json"), "utf8"));
const model = settings.brainModel || config.brainModel;
if (!model || !/^gpt-/.test(model)) throw new Error("Select the GPT model in Hormes Settings before testing.");
const stateDir = mkdtempSync(join(tmpdir(), "hormes-vc-live-"));
let work: WorkCoordinator;
const { runner } = makeRunner({ stateDir, work: { isActive: scope => work.isActive(scope), model: (scope, operation, payload) => work.model(scope, operation, payload), receipt: () => undefined } });
const brain = new OpenAICompatibleBrain({ runner, baseUrl: "https://api.openai.com/v1", apiKey: config.openaiApiKey, model, tools: ALL_TOOL_SPECS.filter(t => t.name === "work"), maxSteps: 8, maxWallMs: 90_000, requestTimeoutMs: 45_000, requestRetries: 0, historyTurns: 0 });
const replies: WorkReply[] = [];
// The harness exposes only work. ToolRunner still enforces the bound meeting scope;
// there is no focus lease to acquire because no desktop tool is offered.
work = new WorkCoordinator({ stateDir, lane: () => ({ brain, runner: { setLane() {}, beginTurn() {} } }), emit: reply => replies.push(reply), redact: text => runner.redactor.redact(text) });
const send = (c: Omit<WorkCommand, "requestId">) => work.command({ ...c, requestId: randomUUID() });
try {
  await send({ action: "demo", blockId: "meeting" });
  const started = Date.now(); await send({ action: "meeting.prepare" });
  assert.ok(work.store.state().active!.meeting!.brief, `GPT must save a grounded brief: ${replies.filter(r => !r.ok).map(r => r.message).join("; ")}`);
  const preMs = Date.now() - started;
  await send({ action: "recap", text: `Mock VC line supplied by the user for this hypothetical-day rehearsal: ${VC_DEMO_QUOTE}` });
  const postStarted = Date.now(); await send({ action: "meeting.follow-up" });
  const draft = work.store.state().active!.meeting!.followUp!;
  assert.ok(draft, "GPT must save a follow-up draft");
  assert.deepEqual([...draft.attachmentIds].sort(), ["vc_deck", "vc_retention"]);
  assert.match(draft.reconnect!, /next week/i);
  await send({ action: "meeting.review", revision: draft.revision, planId: draft.id });
  const state = work.store.state();
  assert.ok(state.active!.meeting!.followUp!.exportPath);
  assert.ok(state.goals.every(g => g.state === "in-progress"));
  const failures = replies.filter(r => !r.ok); assert.equal(failures.length, 0, failures.map(r => r.message).join("; "));
  const report = { ok: true, provider: "OpenAI-compatible GPT", model, preMs, postMs: Date.now() - postStarted, stateDir, input: "Explicit typed mock recap, not a live meeting or microphone test", email: "Local MIME draft exported; no recipient, no send", state };
  const out = join(stateDir, "verification.json"); writeFileSync(out, JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ ok: true, model, preMs, postMs: report.postMs, report: out, attachments: draft.attachmentIds, sent: false }));
} finally { await work.stop(); }

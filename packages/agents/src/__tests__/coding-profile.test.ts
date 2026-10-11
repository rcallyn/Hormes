import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, unlinkSync, linkSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodingProfileStore, type CodingProfile } from "../claude-code/coding-profile.ts";
import { ClaudeCodeConnector } from "../claude-code/connector.ts";
import { ClaudeCodeRunner } from "../sessions/runners/claude-code.ts";
import { AsyncQueue } from "../claude-code/queue.ts";
import type { SdkLike, SdkMessage } from "../claude-code/session.ts";
import type { DiscoveredSession } from "../sessions/store.ts";

const files = ["README.md", "package.json", "engine/baseline.mjs", "engine/physics.mjs", "test/engine.test.mjs", "benchmark.mjs", "engine/candidate.mjs"];
function fixture(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(join(tmpdir(), "hormes-bounded-coding-")), root = join(dir, "project"), state = join(dir, "state");
  mkdirSync(join(root, "engine"), { recursive: true }); mkdirSync(join(root, "test"));
  for (const name of files) writeFileSync(join(root, name), name);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const profile: CodingProfile = { kind: "evosim", root };
  return { dir, root, state, profile, store: new CodingProfileStore(state) };
}

test("EvoSim is explicitly bound; a folder or a model claim cannot select the capability", t => {
  const f = fixture(t);
  assert.equal(f.store.open(f.root), undefined);
  const bound = f.store.open(f.root, f.profile)!;
  assert.equal(bound.guard("Read", { file_path: "README.md" }).behavior, "allow");
  assert.equal(bound.guard("Edit", { file_path: "engine/candidate.mjs" }).behavior, "allow");
  for (const file of files.filter(n => n !== "engine/candidate.mjs")) assert.equal(bound.guard("Write", { file_path: file }).behavior, "deny", file);
  for (const file of ["../outside", "/etc/passwd", ".env", "engine/../../outside", "rehearsal-history/candidate.mjs"]) assert.equal(bound.guard("Read", { file_path: file }).behavior, "deny", file);
  for (const tool of ["Bash", "Task", "Agent", "Skill", "ToolSearch", "mcp__hormes__run_shell", "NotebookEdit", "MultiEdit", "WebFetch"]) assert.equal(bound.guard(tool, { file_path: "engine/candidate.mjs", command: "node --test test/*.test.mjs", codingProfile: f.profile }).behavior, "deny", tool);
  assert.throws(() => f.store.open(f.dir, f.profile), /differs/);
});

test("canonical path checks reject swapped symlinks, linked parents and hard links", t => {
  const f = fixture(t), bound = f.store.open(f.root, f.profile)!;
  const candidate = join(f.root, "engine/candidate.mjs"), outside = join(f.dir, "outside");
  writeFileSync(outside, "outside"); unlinkSync(candidate); symlinkSync(outside, candidate);
  assert.equal(bound.guard("Write", { file_path: candidate }).behavior, "deny");
  unlinkSync(candidate); linkSync(outside, candidate);
  assert.equal(bound.guard("Write", { file_path: candidate }).behavior, "deny");
  unlinkSync(candidate); writeFileSync(candidate, "candidate");
  const originalEngine = join(f.dir, "engine");
  mkdirSync(originalEngine); for (const n of ["baseline.mjs", "physics.mjs", "candidate.mjs"]) writeFileSync(join(originalEngine, n), n);
  rmSync(join(f.root, "engine"), { recursive: true }); symlinkSync(originalEngine, join(f.root, "engine"));
  assert.equal(bound.guard("Read", { file_path: "engine/baseline.mjs" }).behavior, "deny");
  assert.equal(readFileSync(outside, "utf8"), "outside");
});

test("stored profile survives a new connector store and rejects verifier changes or malformed bindings", t => {
  const f = fixture(t), bound = f.store.open(f.root, f.profile)!;
  bound.bind("actual-session");
  const resumed = new CodingProfileStore(f.state).open(f.root, undefined, "actual-session")!;
  assert.equal(resumed.guard("Write", { file_path: "test/engine.test.mjs" }).behavior, "deny");
  writeFileSync(join(f.root, "engine/candidate.mjs"), "new candidate");
  assert.equal(resumed.guard("Read", { file_path: "engine/candidate.mjs" }).behavior, "allow");
  writeFileSync(join(f.root, "benchmark.mjs"), "tampered verifier");
  assert.equal(resumed.guard("Edit", { file_path: "engine/candidate.mjs" }).behavior, "deny");
  assert.throws(() => new CodingProfileStore(f.state).open(f.root, undefined, "actual-session"), /Trusted verifier changed/);
  writeFileSync(join(f.state, "actual-session.json"), "not json");
  assert.throws(() => new CodingProfileStore(f.state).open(f.root, undefined, "actual-session"));
  unlinkSync(join(f.state, "actual-session.json")); mkdirSync(join(f.state, "actual-session.json"));
  assert.throws(() => new CodingProfileStore(f.state).open(f.root, undefined, "actual-session"), /directory|EISDIR/);
});

type Hook = (input: { tool_name: string; tool_input: unknown }) => Promise<{ hookSpecificOutput: { permissionDecision: string; updatedInput?: Record<string, unknown> } }>;
function sdkWithAutoApprovedTools(id: string, actions: { tool: string; input: Record<string, unknown> }[]) {
  const decisions: string[] = [];
  const holder: { options?: Record<string, unknown> | undefined; error?: unknown } = {};
  const sdk: SdkLike = { query({ prompt, options }) {
    holder.options = options;
    const out = new AsyncQueue<SdkMessage>();
    out.push({ type: "system", subtype: "init", session_id: id, model: "fake" });
    void (async () => {
      try {
        for await (const _ of prompt) {
          // Deliberately never call canUseTool: Read/Edit are auto-approved by an
          // SDK in this regression. Only the unconditional PreToolUse can stop them.
          const hooks = options!["hooks"] as { PreToolUse: { hooks: Hook[] }[] };
          for (const action of actions) {
            const result = await hooks.PreToolUse[0]!.hooks[0]!({ tool_name: action.tool, tool_input: action.input });
            decisions.push(result.hookSpecificOutput.permissionDecision);
            if (action.tool === "Write" && result.hookSpecificOutput.permissionDecision === "allow") {
              writeFileSync(String(result.hookSpecificOutput.updatedInput!["file_path"]), String(action.input["content"]));
            }
          }
          out.push({ type: "result", subtype: "success", is_error: false, result: "done" });
        }
      } catch (error) { holder.error = error; }
      finally { out.close(); }
    })();
    return Object.assign(out, { interrupt: async () => undefined });
  } };
  return { sdk, holder, decisions };
}

test("production connector enforces PreToolUse even when SDK bypasses canUseTool", async t => {
  const f = fixture(t);
  const mock = sdkWithAutoApprovedTools("sdk-started", [
    { tool: "Write", input: { file_path: join(f.root, "test/engine.test.mjs"), content: "fake passing test" } },
    { tool: "Bash", input: { command: "echo escaped", file_path: "engine/candidate.mjs" } },
    { tool: "Read", input: { file_path: join(f.dir, "secrets") } },
    { tool: "Write", input: { file_path: "engine/candidate.mjs", content: "actual candidate" } },
  ]);
  const connector = new ClaudeCodeConnector({ sdk: mock.sdk, codingProfiles: f.store, permissionMode: "acceptEdits", canUseTool: async () => { throw new Error("auto-approved calls must still be guarded"); } });
  t.after(() => { void connector.closeAll(); });
  const agent = await connector.start({ cwd: f.root, prompt: "change the candidate", codingProfile: f.profile });
  await connector.waitSettled(agent.id, 2000);
  assert.equal(mock.holder.error, undefined);
  assert.deepEqual(mock.decisions, ["deny", "deny", "deny", "allow"]);
  assert.equal(readFileSync(join(f.root, "test/engine.test.mjs"), "utf8"), "test/engine.test.mjs");
  assert.equal(readFileSync(join(f.root, "engine/candidate.mjs"), "utf8"), "actual candidate");
  assert.deepEqual(mock.holder.options?.["tools"], ["Read", "Edit", "Write"]);
  assert.deepEqual(mock.holder.options?.["settingSources"], []);
  assert.deepEqual(mock.holder.options?.["mcpServers"], {});
  assert.equal(mock.holder.options?.["strictMcpConfig"], true);
  assert.equal(mock.holder.options?.["permissionMode"], "default");
  assert.ok(new CodingProfileStore(f.state).open(f.root, undefined, "sdk-started"));
  await connector.closeAll();
});

test("a persisted bound session resumes with the guard even when no profile is sent again", async t => {
  const f = fixture(t); f.store.open(f.root, f.profile)!.bind("sdk-resume");
  const mock = sdkWithAutoApprovedTools("sdk-resume", [
    { tool: "Write", input: { file_path: "benchmark.mjs", content: "invented speedup" } },
    { tool: "Write", input: { file_path: "engine/candidate.mjs", content: "resumed candidate" } },
  ]);
  const runner = new ClaudeCodeRunner({ sdk: mock.sdk, codingProfiles: new CodingProfileStore(f.state) });
  const session = { id: "sdk-resume", cwd: f.root, tool: "claude" } as DiscoveredSession;
  const outcome = await runner.continue(session, "continue", "resume", () => {});
  assert.equal(outcome.kind, "run"); if (outcome.kind !== "run") return;
  t.after(() => { void outcome.handle.close(); });
  await outcome.handle.ready;
  for (let i = 0; i < 30 && outcome.handle.status !== "idle"; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(mock.holder.error, undefined);
  assert.deepEqual(mock.decisions, ["deny", "allow"]);
  assert.equal(mock.holder.options?.["resume"], "sdk-resume");
  assert.equal(outcome.handle.codingProfile?.root, realpathSync(f.root));
  assert.equal(readFileSync(join(f.root, "benchmark.mjs"), "utf8"), "benchmark.mjs");
  await outcome.handle.close();
});


test("an unrestricted running Claude cannot receive a bounded project task without relaunch", async t => {
  const f = fixture(t), mock = sdkWithAutoApprovedTools("unrestricted-running", []);
  const connector = new ClaudeCodeConnector({ sdk: mock.sdk, codingProfiles: f.store });
  const agent = await connector.start({ cwd: f.root, prompt: "ordinary task" });
  await connector.waitSettled(agent.id, 2000);
  const response = await connector.send(agent.id, "bounded task", { codingProfile: f.profile });
  assert.equal(response.accepted, false);
  assert.match(response.detail!, /new bounded EvoSim session/);
  assert.equal(mock.holder.options?.["hooks"], undefined);
  await connector.closeAll();
});

test("bound session options exclude provider secrets and inherited auto-approval settings", t => {
  const f = fixture(t), options = f.store.open(f.root, f.profile)!.options({ OPENAI_API_KEY: "fixture-openai", GEMINI_API_KEY: "fixture-gemini", ANTHROPIC_API_KEY: "fixture-claude", PATH: "/bin" });
  assert.equal(options.env?.["OPENAI_API_KEY"], undefined);
  assert.equal(options.env?.["GEMINI_API_KEY"], undefined);
  assert.equal(options.env?.["ANTHROPIC_API_KEY"], undefined);
  assert.equal(options.env?.["PATH"], "/bin");
  assert.deepEqual(options.allowedTools, []);
  assert.deepEqual(options.settingSources, []);
  assert.equal(options.permissionMode, "default");
});

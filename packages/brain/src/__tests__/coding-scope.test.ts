import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyAction } from "@hormes/core";
import { AgentRegistry, type AgentConnector, type StartOptions, type SendOptions } from "@hormes/agents";
import { ComputerToolset, ConfirmationState, type NativeHands } from "@hormes/hands";
import { makeRunner, makeSink, makeTask } from "./fakes.ts";
import { runShell, type ShellRunOptions, type ShellRunResult } from "../shell.ts";

test("EvoSim start and resume carry only the application's binding after normal approval", async t => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "hormes-coding-scope-")));
  const cwd = join(home, "Downloads", "EvoSim"); mkdirSync(cwd, { recursive: true });
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const started: StartOptions[] = [], sent: (SendOptions | undefined)[] = [];
  const info = { id: "claude-code:bounded", kind: "claude-code" as const, name: "bounded", status: "idle" as const, cwd, updatedAt: 0 };
  const connector: AgentConnector = {
    kind: "claude-code", health: async () => ({ kind: "claude-code", ok: true, detail: "test" }), list: async () => [info], read: async () => "",
    start: async opts => { started.push(opts); return info; }, send: async (_id, _text, opts) => { sent.push(opts); return { accepted: true }; },
  };
  let active = true;
  const { runner, toolset } = makeRunner({ home, agents: new AgentRegistry([connector], 0), work: { isActive: () => active, model: () => "", receipt: () => undefined } });
  runner.attach(makeSink().sink, { ...makeTask("Build EvoSim"), work: { sessionId: "coding", mode: "coding" } });
  const input = { tool: "claude", cwd: "~/Downloads/EvoSim", prompt: "Optimize candidate", codingProfile: { kind: "unrestricted", root: "/" } };
  assert.equal((await runner.run("agent_start", input)).result.kind, "needs-confirmation");
  assert.equal(started.length, 0);
  toolset.confirmations.arm();
  assert.equal((await runner.run("agent_start", input)).result.kind, "text");
  assert.deepEqual(started[0]?.codingProfile, { kind: "evosim", root: cwd });
  assert.equal(started[0]?.cwd, cwd);
  const followup = { agent: info.id, text: "Handle tangent circles" };
  assert.equal((await runner.run("agent_send", followup)).result.kind, "needs-confirmation");
  toolset.confirmations.arm();
  assert.equal((await runner.run("agent_send", followup)).result.kind, "text");
  assert.deepEqual(sent, [{ codingProfile: { kind: "evosim", root: cwd } }]);
  for (const args of [{ ...input, tool: "codex" }, { ...input, cwd: home }]) assert.equal((await runner.run("agent_start", args)).result.kind, "error");
  for (const [name, args] of [["write_file", { path: join(cwd, "benchmark.mjs"), text: "fake" }], ["key", { combo: "Return" }], ["type", { text: "rm benchmark.mjs" }], ["run_shell", { cwd, command: "node benchmark.mjs; echo forged" }]] as const) assert.equal((await runner.run(name, args)).result.kind, "error");
  active = false;
  assert.equal((await runner.run("agent_send", followup)).result.kind, "error");
  assert.equal(sent.length, 1);
});

test("model-supplied coding profiles never alter an ordinary agent start", async () => {
  const starts: StartOptions[] = [];
  const connector: AgentConnector = { kind: "claude-code", health: async () => ({ kind: "claude-code", ok: true, detail: "test" }), list: async () => [], read: async () => "", send: async () => ({ accepted: true }), start: async opts => { starts.push(opts); return { id: "claude-code:ordinary", kind: "claude-code", name: "ordinary", status: "idle", updatedAt: 0 }; } };
  const { runner } = makeRunner({ agents: new AgentRegistry([connector], 0), policy: () => ({ verdict: "run", reason: "test" }) });
  runner.attach(makeSink().sink, makeTask("Fix a typo"));
  assert.equal((await runner.run("agent_start", { tool: "claude", cwd: tmpdir(), prompt: "Fix a typo", codingProfile: { kind: "evosim", root: "/" } })).result.kind, "text");
  assert.equal(starts[0]?.codingProfile, undefined);
});

test("verification imports cannot modify tests or candidate, but can save the fixed benchmark receipt", { skip: process.platform !== "darwin" }, async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "hormes-verifier-isolation-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const name of ["test.mjs", "candidate.mjs"]) writeFileSync(join(root, name), "keep");
  writeFileSync(join(root, "probe.cjs"), `const fs=require('node:fs'); for(const p of ['test.mjs','candidate.mjs','new-file']) { try { fs.writeFileSync(p,'bad'); throw Error('ESCAPED'); } catch(e) { if(e.message==='ESCAPED') throw e; } } fs.writeFileSync('benchmark-result.json','verified'); console.log('protected');`);
  const result = await runShell({ command: `${process.execPath} probe.cjs`, cwd: root, readOnlyWorkspace: true, writableFiles: [join(root, "benchmark-result.json")] });
  assert.equal(result.code, 0, result.error || result.stderr);
  assert.match(result.stdout, /protected/);
  assert.equal(readFileSync(join(root, "test.mjs"), "utf8"), "keep");
  assert.equal(readFileSync(join(root, "candidate.mjs"), "utf8"), "keep");
  assert.equal(readFileSync(join(root, "benchmark-result.json"), "utf8"), "verified");
});

test("a symlinked benchmark output fails before executing candidate code", { skip: process.platform !== "darwin" }, async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "hormes-verifier-link-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "trusted.mjs"), "keep"); symlinkSync(join(root, "trusted.mjs"), join(root, "benchmark-result.json"));
  const result = await runShell({ command: "echo must-not-run", cwd: root, readOnlyWorkspace: true, writableFiles: [join(root, "benchmark-result.json")] });
  assert.equal(result.stdout, ""); assert.match(result.error ?? "", /invalid verifier output/);
  assert.equal(readFileSync(join(root, "trusted.mjs"), "utf8"), "keep");
});


test("the verifier's node command uses the daemon runtime, not another Homebrew Node", { skip: process.platform !== "darwin" }, async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "hormes-verifier-runtime-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const result = await runShell({ command: `node -p 'JSON.stringify({version:process.version,path:process.execPath})'`, cwd: root, readOnlyWorkspace: true });
  assert.equal(result.code, 0, result.error || result.stderr);
  assert.equal(result.isolated, true);
  assert.deepEqual(JSON.parse(result.stdout), { version: process.version, path: realpathSync(process.execPath) });
});

test("a dangling fixed-output symlink fails before sandbox execution", { skip: process.platform !== "darwin" }, async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "hormes-verifier-dangling-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  symlinkSync(join(root, "missing"), join(root, "benchmark-result.json"));
  const result = await runShell({ command: "echo must-not-run", cwd: root, readOnlyWorkspace: true, writableFiles: [join(root, "benchmark-result.json")] });
  assert.equal(result.stdout, ""); assert.match(result.error ?? "", /invalid verifier output/);
});


function codingIDEHarness(t: { after(fn: () => void): void }) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "hormes-coding-ide-")));
  const root = join(home, "Downloads", "EvoSim"); mkdirSync(root, { recursive: true });
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const calls: { op: string; args: unknown }[] = [], opens: ShellRunOptions[] = [];
  const state = { active: true, foreignMs: 60_000, locked: false as boolean | undefined, frontBundle: "com.microsoft.VSCode", nativeError: false, probeError: false, afterActivation: () => {}, policyHold: false };
  const hands: NativeHands = { ready: true, async request<T>(op: string, args?: unknown): Promise<T> {
    calls.push({ op, args });
    if (op === "open_app") {
      if (state.nativeError) throw Error("native app activation failed");
      state.afterActivation();
      return { app: "Visual Studio Code", bundleId: "com.microsoft.VSCode", pid: 73 } as T;
    }
    if (state.probeError) throw Error("native probe unavailable");
    if (op === "user_idle") return { foreignMs: state.foreignMs } as T;
    if (op === "frontmost") return { bundleId: state.frontBundle, locked: state.locked } as T;
    return {} as T;
  } };
  const confirmations = new ConfirmationState(); confirmations.requireOwner = () => true;
  const toolset = new ComputerToolset({ hands, confirmations, policy: ctx => state.policyHold ? { verdict: "confirm", reason: "native presence hold", hold: true } : classifyAction(ctx) });
  const success: ShellRunResult = { code: 0, signal: null, stdout: "", stderr: "", timedOut: false, cancelled: false, ms: 0 };
  let executionResult = success;
  const { runner, dir } = makeRunner({ home, toolset, work: { isActive: () => state.active, model: () => "", receipt: () => undefined }, runCodingProjectOpen: async opts => { opens.push(opts); return executionResult; } });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const abort = new AbortController();
  runner.attach(makeSink().sink, { ...makeTask("Build EvoSim", abort.signal), work: { sessionId: "trusted-coding", mode: "coding" } });
  const approve = async () => {
    const pending = (await runner.run("open_app", { name: "Visual Studio Code" })).result;
    assert.equal(pending.kind, "needs-confirmation");
    assert.equal(confirmations.authenticatePending(confirmations.pending!.id), true);
    assert.ok(confirmations.arm());
  };
  return { home, root, runner, state, calls, opens, confirmations, abort, approve, failExecution: () => { executionResult = { ...success, code: 1, stderr: "LaunchServices could not open the project" }; } };
}

test("EvoSim opens its actual project using fixed native argv only after owner authentication", async t => {
  const h = codingIDEHarness(t);
  const input = { name: "VS Code" };
  const pending = (await h.runner.run("open_app", input)).result;
  assert.equal(pending.kind, "needs-confirmation");
  assert.match(pending.kind === "needs-confirmation" ? pending.question : "", /EvoSim project/);
  assert.deepEqual(h.confirmations.pending?.input, { name: "Visual Studio Code", project: h.root, workSessionId: "trusted-coding" });
  assert.ok(h.confirmations.pending?.description.includes(h.root), "Console owner approval names the actual project");
  assert.equal(h.confirmations.arm(), undefined, "speech cannot authenticate the owner");
  assert.equal(h.calls.length, 0); assert.equal(h.opens.length, 0);
  assert.ok(h.confirmations.authenticatePending(h.confirmations.pending!.id)); h.confirmations.arm();
  const result = (await h.runner.run("open_app", input)).result;
  assert.equal(result.kind, "text"); assert.match(result.kind === "text" ? result.text : "", /opened EvoSim project/);
  assert.deepEqual(h.calls.find(c => c.op === "open_app")?.args, { name: "Visual Studio Code", activate: true });
  assert.equal(h.opens.length, 1);
  assert.deepEqual(h.opens[0]?.argv, ["/usr/bin/open", "-g", "-b", "com.microsoft.VSCode", h.root]);
  assert.equal(h.opens[0]?.signal, h.abort.signal);
  assert.equal((await h.runner.run("open_app", input)).result.kind, "needs-confirmation", "approval is one use");
  assert.equal(h.opens.length, 1);
});

test("the coding IDE opener refuses model paths, URIs, flags and alternate applications", async t => {
  const h = codingIDEHarness(t);
  for (const input of [
    { name: "Terminal" }, { name: "/Applications/Visual Studio Code.app" }, { name: "vscode://file/tmp/evil" },
    { name: "Visual Studio Code", path: "/tmp/other" }, { name: "Visual Studio Code", argv: ["/bin/sh"] },
    { name: "Visual Studio Code", url: "https://example.com" }, { name: "Visual Studio Code", command: "touch escaped" },
    { name: "Visual Studio Code", app: "Terminal" },
  ]) assert.equal((await h.runner.run("open_app", input)).result.kind, "error");
  assert.equal(h.calls.length, 0); assert.equal(h.opens.length, 0); assert.equal(h.confirmations.pending, undefined);
});

test("the coding IDE opener preserves native presence and activation failures", async t => {
  for (const scenario of ["policy-hold", "native-error", "busy", "locked", "unknown-lock", "unknown-idle", "other-app", "probe-error"] as const) {
    const h = codingIDEHarness(t);
    await h.approve();
    if (scenario === "policy-hold") h.state.policyHold = true;
    if (scenario === "native-error") h.state.nativeError = true;
    if (scenario === "busy") h.state.foreignMs = 20;
    if (scenario === "locked") h.state.locked = true;
    if (scenario === "unknown-lock") h.state.locked = undefined;
    if (scenario === "unknown-idle") h.state.foreignMs = NaN;
    if (scenario === "other-app") h.state.frontBundle = "com.apple.finder";
    if (scenario === "probe-error") h.state.probeError = true;
    assert.notEqual((await h.runner.run("open_app", { name: "Visual Studio Code" })).result.kind, "text", scenario);
    assert.equal(h.opens.length, 0, scenario);
    if (scenario === "policy-hold") assert.equal(h.calls.length, 0);
  }
});

test("stopping, superseding or replacing the trusted folder during activation blocks the project handoff", async t => {
  for (const scenario of ["abort", "expired", "superseded", "folder-changed"] as const) {
    const h = codingIDEHarness(t); await h.approve();
    h.state.afterActivation = () => {
      if (scenario === "abort") h.abort.abort();
      if (scenario === "expired") h.state.active = false;
      if (scenario === "superseded") h.runner.attach(makeSink().sink, { ...makeTask("Another task"), work: { sessionId: "different", mode: "coding" } });
      if (scenario === "folder-changed") { rmSync(h.root, { recursive: true }); symlinkSync(h.home, h.root); }
    };
    assert.equal((await h.runner.run("open_app", { name: "Visual Studio Code" })).result.kind, "error", scenario);
    assert.equal(h.opens.length, 0, scenario);
  }
});

test("coding IDE approval cannot move across sessions and native open errors are reported", async t => {
  const h = codingIDEHarness(t); await h.approve();
  h.runner.attach(makeSink().sink, { ...makeTask("Another coding session"), work: { sessionId: "different", mode: "coding" } });
  assert.equal((await h.runner.run("open_app", { name: "Visual Studio Code" })).result.kind, "needs-confirmation");
  assert.equal(h.opens.length, 0);
  await h.approve(); h.failExecution();
  const result = (await h.runner.run("open_app", { name: "Visual Studio Code" })).result;
  assert.equal(result.kind, "error"); assert.match(result.kind === "error" ? result.message : "", /could not open the EvoSim project/);
});

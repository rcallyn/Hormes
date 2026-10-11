import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runShell, BackgroundJobs } from "../shell.ts";

const skip = process.platform !== "darwin";
test("the real Node test runner can read uname while unrelated kernel data stays denied", { skip }, async () => {
  const workspace = mkdtempSync(join(tmpdir(), "jh-node-test-isolation-"));
  writeFileSync(join(workspace, "runtime.test.cjs"), `
const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
test('runtime introspection is bounded', () => {
  assert.equal(os.type(), 'Darwin');
  assert.ok(os.release().length > 0);
  assert.notEqual(spawnSync('/usr/sbin/sysctl', ['kern.bootargs']).status, 0);
});
`);
  const result = await runShell({ command: `${process.execPath} --test runtime.test.cjs`, cwd: workspace });
  assert.equal(result.code, 0, result.stderr || result.error);
  assert.match(result.stdout, /runtime introspection is bounded/);
  assert.doesNotMatch(result.stdout, /not ok/);
});

test("real script descendants cannot read secrets, overwrite unrelated files, use a symlink escape, or reach a loopback socket", { skip }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "jh-isolation-"));
  const workspace = join(root, "workspace"), outside = join(root, "outside");
  mkdirSync(workspace); mkdirSync(outside);
  const victim = join(outside, "victim.txt"); writeFileSync(victim, "keep");
  writeFileSync(join(workspace, ".env"), "CANARY=secret");
  writeFileSync(join(workspace, ".ENV.local"), "CANARY=secret");
  writeFileSync(join(workspace, "key.PEM"), "CANARY=secret");
  const state = join(workspace, "custom-state"); mkdirSync(state);
  writeFileSync(join(state, "credentials.txt"), "CANARY=secret");
  symlinkSync(outside, join(workspace, "escape"));
  const server = createServer();
  let connections = 0; server.on("connection", () => connections++);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  writeFileSync(join(workspace, "example.cjs"), `
const fs=require('node:fs'),net=require('node:net'),cp=require('node:child_process');
let results=[];
for(const [label,action] of [
['secret',()=>fs.readFileSync('.env')],
['mixed-case-secret',()=>fs.readFileSync('.ENV.local')],
['private-key',()=>fs.readFileSync('key.PEM')],
['custom-state',()=>fs.readFileSync('custom-state/credentials.txt')],
['outside-read',()=>fs.readFileSync(${JSON.stringify(victim)})],
['new-hard-link',()=>fs.linkSync(${JSON.stringify(process.execPath)},'runtime-alias')],
['outside-delete',()=>fs.unlinkSync(${JSON.stringify(victim)})],
['symlink-write',()=>fs.writeFileSync('escape/victim.txt','changed')],
['descendant',()=>{const r=cp.spawnSync('/bin/cat',[${JSON.stringify(victim)}]);return r.status===0 ? 'escape' : 'denied'}]]){
 try{const result=action();results.push(label+':'+(result==='denied'?'blocked':'ESCAPED'))}catch(e){results.push(label+':blocked')}
}
const socket=net.connect(${address.port},'127.0.0.1');socket.on('connect',()=>{results.push('network:ESCAPED');socket.destroy()});socket.on('error',()=>results.push('network:blocked'));socket.on('close',()=>console.log(JSON.stringify(results)));setTimeout(()=>socket.destroy(),1000).unref();
`);
  const result = await runShell({ command: `${process.execPath} example.cjs`, cwd: workspace, secretRoots: [state], env: { ...process.env, CUSTOM_PASSWORD: "should-not-inherit" } });
  assert.equal(result.code, 0, result.stderr || result.error);
  const observed = JSON.parse(result.stdout) as string[];
  assert.deepEqual(observed, ["secret:blocked", "mixed-case-secret:blocked", "private-key:blocked", "custom-state:blocked", "outside-read:blocked", "new-hard-link:blocked", "outside-delete:blocked", "symlink-write:blocked", "descendant:blocked", "network:blocked"]);
  assert.equal(existsSync(join(workspace, "runtime-alias")), false);
  assert.equal(readFileSync(victim, "utf8"), "keep");
  assert.equal(connections, 0);
});

test("background commands inherit isolation and an owned job can be stopped without a shell signal capability", { skip }, async () => {
  const root = mkdtempSync(join(tmpdir(), "jh-background-isolation-"));
  const workspace = join(root, "workspace"); mkdirSync(workspace);
  const victim = join(root, "victim"); writeFileSync(victim, "keep");
  const jobs = new BackgroundJobs(join(root, "state"));
  const job = await jobs.start(`rm ${JSON.stringify(victim)}; echo checked; sleep 5`, workspace);
  try {
    for (let i = 0; i < 30 && !readFileSync(job.logPath, "utf8").includes("checked"); i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(readFileSync(victim, "utf8"), "keep");
    assert.match(readFileSync(job.logPath, "utf8"), /Operation not permitted/);
    assert.equal(jobs.stop(job.pid), true);
  } finally { jobs.stopAll(); }
});

test("pre-existing hard-link aliases fail closed in foreground and background", { skip }, async () => {
  const root = mkdtempSync(join(tmpdir(), "jh-hardlink-isolation-"));
  const cwd = join(root, "workspace"); mkdirSync(cwd);
  const victim = join(root, "outside"); writeFileSync(victim, "keep"); linkSync(victim, join(cwd, "alias"));
  const r = await runShell({ cwd, command: "echo changed > alias" });
  assert.match(r.error ?? "", /hard-linked file/); assert.equal(r.stdout, "");
  const jobs = new BackgroundJobs(join(root, "state"));
  await assert.rejects(jobs.start("echo changed > alias", cwd), /hard-linked file/);
  assert.equal(jobs.pids().length, 0); assert.equal(readFileSync(victim, "utf8"), "keep");
});

test("a missing or broad workspace fails closed, without creating output", { skip }, async () => {
  const result = await runShell({ command: "echo should-not-run", cwd: "/" });
  assert.equal(result.stdout, "");
  assert.match(result.error ?? "", /specific workspace/);
  const missing = await runShell({ command: "echo should-not-run", cwd: join(tmpdir(), "missing-hormes-workspace-does-not-exist") });
  assert.equal(missing.stdout, "");
  assert.ok(missing.error);
});

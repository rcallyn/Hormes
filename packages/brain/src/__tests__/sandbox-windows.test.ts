import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "@hormes/core";
import { runShell } from "../shell.ts";
import { assertWorkspaceIntegrity, shellSandbox } from "../sandbox.ts";

// The AppContainer launcher (apps/windows/Sandbox): `dotnet build apps/windows/Sandbox` puts it in build/.
const exe = process.env["HORMES_WINDOWS_SANDBOX"] || join(REPO_ROOT, "build", "hormes-sandbox.exe");
const skip = process.platform !== "win32" ? "Windows only" : !existsSync(exe) ? `hormes-sandbox.exe is not built (dotnet build apps/windows/Sandbox)` : false;

function dirs(): { ws: string; outside: string; done(): void } {
  const base = realpathSync.native(mkdtempSync(join(tmpdir(), "hormes-sbx-test-")));
  const ws = join(base, "ws"), outside = join(base, "outside");
  for (const d of [ws, outside]) mkdirSync(d, { recursive: true });
  return { ws, outside, done: () => rmSync(base, { recursive: true, force: true }) };
}

test("sandbox: echo works and a file can be written in the workspace", { skip }, async () => {
  const d = dirs();
  try {
    const r = await runShell({ command: "echo hello-sandbox; Set-Content -Path inside.txt -Value written", cwd: d.ws });
    assert.equal(r.error, undefined);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /hello-sandbox/);
    assert.equal(r.isolated, true);
    assert.match(readFileSync(join(d.ws, "inside.txt"), "utf8"), /written/);
  } finally { d.done(); }
});

test("sandbox: a file outside the workspace cannot be read or written", { skip }, async () => {
  const d = dirs();
  try {
    writeFileSync(join(d.outside, "private.txt"), "top-secret-marker");
    const read = await runShell({ command: `Get-Content -Path '${join(d.outside, "private.txt")}'`, cwd: d.ws });
    assert.notEqual(read.code, 0);
    assert.doesNotMatch(read.stdout, /top-secret-marker/);
    const write = await runShell({ command: `Set-Content -Path '${join(d.outside, "planted.txt")}' -Value x`, cwd: d.ws });
    assert.notEqual(write.code, 0);
    assert.equal(existsSync(join(d.outside, "planted.txt")), false);
  } finally { d.done(); }
});

test("sandbox: no network, not even loopback", { skip }, async () => {
  const d = dirs();
  const server = createServer((_, res) => res.end("reachable"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  try {
    const r = await runShell({ command: `Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 http://127.0.0.1:${port}/`, cwd: d.ws });
    assert.notEqual(r.code, 0);
    assert.doesNotMatch(r.stdout, /reachable/);
  } finally { server.close(); d.done(); }
});

test("sandbox: a read-only workspace blocks writes, the one fixed output file stays writable", { skip }, async () => {
  const d = dirs();
  try {
    const out = join(d.ws, "verdict.json");
    const r = await runShell({ command: "Set-Content -Path other.txt -Value x; Set-Content -Path verdict.json -Value ok", cwd: d.ws, readOnlyWorkspace: true, writableFiles: [out] });
    assert.equal(existsSync(join(d.ws, "other.txt")), false);
    assert.match(readFileSync(out, "utf8"), /ok/);
    assert.equal(r.isolated, true);
  } finally { d.done(); }
});

test("sandbox: the environment carries no HORMES_* or API-key variables", { skip }, async () => {
  const d = dirs();
  const saved = { a: process.env["HORMES_TEST_LEAK"], b: process.env["OPENAI_API_KEY"] };
  process.env["HORMES_TEST_LEAK"] = "leak-marker"; process.env["OPENAI_API_KEY"] = "sk-leak-marker";
  try {
    const r = await runShell({ command: "Get-ChildItem Env: | ForEach-Object { $_.Name + '=' + $_.Value }", cwd: d.ws });
    assert.equal(r.code, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /HORMES_|_API_KEY|leak-marker/i);
    assert.match(r.stdout, /SystemRoot=/i);
  } finally {
    if (saved.a === undefined) delete process.env["HORMES_TEST_LEAK"]; else process.env["HORMES_TEST_LEAK"] = saved.a;
    if (saved.b === undefined) delete process.env["OPENAI_API_KEY"]; else process.env["OPENAI_API_KEY"] = saved.b;
    d.done();
  }
});

test("sandbox: a workspace holding a secret-named entry is refused, as is one containing a protected root", { skip }, async () => {
  const d = dirs();
  try {
    writeFileSync(join(d.ws, ".env"), "KEY=1");
    await assert.rejects(assertWorkspaceIntegrity(d.ws), /secret-named/);
    assert.throws(() => shellSandbox(d.outside, [d.outside]), /protected or secret/);
    assert.throws(() => shellSandbox(d.ws, [], [join(d.ws, "inner")]), /protected or secret/);
  } finally { d.done(); }
});

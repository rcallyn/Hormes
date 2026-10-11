import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyAction, classifyAppleScript, classifyToolScope, shellWorkspaceReason } from "../policy.ts";

test("code execution controls and external agents require one exact approval without standing grants", () => {
  for (const app of ["Terminal", "iTerm2", "Warp", "Script Editor", "Automator", "Shortcuts", "Visual Studio Code", "Cursor", "Xcode", "Codex"]) {
    for (const kind of ["type", "key", "left_click", "open_app"]) {
      const ctx = { kind, app, text: "python3 untrusted.py", granted: true };
      assert.equal(classifyAction(ctx).verdict, "confirm", `${kind} in ${app}`);
      assert.equal(classifyAction(ctx).grant, undefined, "no reusable code-execution grant");
      assert.equal(classifyAction({ ...ctx, confirmed: true }).verdict, "run");
    }
    assert.equal(classifyAction({ kind: "read", app }).verdict, "run");
  }
  for (const kind of ["agent_start", "agent_send", "self_edit", "self_check"]) {
    assert.equal(classifyAction({ kind, text: "run a script", granted: true }).verdict, "confirm");
    assert.equal(classifyAction({ kind, confirmed: true }).verdict, "run");
  }
  assert.equal(classifyAction({ kind: "type", app: "Notes" }).verdict, "run");
  assert.equal(classifyAction({ kind: "left_click", app: "Safari", target: "JavaScript console" }).verdict, "confirm");
});

test("AppleScript cannot be an opaque code-execution trampoline, even after approval", () => {
  for (const script of ['do shell script "python3 untrusted.py"', 'tell application "Terminal" to do script "python3 untrusted.py"', 'tell application "iTerm2" to write text "python3 untrusted.py"', 'run script (POSIX file "/tmp/a.scpt")', 'load script file "a.scpt"', 'use framework "Foundation"', 'current application\'s NSFileManager\'s defaultManager()', 'tell application "Safari" to do JavaScript "fetch(1)"', 'tell application "Shortcuts" to run shortcut "unknown"']) {
    for (const confirmed of [false, true]) assert.equal(classifyAppleScript({ script, confirmed }).verdict, "refuse", script);
  }
  assert.equal(classifyAppleScript({ script: 'tell application "System Events" to keystroke "x"', app: "Terminal" }).verdict, "refuse");
  assert.equal(classifyAppleScript({ script: 'tell application "Music" to play' }).verdict, "run");
});

test("workspace authorization uses the user's request and an approval does not remove scope restrictions", () => {
  const base = { kind: "run_shell", text: "python3 example.py", cwd: "/tmp/project", home: "/Users/test", repoRoot: "/tmp/hormes", request: "analyze a document" };
  assert.equal(classifyAction(base).verdict, "confirm");
  assert.equal(classifyAction({ ...base, request: "analyze /tmp/project" }).verdict, "run");
  assert.equal(classifyAction({ ...base, confirmed: true }).verdict, "run");
  assert.ok(shellWorkspaceReason("/Users/test", "/Users/test"));
  assert.ok(shellWorkspaceReason("/", "/Users/test"));
  assert.ok(shellWorkspaceReason("/dev", "/Users/test"));
  assert.ok(shellWorkspaceReason("/opt/homebrew/bin", "/Users/test"));
  assert.equal(shellWorkspaceReason("/tmp/project", "/Users/test"), undefined);
  for (const name of ["run_shell", "type", "applescript", "agent_send", "self_edit", "thread_start", "write_file"]) assert.equal(classifyToolScope(name, {}, "sessions:a").verdict, "refuse");
  assert.equal(classifyToolScope("agent_read", { agent: "sessions:a" }, "sessions:a").verdict, "run");
  assert.equal(classifyToolScope("agent_read", { agent: "sessions:b" }, "sessions:a").verdict, "refuse");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { ipcPath, isPipePath } from "../ipc.ts";

/**
 * The Windows app (apps/windows Ipc.PipeName) dials the pipe by computing the same name, so the
 * vector below is shared: change the mapping and both sides, and this test, change together.
 */
test("a socket path is itself off Windows", () => {
  assert.equal(ipcPath("/Users/u/.hormes/hormes.sock", "darwin"), "/Users/u/.hormes/hormes.sock");
});

test("on Windows a socket path names a pipe: sha256 of the lower-cased full path, 16 hex", { skip: process.platform !== "win32" && "path.resolve is the host's" }, () => {
  assert.equal(ipcPath(String.raw`C:\Users\Example\.hormes\hormes.sock`, "win32"), String.raw`\\.\pipe\hormes-63d0ed936cf4c68c`);
  assert.equal(ipcPath(String.raw`c:\users\EXAMPLE\.hormes\hormes.sock`, "win32"), String.raw`\\.\pipe\hormes-63d0ed936cf4c68c`);
});

test("a pipe path is used as given", () => {
  assert.equal(ipcPath(String.raw`\\.\pipe\mine`, "win32"), String.raw`\\.\pipe\mine`);
  assert.ok(isPipePath(String.raw`\\?\pipe\x`));
  assert.ok(!isPipePath(String.raw`C:\pipe\x`));
});

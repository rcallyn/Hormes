import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("native signal shutdown saves asynchronously and respects a cancelled quit", { skip: process.platform !== "darwin", timeout: 60000 }, () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const output = execFileSync("/bin/bash", ["apps/mac/Scripts/termination-check.sh"], { cwd: root, encoding: "utf8", timeout: 55000 });
  assert.match(output, /decline: save refusal cancels quit and keeps the app alive/);
  assert.match(output, /terminate: acknowledged save precedes clean exit/);
  assert.match(output, /interrupt: acknowledged save precedes clean exit/);
  assert.match(output, /termination-check: all ok/);
  assert.equal(output.includes("check: FAIL"), false);
});

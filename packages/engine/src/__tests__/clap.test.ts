import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
test("local double-clap detector and unchanged owner gate reject invalid wakes", { skip: process.platform !== "darwin", timeout: 180000 }, () => {
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  const output = execFileSync("/bin/bash", ["apps/mac/Scripts/wake-gate-check.sh", "claps"], { cwd: root, encoding: "utf8", timeout: 170000 });
  assert.match(output, /clap alone opens no paid session when owner denies/);
  assert.match(output, /owner approval completes the existing wake path/);
  assert.match(output, /wake-gate-check: all ok/);
  assert.equal(output.includes("check: FAIL"), false);
});

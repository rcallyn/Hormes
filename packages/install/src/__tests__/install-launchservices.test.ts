import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultRealpath, describeLaunchServices, hormesRecords, parseLsBundleDump, staleHormesRecords } from "../launchservices.ts";

/**
 * `lsregister -dump Bundle` parsing and the stale rule. `open -a Hormes` resolves by
 * name through this table, so a Hormes.app in the Trash (a foreign bundle with the same
 * name and a different id) or a stage bundle counts as a second Hormes.
 */

const dump = readFileSync(fileURLToPath(new URL("./fixtures/ls-dump-bundle.txt", import.meta.url)), "utf8");
const INSTALLED = "/Applications/Hormes.app";
const ROOTS = ["/Users/user/.hormes/worktrees", "/Users/user/.hormes/trash", "/Users/user/.Trash", "/Users/user/jarvis/build/stage", "/Users/user/jarvis/build/previous"];

test("launchservices: the dump splits on the dashed lines into records with path (the (0x…) tag stripped), identifier and executable", () => {
  const records = parseLsBundleDump(dump);
  assert.deepEqual(
    records.map((r) => [r.path, r.identifier, r.executable]),
    [
      ["/Applications/Hormes.app", "com.hormes.app", "Contents/MacOS/Hormes"],
      ["/Users/user/.hormes/worktrees/se_x/apps/mac/.build/ear-probe/EarProbe.app", "com.hormes.app.ear-probe", "Contents/MacOS/ear-probe"],
      ["/Users/user/jarvis/apps/mac/.build/ear-probe/EarProbe.app", "com.hormes.app.ear-probe", "Contents/MacOS/ear-probe"],
      ["/Users/user/.Trash/Hormes.app", "com.example.other", "Contents/MacOS/Hormes"],
      ["/Users/user/jarvis/build/stage/Hormes.app", "com.hormes.app", "Contents/MacOS/Hormes"],
      ["/System/Applications/Utilities/Grapher.app", "com.apple.grapher", "Contents/MacOS/Grapher"],
    ],
  );
  assert.deepEqual(parseLsBundleDump(""), []);
});

test("launchservices: stale = Hormes's id elsewhere, a sub-id under a stale root, or a Hormes.app by name under a stale root; the live checkout's probe and the installed bundle never", () => {
  const records = parseLsBundleDump(dump);
  const stale = staleHormesRecords(records, { installed: INSTALLED, bundleId: "com.hormes.app", staleRoots: ROOTS, exists: () => true });
  assert.deepEqual(
    stale.map((r) => r.path),
    ["/Users/user/.hormes/worktrees/se_x/apps/mac/.build/ear-probe/EarProbe.app", "/Users/user/.Trash/Hormes.app", "/Users/user/jarvis/build/stage/Hormes.app"],
  );
  // A probe bundle whose path is gone is stale wherever it was; /Applications is never.
  const gone = staleHormesRecords(records, { installed: INSTALLED, bundleId: "com.hormes.app", staleRoots: ROOTS, exists: () => false });
  assert.ok(gone.some((r) => r.path === "/Users/user/jarvis/apps/mac/.build/ear-probe/EarProbe.app"));
  assert.ok(!gone.some((r) => r.path === INSTALLED));
  assert.ok(!gone.some((r) => r.path.endsWith("Grapher.app")), "other people's bundles are not ours to touch");
  assert.deepEqual(
    hormesRecords(records, "com.hormes.app").map((r) => r.path),
    ["/Applications/Hormes.app", "/Users/user/jarvis/build/stage/Hormes.app"],
  );
});

test("launchservices: a record at a symlink that resolves to the installed bundle is the installed bundle, not Hormes's id elsewhere; defaultRealpath resolves links and hands back a path that is gone", () => {
  const LINK = "/Users/user/jarvis/build/Hormes.app";
  const records = [...parseLsBundleDump(dump), { path: LINK, identifier: "com.hormes.app", executable: "Contents/MacOS/Hormes" }];
  const resolved = staleHormesRecords(records, { installed: INSTALLED, bundleId: "com.hormes.app", staleRoots: ROOTS, exists: () => true, realpath: (p) => (p === LINK ? INSTALLED : p) });
  assert.ok(!resolved.some((r) => r.path === LINK), "unregistering the link would unregister /Applications/Hormes.app");
  assert.equal(resolved.length, 3, "the three real leftovers are still stale");
  const unresolved = staleHormesRecords(records, { installed: INSTALLED, bundleId: "com.hormes.app", staleRoots: ROOTS, exists: () => true, realpath: (p) => p });
  assert.ok(unresolved.some((r) => r.path === LINK), "rule (a) without the resolution");

  const root = mkdtempSync(join(tmpdir(), "jh-realpath-"));
  try {
    mkdirSync(join(root, "Real.app"));
    symlinkSync(join(root, "Real.app"), join(root, "Link.app"));
    assert.equal(defaultRealpath(join(root, "Link.app")), defaultRealpath(join(root, "Real.app")));
    assert.equal(defaultRealpath(join(root, "gone", "Nope.app")), join(root, "gone", "Nope.app"), "a path that is gone comes back as itself, so the gone rule still sees it");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("launchservices: the build's rollback snapshots are stale wherever LaunchServices met them — the old build/previous/Hormes.app (a full bundle with Hormes's id, registered as a second Hormes) and any record at the new .previous name", () => {
  const records = [
    ...parseLsBundleDump(dump),
    { path: "/Users/user/jarvis/build/previous/Hormes.app", identifier: "com.hormes.app", executable: "Contents/MacOS/Hormes" },
    { path: "/Users/user/jarvis/build/previous/Hormes.app.previous", identifier: "com.hormes.app", executable: "Contents/MacOS/Hormes" }, // a record an install from before 2026-09-13 left behind
  ];
  // Present on disk or gone: stale either way — Hormes's id anywhere but /Applications.
  for (const exists of [() => true, () => false]) {
    const stale = staleHormesRecords(records, { installed: INSTALLED, bundleId: "com.hormes.app", staleRoots: ROOTS, exists, realpath: (p) => p });
    assert.ok(stale.some((r) => r.path === "/Users/user/jarvis/build/previous/Hormes.app"), `exists=${exists()}`);
    assert.ok(stale.some((r) => r.path === "/Users/user/jarvis/build/previous/Hormes.app.previous"), `exists=${exists()} (a path from before 2026-09-13)`);
    assert.ok(!stale.some((r) => r.path === INSTALLED));
  }
});

test("launchservices: the summary clause names the installed record, what was unregistered and what still remains", () => {
  const records = parseLsBundleDump(dump);
  const stale = staleHormesRecords(records, { installed: INSTALLED, bundleId: "com.hormes.app", staleRoots: ROOTS, exists: () => true });
  assert.equal(describeLaunchServices(records, [], [], INSTALLED), "LaunchServices: /Applications/Hormes.app registered");
  assert.equal(
    describeLaunchServices(records, stale, [], INSTALLED),
    "LaunchServices: /Applications/Hormes.app registered · also /Users/user/.hormes/worktrees/se_x/apps/mac/.build/ear-probe/EarProbe.app, /Users/user/.Trash/Hormes.app, /Users/user/jarvis/build/stage/Hormes.app",
  );
  assert.equal(
    describeLaunchServices(records, stale, stale.map((r) => r.path), INSTALLED),
    "LaunchServices: /Applications/Hormes.app registered · 3 stale records unregistered",
  );
  assert.match(describeLaunchServices([], [], [], INSTALLED), /NOT registered/);
});

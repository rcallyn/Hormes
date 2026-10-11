import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Compile the production script against Chrome's real terminology, but never
// execute it. Fake native replies cannot reveal AppleScript's `tab` class collision.
const nativeSource = readFileSync(new URL("../../native/Browser.swift", import.meta.url), "utf8");
const available = process.platform === "darwin" && existsSync("/Applications/Google Chrome.app/Contents/Resources/scripting.sdef");
function discoveryScript(): string {
  const body = /private func shoppingTabsSource\(app: String\) -> String \{\s*return """([\s\S]*?)"""\s*\}/.exec(nativeSource)?.[1];
  assert.ok(body, "read the actual production discovery script");
  const script = body.replaceAll(String.raw`\(quoted(app))`, '"Google Chrome"');
  assert.ok(!script.includes(String.raw`\(`), "no unresolved Swift interpolation");
  return script;
}
function compiledRow(script: string): { row: string; tabClassRefs: number } {
  const dir = mkdtempSync(join(tmpdir(), "hormes-discovery-compiler-"));
  try {
    const source = join(dir, "discovery.applescript"), output = join(dir, "discovery.scpt");
    writeFileSync(source, script);
    execFileSync("/usr/bin/osacompile", ["-o", output, source], { timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] });
    const decompiled = execFileSync("/usr/bin/osadecompile", [output], { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] });
    const row = decompiled.split("\n").find(line => /set rows to rows/.test(line));
    assert.ok(row, "compiled script still serializes each discovered tab");
    return { row, tabClassRefs: readFileSync(output).toString("latin1").split("CrTb").length - 1 };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("native grocery discovery compiles its two field separators as ASCII tab data", { skip: !available }, () => {
  const { row } = compiledRow(discoveryScript());
  assert.equal(row.match(/ASCII character 9/g)?.length, 2, "window ID, tab ID and URL are separated by actual tab characters");
  assert.doesNotMatch(row, /«class CrTb»/, "Chrome's tab class must never be concatenated as a field separator");
});

test("the former bare-tab separator reproduces Chrome's compiled class collision", { skip: !available }, () => {
  const script = discoveryScript();
  assert.equal(script.match(/\(ASCII character 9\)/g)?.length, 2);
  const defective = script.replaceAll("(ASCII character 9)", "tab");
  const { row, tabClassRefs } = compiledRow(defective);
  const valid = compiledRow(script);
  assert.equal(tabClassRefs - valid.tabClassRefs, 2, `negative control must add two Chrome tab-class constants; decompiled row: ${row}`);
  assert.equal(row.includes("ASCII character 9"), false);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";

const buildURL = new URL("../../apps/workspace/scripts/build.mjs", import.meta.url);
const require = createRequire(buildURL);
const entry = require.resolve("@excalidraw/excalidraw");
const source = readFileSync(entry, "utf8");
const version = JSON.parse(readFileSync(resolve(dirname(entry), "../../package.json"), "utf8")).version as string;
const moduleURL = new URL("../../apps/workspace/scripts/excalidraw-history.mjs", import.meta.url);
const { patchExcalidrawArrowHistory } = await import(moduleURL.href) as { patchExcalidrawArrowHistory(source: string, version: string): string };

/** Execute the real distributed keyup function with a tiny scene/history host.
 * This detects whether capture precedes the render that commits binding edits;
 * the browser probe separately checks actual scene undo/redo coordinates.
 */
function keyupTrace(bundle: string, key: string): string[] {
  const prefix = '"onKeyUp",Fe(', start = bundle.indexOf(prefix) + prefix.length;
  const end = bundle.indexOf('));C(this,"isToolSupported"', start);
  assert.ok(start >= prefix.length && end > start);
  const trace: string[] = [];
  const host = {
    state: { isBindingEnabled: true, selectedLinearElement: null, zoom: { value: 1 } },
    scene: { getSelectedElements: () => [], getNonDeletedElementsMap: () => new Map(), getNonDeletedElements: () => [] },
    store: { shouldCaptureIncrement: () => trace.push("capture") },
    setState: () => trace.push("render"),
    flowChartNavigator: { isExploring: false }, flowChartCreator: { isCreatingChart: false },
  };
  // Other key paths remain in the function but are not taken by these cases.
  const factory = new Function("y", "an", "cn", "he", "sn", `return (${bundle.slice(start, end)});`);
  const handler = factory.call(host, { SPACE: " ", CTRL_OR_CMD: "metaKey" }, (value: string) => value.startsWith("Arrow"), () => trace.push("bind"), () => false, () => true) as (event: { key: string; metaKey: boolean; altKey: boolean }) => void;
  handler({ key, metaKey: false, altKey: false });
  return trace;
}

test("the pinned production arrow handler captures after binding and before rendering", () => {
  assert.equal(version, "0.18.0", "an upgrade requires reviewing the source transform");
  const patched = patchExcalidrawArrowHistory(source, version);
  assert.equal(patched.length - source.length, "this.store.shouldCaptureIncrement(),".length, "the patch is one native history call");
  for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
    assert.deepEqual(keyupTrace(source, key), ["bind", "render"], "the distributed regression is present");
    assert.deepEqual(keyupTrace(patched, key), ["bind", "capture", "render"]);
  }
  assert.deepEqual(keyupTrace(patched, "a"), [], "ordinary text keyup does not create a history boundary");
  assert.equal(readFileSync(entry, "utf8"), source, "building does not rewrite the installed dependency");
});

test("source/version drift, absent or duplicate branches, and repeated patching fail closed", () => {
  assert.throws(() => patchExcalidrawArrowHistory(source, "0.18.1"), /expected 0.18.0/);
  assert.throws(() => patchExcalidrawArrowHistory("", version), /exactly one onKeyUp arrow branch/);
  assert.throws(() => patchExcalidrawArrowHistory(source + source, version), /handlers=2, branches=2/);
  assert.throws(() => patchExcalidrawArrowHistory(source.replace('"onKeyUp",Fe(', '"changedKeyUp",Fe('), version), /handlers=0/);
  assert.throws(() => patchExcalidrawArrowHistory(patchExcalidrawArrowHistory(source, version), version), /branches=0/);
});

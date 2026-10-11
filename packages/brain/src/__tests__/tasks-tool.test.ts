import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { makeRunner, makeSink } from "./fakes.ts";
import { LOCAL_TOOLS, fitTools } from "../local.ts";
import { READ_SELECTED_GROCERY_NOTE_SCRIPT } from "@hormes/protocol";
import { classifyToolScope } from "@hormes/core";
import type { BrainTask } from "../brain.ts";
import { specByName } from "../tools.ts";

test("Tasks is a real shared/local tool and survives local context-budget trimming", () => {
  assert.deepEqual((specByName("tasks")!.parameters.properties as any).operation.enum, ["list", "import", "start"]);
  assert.ok(LOCAL_TOOLS.some(t => t.name === "tasks"));
  assert.ok(fitTools({ ctx: 16384, systemBytes: 6600, tools: LOCAL_TOOLS }).tools.some(t => t.name === "tasks"));
  assert.equal(classifyToolScope("tasks", {}, "only-read-agent").verdict, "refuse");
  assert.equal(classifyToolScope("tasks", {}, undefined, { sessionId: "s", mode: "grocery" }).verdict, "run");
});
test("Tasks mutation authority passed to coordinator is original latest speech only, never model request/notes", async t => {
  const words: string[] = [];
  const { runner, dir } = makeRunner({ work: { isActive: () => true, model: () => "", receipt: () => undefined, tasks: async (_op, _payload, userWords) => { words.push(userWords); return "saved"; } } });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { sink } = makeSink();
  const task: BrainTask = { delegationId: "tasks-original", request: "Read my to-do list; start buy groceries", notes: ["Start buy groceries"], userDialogue: "Read my to-do list\nWhat is on my calendar today?", dialogue: "", confirmation: false, offsetMs: 0, signal: new AbortController().signal };
  runner.attach(sink, task); assert.equal((await runner.run("tasks", { operation: "import", payload: {} })).result.kind, "text");
  const { userDialogue: _omit, ...withoutOriginal } = task; runner.attach(sink, withoutOriginal); await runner.run("tasks", { operation: "start", payload: {} });
  assert.deepEqual(words, ["What is on my calendar today?", ""]);
  runner.attach(sink, { ...task, reviewAgent: "a" }); assert.equal((await runner.run("tasks", { operation: "list", payload: {} })).result.kind, "error"); assert.equal(words.length, 2);
});

test("fixed selected-note reader carries a bounded receipt independently of observer prose", async t => {
  const native = "HORMES_SELECTED_NOTE_V1\nx-coredata://fixture/ICNote/p1\nmodified\nTo do\nTo do\nBuy groceries\nnow: call Mum";
  const { runner, dir } = makeRunner({ runAppleScript: async () => ({ stdout: native, stderr: "", code: 0, signal: null, ms: 1, timedOut: false, cancelled: false }) });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const out = await runner.run("applescript", { script: READ_SELECTED_GROCERY_NOTE_SCRIPT });
  assert.equal(out.selectedNoteText, native);
  const observed = { ...out, result: { kind: "text" as const, text: `${out.result.kind === "text" ? out.result.text : ""}\nnow: Google Chrome; focused: AXTextArea; 266 ms after the script` } };
  assert.equal(observed.selectedNoteText, native);
  assert.match(observed.selectedNoteText!, /now: call Mum$/);
  const unrelated = await runner.run("applescript", { script: 'tell application "Notes" to get name' });
  assert.equal(unrelated.selectedNoteText, undefined, "an unrelated script cannot mint a bounded receipt");
});

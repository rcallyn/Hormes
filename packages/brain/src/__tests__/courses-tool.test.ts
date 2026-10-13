import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { makeRunner, makeSink } from "./fakes.ts";
import { LOCAL_TOOLS } from "../local.ts";
import type { BrainTask } from "../brain.ts";
import { specByName } from "../tools.ts";

const task: BrainTask = { delegationId: "courses", request: "What did the slides say about round robin?", userDialogue: "What did the slides say about round robin?", dialogue: "", confirmation: false, offsetMs: 0, signal: new AbortController().signal };

test("courses: a course tool with six operations; the local brain leaves it out, as it does the planner, to keep its tool table in budget", () => {
  assert.deepEqual((specByName("courses")!.parameters.properties as { operation: { enum: string[] } }).operation.enum, ["list", "files", "search", "read", "inbox", "import"]);
  assert.match(specByName("courses")!.description, /cite file and location/);
  assert.ok(!LOCAL_TOOLS.some((t) => t.name === "courses") && !LOCAL_TOOLS.some((t) => t.name === "planner"));
});

test("courses: the runner hands the operation and payload to the engine's library, refuses a bad payload, and says when there is none", async (t) => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const { runner, dir } = makeRunner({ courses: async (operation, payload) => { calls.push([operation, payload]); return "{\"hits\":[]}"; } });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  runner.attach(makeSink().sink, task);
  const out = await runner.run("courses", { operation: "search", payload: { query: "round robin", course: "CS 161" } });
  assert.deepEqual(out.result, { kind: "text", text: "{\"hits\":[]}" });
  assert.deepEqual(calls, [["search", { query: "round robin", course: "CS 161" }]]);
  assert.equal((await runner.run("courses", { operation: "search", payload: "round robin" })).result.kind, "error");
  assert.equal(calls.length, 1);
  runner.attach(makeSink().sink, { ...task, reviewAgent: "agent" });
  assert.equal((await runner.run("courses", { operation: "list", payload: {} })).result.kind, "error", "a proactive agent review reads only its agent");
  const bare = makeRunner();
  t.after(() => rmSync(bare.dir, { recursive: true, force: true }));
  bare.runner.attach(makeSink().sink, task);
  const none = (await bare.runner.run("courses", { operation: "list", payload: {} })).result;
  assert.equal(none.kind, "error");
});

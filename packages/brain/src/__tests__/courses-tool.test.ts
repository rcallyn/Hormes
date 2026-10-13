import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { makeRunner, makeSink } from "./fakes.ts";
import { LOCAL_TOOLS } from "../local.ts";
import type { BrainTask } from "../brain.ts";
import { classifyToolScope } from "@hormes/core";
import { specByName } from "../tools.ts";

const task: BrainTask = { delegationId: "courses", request: "What did the slides say about round robin?", userDialogue: "What did the slides say about round robin?", dialogue: "", confirmation: false, offsetMs: 0, signal: new AbortController().signal };

test("courses: a course tool with seven operations; the local brain leaves it out, as it does the planner, to keep its tool table in budget", () => {
  assert.deepEqual((specByName("courses")!.parameters.properties as { operation: { enum: string[] } }).operation.enum, ["list", "files", "search", "read", "inbox", "import", "save"]);
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

test("explain: a worked explanation reaches the engine's notes with its handwriting flag; bad input is refused; display only by policy", async (t) => {
  const shown: unknown[] = [];
  const { runner, dir } = makeRunner({ notes: (n) => shown.push(n) });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  runner.attach(makeSink().sink, task);
  const ok = await runner.run("explain", { title: "Bayes' rule", text: "$$P(A|B) = \frac{P(B|A)P(A)}{P(B)}$$", handwriting: true, course: "STAT 418" });
  assert.equal(ok.result.kind, "text");
  assert.deepEqual(shown, [{ title: "Bayes' rule", text: "$$P(A|B) = \frac{P(B|A)P(A)}{P(B)}$$", handwriting: true, course: "STAT 418" }]);
  assert.equal((await runner.run("explain", { title: "", text: "x" })).result.kind, "error");
  assert.equal((await runner.run("explain", { title: "x", text: "y".repeat(20_001) })).result.kind, "error");
  assert.equal(shown.length, 1);
  assert.equal(classifyToolScope("explain", {}, undefined, { sessionId: "s", mode: "study" }).verdict, "run");
  assert.equal(classifyToolScope("explain", {}, "agent").verdict, "refuse", "a proactive agent review reads only its agent");
  assert.ok(!LOCAL_TOOLS.some((x) => x.name === "explain"));
});

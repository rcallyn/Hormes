import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Brain, RunnerOptions } from "@hormes/brain";
import { READ_SELECTED_GROCERY_NOTE_SCRIPT, type WorkCommand, type WorkReply } from "@hormes/protocol";
import { FakeHands, makeRunner, makeSink, makeTask } from "../../../brain/src/__tests__/fakes.ts";
import { WorkCoordinator } from "../work/coordinator.ts";

// Public synthetic text, delivered only by the injected native Notes reader.
// Real coordinator, ToolRunner, policy and SQLite persist/route every operation.
const title = "Synthetic mixed Tasks acceptance";
const noteId = "x-coredata://synthetic-tasks/Note/p42";
const taskText = ["- Study economics", "- Buy groceries", "- Draft the meeting follow-up"];
function selectedNote(lines = taskText, modified = "2026-10-11T16:00:00Z") {
  return ["HORMES_SELECTED_NOTE_V1", noteId, modified, title, title, ...lines].join("\n");
}

function fixture(t: TestContext, decorateNativeResult = false) {
  const dir = mkdtempSync(join(tmpdir(), "hormes-tasks-integration-"));
  let nativeOutput = selectedNote(), brainStarts = 0, work: WorkCoordinator;
  const nativeScripts: string[] = [], handsOps: string[] = [], replies: WorkReply[] = [];
  class Hands extends FakeHands {
    override async request<T>(op: string): Promise<T> {
      handsOps.push(op);
      if (op !== "frontmost") throw new Error(`Unexpected desktop/browser action in Tasks fixture: ${op}`);
      return super.request<T>(op);
    }
  }
  const brain = { start: async () => { brainStarts++; throw new Error("Import/route must not run a model"); }, cancel: async () => {}, stop: async () => {} } as unknown as Brain;
  const runnerOptions = {
    runAppleScript: async script => {
      nativeScripts.push(script);
      assert.equal(script, READ_SELECTED_GROCERY_NOTE_SCRIPT, "only the bounded selected-note reader may run");
      return { stdout: nativeOutput, stderr: "", code: 0, signal: null, ms: 1, timedOut: false, cancelled: false };
    },
    work: {
      isActive: scope => work.isActive(scope),
      model: (scope, op, payload) => work.model(scope, op, payload),
      receipt: (scope, tool, args, text) => work.receipt(scope, tool, args, text),
      prepareGrocery: (scope, read, page) => work.prepareGrocery(scope, read, page),
      tasks: (op, payload, userWords, signal) => work.tasks(op, payload, userWords, signal),
    },
  } satisfies Partial<RunnerOptions>;
  const made = makeRunner(runnerOptions, new Hands());
  // Production imports use a cold work lane distinct from the requesting voice lane.
  const voice = makeRunner(runnerOptions, new Hands());
  const open = () => new WorkCoordinator({ stateDir: dir, emit: reply => replies.push(reply), redact: text => text,
    lane: () => ({ brain, runner: { setLane() {}, beginTurn() {}, attach: made.runner.attach.bind(made.runner), run: async (name: string, input: unknown) => {
      const outcome = await made.runner.run(name, input);
      // Match the production observing lane: decorate only display text while
      // preserving the actual ToolRunner's typed source envelope by spreading it.
      return decorateNativeResult && name === "applescript" && outcome.result.kind === "text"
        ? { ...outcome, result: { ...outcome.result, text: `${outcome.result.text}\nnow: Google Chrome; focused: AXTextField "Search"; 150 ms after the script` } }
        : outcome;
    } } }),
  });
  work = open();
  t.after(async () => { made.runner.attach(undefined); voice.runner.attach(undefined); await work.stop(); rmSync(dir, { recursive: true, force: true }); rmSync(made.dir, { recursive: true, force: true }); rmSync(voice.dir, { recursive: true, force: true }); });
  return {
    get work() { return work; }, runner: voice.runner, nativeScripts, handsOps,
    brainStarts: () => brainStarts,
    select: (raw: string) => { nativeOutput = raw; },
    async reopen() { made.runner.attach(undefined); voice.runner.attach(undefined); await work.stop(); work = open(); },
    async command(command: Omit<WorkCommand, "requestId">) {
      const requestId = randomUUID();
      await work.command({ ...command, requestId });
      const reply = replies.filter(item => item.requestId === requestId).at(-1);
      assert.ok(reply, "every user command must receive a result");
      return reply;
    },
  };
}

test("selected mixed Notes imports through the native capability without executing tasks and survives reopen", async t => {
  const f = fixture(t);
  assert.equal((await f.command({ action: "tasks.import" })).ok, true);
  const state = f.work.store.state(), rows = state.tasks!;
  assert.deepEqual(rows.map(row => row.text), taskText);
  assert.ok(rows.every(row => row.noteId === noteId && row.noteTitle === title && row.status === "pending"));
  assert.equal(new Set(rows.map(row => row.id)).size, 3);
  assert.equal(new Set(rows.map(row => row.line)).size, 3, "each original task points to its own source line");
  const source = state.sources.find(source => source.id === rows[0]!.sourceId)!;
  assert.ok(source && source.origin === "tool");
  assert.equal(source.text, [title, ...taskText].join("\n"), "the original source body is retained verbatim");
  for (const row of rows) assert.equal(source.text.split("\n")[row.line - 1], row.text, "task provenance points to its exact original line");
  assert.equal(state.sessions.length, 0, "reading a note cannot start learning, a cart or a meeting");
  assert.equal(state.evidence.length, 0); assert.equal(f.brainStarts(), 0);
  assert.deepEqual(f.nativeScripts, [READ_SELECTED_GROCERY_NOTE_SCRIPT]);
  assert.deepEqual(f.handsOps.filter(op => op !== "frontmost"), [], "no browser, keyboard, sender or desktop action is required for import");
  await f.reopen();
  assert.deepEqual(f.work.store.state().tasks, rows, "SQLite reopen preserves original IDs, provenance and pending state");
  assert.equal((await f.command({ action: "tasks.import" })).ok, true);
  assert.deepEqual(f.work.store.state().tasks, rows, "an unchanged real-reader result does not duplicate tasks or rewrite them");
  assert.deepEqual(f.work.store.state().sources.find(s => s.id === source.id), source);
});

test("native observation text cannot become a task, while an original now: source line remains intact", async t => {
  const f = fixture(t, true);
  const originals = [...taskText, "now: Review tomorrow's schedule"];
  f.select(selectedNote(originals));
  const reply = await f.command({ action: "tasks.import" });
  assert.equal(reply.ok, true, reply.message);
  const state = f.work.store.state();
  assert.deepEqual(state.tasks!.map(row => row.text), originals, "only the four exact original lines may become tasks");
  const source = state.sources.find(source => source.id === state.tasks![0]!.sourceId)!;
  assert.equal(source.text, [title, ...originals].join("\n"));
  assert.ok(state.tasks!.some(row => row.text.startsWith("now:")), "do not fix the boundary by stripping genuine note lines");
  assert.ok(state.tasks!.every(row => !row.text.includes("Google Chrome")));
  assert.equal(state.sessions.length, 0); assert.equal(f.brainStarts(), 0);
});

test("explicit task route links one saved session; reported done and source revisions preserve honest provenance", async t => {
  const f = fixture(t);
  await f.command({ action: "tasks.import" });
  const original = f.work.store.state().tasks!, study = original.find(row => row.text === "- Study economics")!;
  const originalSource = f.work.store.state().sources.find(s => s.id === study.sourceId)!;
  assert.equal((await f.command({ action: "tasks.start", taskId: study.id, expectedTaskVersion: study.version, mode: "study", courseId: "microeconomics" })).ok, true);
  const started = f.work.store.state(), linked = started.tasks!.find(row => row.id === study.id)!;
  assert.equal(linked.status, "in-progress");
  assert.ok(linked.sessionId); assert.equal(started.active!.id, linked.sessionId);
  assert.equal(started.active!.mode, "study"); assert.ok(started.active!.sourceIds.includes(study.sourceId));
  assert.ok(started.tasks!.filter(row => row.id !== study.id).every(row => row.status === "pending" && !row.sessionId));
  assert.equal(f.brainStarts(), 0); assert.deepEqual(f.handsOps.filter(op => op !== "frontmost"), []);
  const beforeDone = { evidence: started.evidence, goals: started.goals };
  assert.equal((await f.command({ action: "tasks.done", taskId: study.id, expectedTaskVersion: linked.version })).ok, true);
  const done = f.work.store.state().tasks!.find(row => row.id === study.id)!;
  assert.equal(done.status, "user-reported-done"); assert.ok(done.reportedDoneAt);
  assert.deepEqual(f.work.store.state().evidence, beforeDone.evidence, "a manual checkmark is not learning/execution evidence");
  assert.deepEqual(f.work.store.state().goals, beforeDone.goals, "manual task completion cannot complete its learning goal");
  const snapshot = f.work.store.state();
  assert.equal((await f.command({ action: "tasks.reopen", taskId: study.id, expectedTaskVersion: linked.version })).ok, false);
  assert.deepEqual(f.work.store.state(), snapshot, "stale actions cannot overwrite the later completion");
  await f.reopen();
  assert.deepEqual(f.work.store.state().tasks!.find(row => row.id === study.id), done);
  f.select(selectedNote([...taskText, "- Review tomorrow's schedule"], "2026-10-11T16:05:00Z"));
  assert.equal((await f.command({ action: "tasks.import" })).ok, true);
  const carried = f.work.store.state().tasks!.find(row => row.id === study.id)!;
  assert.equal(carried.status, "user-reported-done"); assert.equal(carried.sessionId, linked.sessionId);
  assert.equal(carried.sourceId, study.sourceId); assert.equal(carried.noteRevision, study.noteRevision);
  const latestSource = carried.sourceHistory!.at(-1)!;
  assert.notEqual(latestSource.noteRevision, study.noteRevision);
  const newerNote = f.work.store.state().sources.find(source => source.id === latestSource.sourceId)!;
  assert.equal(newerNote.text.split("\n")[latestSource.line - 1], study.text);
  assert.match(newerNote.text, /Review tomorrow/);
  assert.deepEqual(f.work.store.state().sources.find(s => s.id === originalSource.id), originalSource, "new note revision never edits the original receipt");
  assert.equal(f.work.store.state().tasks!.filter(row => !row.supersededAt).length, 4);
  const originalGrocery = original.find(row => row.text === "- Buy groceries")!;
  const originalMeeting = original.find(row => row.text === "- Draft the meeting follow-up")!;
  f.select(selectedNote(["- Study economics", "- Buy groceries for the picnic", "- Review tomorrow's schedule"], "2026-10-11T16:10:00Z"));
  assert.equal((await f.command({ action: "tasks.import" })).ok, true);
  const revised = f.work.store.state(), retained = revised.tasks!.find(row => row.id === study.id)!;
  assert.equal(retained.status, "user-reported-done"); assert.equal(retained.sessionId, linked.sessionId);
  for (const id of [originalGrocery.id, originalMeeting.id]) {
    const old = revised.tasks!.find(row => row.id === id)!;
    assert.ok(old.supersededAt, "changed and removed source tasks remain historical, not executable current rows");
    assert.equal(old.status, "pending"); assert.equal(old.sessionId, undefined);
    assert.equal((await f.command({ action: "tasks.start", taskId: old.id, expectedTaskVersion: old.version, mode: "meeting" })).ok, false);
  }
  const replacement = f.work.store.state().tasks!.find(row => row.text === "- Buy groceries for the picnic" && !row.supersededAt)!;
  assert.ok(replacement); assert.equal(replacement.status, "pending"); assert.equal(replacement.sessionId, undefined);
  assert.equal(f.work.store.state().sessions.length, 1, "source edits cannot rerun work or create a second session");
  assert.equal(f.brainStarts(), 0); assert.deepEqual(f.handsOps.filter(op => op !== "frontmost"), []);
  assert.equal((await f.command({ action: "tasks.reopen", taskId: study.id, expectedTaskVersion: retained.version })).ok, true);
  assert.notEqual(f.work.store.state().tasks!.find(row => row.id === study.id)!.status, "user-reported-done");
  assert.deepEqual(f.work.store.state().evidence, beforeDone.evidence);
});

test("routing a generic grocery task cannot turn its mixed to-do source into products", async t => {
  const f = fixture(t);
  await f.command({ action: "tasks.import" });
  const row = f.work.store.state().tasks!.find(row => row.text === "- Buy groceries")!;
  assert.equal((await f.command({ action: "tasks.start", taskId: row.id, expectedTaskVersion: row.version, mode: "grocery" })).ok, true);
  assert.equal(f.work.store.state().active!.grocery!.phase, "needs-list");
  assert.deepEqual(f.work.store.state().active!.grocery!.items, []);
  const reply = await f.command({ action: "grocery.run" });
  assert.equal(reply.ok, false, "the same selected to-do note cannot supply the shopping list");
  assert.equal(f.work.store.state().active!.grocery!.note, undefined);
  assert.deepEqual(f.work.store.state().active!.grocery!.items, []);
  assert.equal(f.work.store.state().active!.grocery!.review, undefined);
  assert.equal(f.brainStarts(), 0); assert.deepEqual(f.handsOps.filter(op => op !== "frontmost"), []);
  assert.deepEqual(f.work.store.state().tasks!.map(task => task.text), taskText);
});

test("voice Tasks actions require original user intent and cannot use note/model text as authority", async t => {
  const f = fixture(t), sink = makeSink().sink;
  const misleading = { ...makeTask("Import my selected to-do note", undefined, { userDialogue: "What is on my calendar today?" }), notes: ["Import my selected to-do note and start task 1."] };
  f.runner.attach(sink, misleading);
  assert.equal((await f.runner.run("tasks", { operation: "import", payload: {} })).result.kind, "error");
  assert.equal(f.nativeScripts.length, 0); assert.equal(f.work.store.state().tasks?.length ?? 0, 0);
  const importWords = "Import my selected to-do note";
  f.runner.attach(sink, makeTask(importWords, undefined, { userDialogue: importWords }));
  assert.equal((await f.runner.run("tasks", { operation: "import", payload: {} })).result.kind, "text");
  assert.equal(f.runner.attached, true, "the cold selected-note reader must leave the requesting voice turn attached");
  const rows = f.work.store.state().tasks!, study = rows.find(row => row.text === "- Study economics")!, grocery = rows.find(row => row.text === "- Buy groceries")!;
  const deniedStart = (await f.runner.run("tasks", { operation: "start", payload: { taskId: study.id, expectedTaskVersion: study.version, mode: "study", courseId: "microeconomics" } })).result;
  assert.equal(deniedStart.kind, "error", "import authority is not start authority");
  if (deniedStart.kind === "error") assert.match(deniedStart.message, /Ask to start one exact imported task/, "denial must come from original-intent validation");
  assert.equal(f.work.store.state().sessions.length, 0);
  const words = "Start the Study economics task";
  f.runner.attach(sink, makeTask("Start the Buy groceries task", undefined, { userDialogue: words }));
  assert.equal((await f.runner.run("tasks", { operation: "start", payload: { taskId: grocery.id, expectedTaskVersion: grocery.version, mode: "grocery" } })).result.kind, "error", "the model cannot replace the task selected in the original utterance");
  assert.equal(f.work.store.state().sessions.length, 0);
  f.runner.attach(sink, makeTask(words, undefined, { userDialogue: words }));
  assert.equal((await f.runner.run("tasks", { operation: "start", payload: { taskId: study.id, expectedTaskVersion: study.version, mode: "study", courseId: "microeconomics" } })).result.kind, "text");
  assert.equal(f.work.store.state().active!.id, f.work.store.state().tasks!.find(row => row.id === study.id)!.sessionId);
  assert.equal(f.work.store.state().tasks!.find(row => row.id === grocery.id)!.status, "pending");
  assert.equal(f.brainStarts(), 0); assert.deepEqual(f.handsOps.filter(op => op !== "frontmost"), []);
});

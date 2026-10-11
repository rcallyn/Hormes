import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { WorkStore } from "../work/store.ts";
import { taskLines, wantsTaskImport, wantsTaskStart } from "../work/tasks.ts";
import { selectedGroceryNote } from "../work/groceries.ts";
import { WorkCoordinator } from "../work/coordinator.ts";
import type { Brain } from "@hormes/brain";
import type { WorkCommand, WorkReply } from "@hormes/protocol";
const raw = (text: string, revision = "revision1", note = "x-coredata://fixture/Note/p1") => `HORMES_SELECTED_NOTE_V1\n${note}\n${revision}\nMy tasks\nMy tasks\n${text}`;
const request = (): string => randomUUID();
function fixture(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(join(tmpdir(), "hormes-tasks-store-")); const store = new WorkStore(dir, () => 1791750000000);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const imported = (text: string, revision?: string) => store.importTasks({ action: "tasks.import", requestId: request() }, raw(text, revision));
  const command = (c: Omit<WorkCommand, "requestId">) => store.command({ ...c, requestId: request() });
  return { store, dir, imported, command };
}
test("Tasks parser retains exact line and line number, skips checked items without reporting completion, and only suggests modes", () => {
  const lines = taskLines(selectedGroceryNote(raw("- [ ] Buy groceries\n  • Finish econ homework\n- [x] Send VC deck\nTalk to Dad")));
  assert.deepEqual(lines, [{ text: "- [ ] Buy groceries", line: 2, suggestedMode: "grocery" }, { text: "  • Finish econ homework", line: 3, suggestedMode: "study" }, { text: "Talk to Dad", line: 5 }]);
  assert.equal(wantsTaskImport("Read my to-do list"), true); assert.equal(wantsTaskImport("What is on my calendar?"), false);
  assert.equal(wantsTaskStart("Start task 2", "Finish homework", "id", 2), true);
  assert.equal(wantsTaskStart("Start buy groceries", "Finish homework", "id", 2), false);
});
test("duplicate import is stable; unrelated additions preserve IDs, links, reports and original provenance", t => {
  const f = fixture(t); f.imported("Buy groceries\nFinish econ homework");
  const original = f.store.state().tasks![0]!;
  f.command({ action: "tasks.start", taskId: original.id, expectedTaskVersion: original.version, mode: "grocery" });
  const started = f.store.state().tasks![0]!;
  f.command({ action: "tasks.done", taskId: started.id, expectedTaskVersion: started.version });
  const done = f.store.state().tasks![0]!;
  f.imported("Buy groceries\nFinish econ homework"); assert.deepEqual(f.store.state().tasks![0], done);
  f.imported("Buy groceries\nFinish econ homework\nSend VC deck", "revision2");
  const next = f.store.state().tasks![0]!;
  assert.equal(next.id, original.id); assert.equal(next.sessionId, started.sessionId); assert.equal(next.status, "user-reported-done");
  assert.equal(next.sourceId, original.sourceId); assert.equal(next.noteRevision, original.noteRevision); assert.equal(next.sourceHistory!.length, 1);
  assert.equal(f.store.state().sources.find(s => s.id === next.sourceId)!.text, "My tasks\nBuy groceries\nFinish econ homework");
  assert.equal(f.store.state().evidence.length, 0); assert.equal(f.store.state().goals[0]!.state, "in-progress");
  assert.throws(() => f.command({ action: "tasks.reopen", taskId: next.id, expectedTaskVersion: done.version }), /changed/);
  assert.throws(() => f.imported("Buy groceries\nFinish econ homework"), /older/);
  f.store.close(); const reopened = new WorkStore(f.dir); assert.deepEqual(reopened.state().tasks, f.store.state().tasks); reopened.close();
});
test("removed/changed lines are superseded, and clearing all unchecked tasks does not mark completion", t => {
  const f = fixture(t); f.imported("Buy groceries\nFinish homework"); const old = f.store.state().tasks!;
  f.imported("Buy vegetables", "revision2");
  assert.equal(f.store.state().tasks!.filter(t => t.supersededAt === undefined).length, 1);
  for (const prior of old) {
    const saved = f.store.state().tasks!.find(t => t.id === prior.id)!; assert.equal(saved.status, "pending"); assert.ok(saved.supersededAt);
    assert.throws(() => f.command({ action: "tasks.start", taskId: saved.id, expectedTaskVersion: saved.version, mode: "grocery" }), /removed or changed/);
  }
  f.imported("- [x] Buy vegetables", "revision3"); assert.equal(f.store.state().tasks!.filter(t => t.supersededAt === undefined).length, 0);
});
test("task start validates mode/course/current capture before changing active session and replay cannot restart", t => {
  const f = fixture(t); f.imported("Finish econ homework\nBuild another app"); const task = f.store.state().tasks![0]!;
  assert.throws(() => f.command({ action: "tasks.start", taskId: task.id, expectedTaskVersion: task.version, mode: "study" }), /saved course/);
  f.command({ action: "start", mode: "class" }); f.command({ action: "lecture.begin" }); const active = f.store.state().active!;
  const start: WorkCommand = { action: "tasks.start", requestId: request(), taskId: task.id, expectedTaskVersion: task.version, mode: "study", courseId: "microeconomics" };
  assert.throws(() => f.store.preflightTasks(start), /capture/); assert.equal(f.store.state().active!.id, active.id);
  f.command({ action: "lecture.pause" }); assert.equal(f.store.command(start), true);
  assert.equal(f.store.state().active!.goalId, f.store.state().tasks![0]!.goalId); assert.equal(f.store.state().active!.demo, false);
  f.command({ action: "start", mode: "grocery" }); const newer = f.store.state().active!.id;
  assert.equal(f.store.preflightTasks(start), false); assert.equal(f.store.command(start), false); assert.equal(f.store.state().active!.id, newer);
  const coding = f.store.state().tasks![1]!;
  assert.throws(() => f.command({ action: "tasks.start", taskId: coding.id, expectedTaskVersion: coding.version, mode: "coding" }), /planning/);
});
test("import command cannot accept model text; native errors and arbitrary output produce no Tasks source", t => {
  const f = fixture(t);
  assert.throws(() => f.command({ action: "tasks.import", text: "Buy anything" }), /source text/);
  assert.throws(() => f.store.importTasks({ action: "tasks.import", requestId: request() }, "invented note"));
  assert.equal(f.store.state().tasks!.length, 0); assert.equal(f.store.state().sources.length, 0);
});
test("two pending selected-note reads cannot commit the older result after the newer import", async t => {
  const dir = mkdtempSync(join(tmpdir(), "hormes-tasks-race-")); const replies: WorkReply[] = [];
  const pending: ((value: { result: { kind: "text"; text: string }; selectedNoteText: string }) => void)[] = [];
  const work = new WorkCoordinator({ stateDir: dir, redact: t => t, emit: r => replies.push(r), lane: () => ({ brain: {} as Brain, runner: { setLane() {}, beginTurn() {}, attach() {}, run: () => new Promise(resolve => pending.push(resolve as typeof pending[number])) } }) });
  t.after(async () => { await work.stop(); rmSync(dir, { recursive: true, force: true }); });
  const one = work.command({ action: "tasks.import", requestId: "older" }); const two = work.command({ action: "tasks.import", requestId: "newer" });
  pending[1]!({ result: { kind: "text", text: raw("Current task", "revision2") }, selectedNoteText: raw("Current task", "revision2") }); await two;
  pending[0]!({ result: { kind: "text", text: raw("Old task") }, selectedNoteText: raw("Old task") }); await one;
  assert.deepEqual(work.store.state().tasks!.map(t => t.text), ["Current task"]);
  assert.equal(replies.find(r => r.requestId === "older")!.ok, false); assert.match(replies.find(r => r.requestId === "older")!.message!, /newer Tasks import/);
});

test("reimport of the bounded source supersedes a legacy observer row without rewriting source history", t => {
  const f = fixture(t);
  const observed = 'now: Google Chrome; focused: AXTextArea "Message #general" = ""; under the pointer: AXGroup; 266 ms after the script';
  f.imported(`Buy groceries\nFinish econ homework\n${observed}`);
  const before = f.store.state().tasks!;
  const originalSource = f.store.state().sources.find(s => s.id === before[0]!.sourceId)!;
  f.imported("Buy groceries\nFinish econ homework");
  const current = f.store.state().tasks!.filter(t => t.supersededAt === undefined);
  assert.deepEqual(current.map(t => t.text), ["Buy groceries", "Finish econ homework"]);
  assert.equal(current[0]!.id, before[0]!.id);
  const withdrawn = f.store.state().tasks!.find(t => t.text === observed)!;
  assert.ok(withdrawn.supersededAt); assert.equal(withdrawn.status, "pending");
  assert.deepEqual(f.store.state().sources.find(s => s.id === originalSource.id), originalSource, "retain the original failed receipt for audit");
  const newSource = f.store.state().sources.find(s => s.id === current[0]!.sourceHistory!.at(-1)!.sourceId)!;
  assert.equal(newSource.text, "My tasks\nBuy groceries\nFinish econ homework");
  f.command({ action: "tasks.start", taskId: current[0]!.id, expectedTaskVersion: current[0]!.version, mode: "grocery" });
  assert.deepEqual(f.store.state().active!.sourceIds, [newSource.id], "new work consumes the latest exact source, not the historical contaminated receipt");
  assert.deepEqual(f.store.state().sources.find(s => s.id === originalSource.id), originalSource);
});


test("voice Tasks list and import omit superseded rows while preserving reported status and source audit", async t => {
  const dir = mkdtempSync(join(tmpdir(), "hormes-tasks-current-"));
  const source = raw("Buy groceries\nFinish econ homework");
  const work = new WorkCoordinator({ stateDir: dir, redact: text => text, emit() {}, lane: () => ({ brain: {} as Brain, runner: { setLane() {}, beginTurn() {}, attach() {}, run: async () => ({ result: { kind: "text" as const, text: source }, selectedNoteText: source, ms: 0 }) } }) });
  t.after(async () => { await work.stop(); rmSync(dir, { recursive: true, force: true }); });
  work.store.importTasks({ action: "tasks.import", requestId: request() }, raw("Buy groceries\nFinish econ homework\nRetired source row"));
  const task = work.store.state().tasks![0]!;
  work.store.command({ action: "tasks.done", requestId: request(), taskId: task.id, expectedTaskVersion: task.version });
  const imported = JSON.parse(await work.tasks("import", {}, "Read my to-do list")) as { tasks: { text: string; status: string }[] };
  const listed = JSON.parse(await work.tasks("list", {}, "What tasks do I have?")) as typeof imported;
  assert.deepEqual(imported.tasks.map(task => task.text), ["Buy groceries", "Finish econ homework"]);
  assert.deepEqual(listed.tasks, imported.tasks);
  assert.equal(listed.tasks[0]!.status, "user-reported-done", "reported completion remains explicitly labeled");
  assert.equal(work.store.state().tasks!.length, 3, "Console retains the superseded source audit");
  assert.ok(work.store.state().tasks!.find(task => task.text === "Retired source row")!.supersededAt);
});

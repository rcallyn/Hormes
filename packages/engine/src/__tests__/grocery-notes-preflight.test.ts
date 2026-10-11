import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Brain, BrainTask, RunnerOptions } from "@hormes/brain";
import { READ_SELECTED_GROCERY_NOTE_SCRIPT, type WorkReply } from "@hormes/protocol";
import { FakeHands, makeRunner, makeSink } from "../../../brain/src/__tests__/fakes.ts";
import { WorkCoordinator } from "../work/coordinator.ts";

const note = "HORMES_SELECTED_NOTE_V1\nx-coredata://demo/Note/p1\n2026-10-11\nHormes demo groceries\nHormes demo groceries\nMilk\nEggs\nBananas";
const shellResult = (stdout: string, stderr = "", code = 0) => ({ stdout, stderr, code, signal: null, ms: 1, timedOut: false, cancelled: false });
class Browser extends FakeHands {
  reads = 0; navigations = 0; readable = true;
  override async request<T>(op: string, args: Record<string, unknown> = {}): Promise<T> {
    if (op === "frontmost") return { app: "Google Chrome" } as T;
    if (op === "browser_url") return { url: "https://www.instacart.com/store/", title: "Synthetic store" } as T;
    if (op === "browser_tabs") return { tabs: [{ index: 1, windowId: 10, tabId: 101, url: "https://www.instacart.com/store/", title: "Synthetic store", active: true }], active: 1 } as T;
    if (op === "browser_navigate") { this.navigations++; return {} as T; }
    if (op === "browser_js") {
      if (!this.readable) return { result: "missing value" } as T;
      if (args["script"] === "1+1") return { result: "2" } as T;
      if (String(args["script"]).includes("hasSearchResults:")) return { result: JSON.stringify({ url: "https://www.instacart.com/store/", readyState: "complete", visibleBusy: false, hasContent: true, hasSearchResults: false }) } as T;
      this.reads++;
      return { result: JSON.stringify({ url: "https://www.instacart.com/store/", title: "Synthetic store", text: "View Cart. Existing cart retained.", length: 35 }) } as T;
    }
    return super.request<T>(op);
  }
}
function fixture(t: { after(fn: () => Promise<void>): void }, read: NonNullable<RunnerOptions["runAppleScript"]>, reportOnly?: string) {
  const dir = mkdtempSync(join(tmpdir(), "hormes-notes-preflight-"));
  const replies: WorkReply[] = [], tasks: BrainTask[] = [];
  let starts = 0, work: WorkCoordinator;
  const brain = { start: async () => { starts++; return { ready: true }; }, stop: async () => {}, cancel: async () => {}, handle: async (task: BrainTask) => {
    tasks.push(task);
    assert.deepEqual(work.store.state().active!.grocery!.items.map(i => i.request), ["Milk", "Eggs", "Bananas"]);
    assert.match(task.workContext!, /"origin":"apple-notes"/);
    assert.match(task.workContext!, /Hormes demo groceries/);
    if (reportOnly) return { status: "complete", summary: reportOnly };
    work.model(task.work!, "grocery", { stage: "blocked", reason: "Synthetic fixture: store login required; no browser action performed." });
    return { status: "complete", summary: "Store login is required." };
  } } as unknown as Brain;
  const browser = new Browser();
  const made = makeRunner({ runAppleScript: read, work: {
    isActive: scope => work.isActive(scope),
    model: (scope, operation, payload) => work.model(scope, operation, payload),
    receipt: (scope, tool, args, text) => work.receipt(scope, tool, args, text),
    prepareGrocery: (scope, read, page) => work.prepareGrocery(scope, read, page),
  } }, browser);
  work = new WorkCoordinator({ stateDir: dir, emit: reply => replies.push(reply), redact: text => text, lane: () => ({ brain, runner: { setLane() {}, beginTurn() {}, attach: made.runner.attach.bind(made.runner), run: made.runner.run.bind(made.runner) } }) });
  t.after(async () => { await work.stop(); rmSync(dir, { recursive: true, force: true }); rmSync(made.dir, { recursive: true, force: true }); });
  const command = (action: "start" | "grocery.run" | "pause") => work.command({ action, requestId: randomUUID(), ...(action === "start" ? { mode: "grocery" as const } : {}) });
  return { work, runner: made.runner, browser, replies, tasks, command, starts: () => starts };
}

test("grocery.run imports the exact selected Notes receipt through real scoped ToolRunner before model planning", async t => {
  const calls: string[] = [];
  const f = fixture(t, async script => { calls.push(script); return shellResult(note); });
  await f.command("start"); await f.command("grocery.run");
  assert.deepEqual(calls, [READ_SELECTED_GROCERY_NOTE_SCRIPT]);
  assert.equal(f.starts(), 1); assert.equal(f.tasks.length, 1);
  assert.equal(f.tasks[0]!.groceryRun, true, "the explicit run authorizes only this task's preflight");
  assert.match(f.tasks[0]!.workInstructions!, /browser_read the existing cart/);
  assert.doesNotMatch(f.tasks[0]!.workContext!, /browser_read the existing cart/, "procedural guidance is not labeled already-done source data");
  const saved = f.work.store.state().active!.grocery!;
  assert.equal(saved.note!.origin, "apple-notes"); assert.equal(saved.items.length, 3);
  assert.equal(f.work.store.state().sources.find(s => s.id === saved.note!.sourceId)!.origin, "tool");
  assert.equal(saved.review, undefined); assert.match(saved.blocked!.reason, /store login required/);
  await f.command("grocery.run");
  assert.equal(calls.length, 1, "retry uses the same imported source, not another currently selected private note");
  assert.equal(f.browser.reads, 2, "retry verifies browser access again instead of reusing a prior receipt");
  assert.equal(f.browser.navigations, 0, "an existing allowed shop is read freshly without reloading");
});

test("a real Notes error is retained as an actionable blocker and never starts a model/browser task", async t => {
  const f = fixture(t, async () => shellResult("", "Not authorized to send Apple events to Notes. (-1743)", 1));
  await f.command("start"); await f.command("grocery.run");
  assert.equal(f.starts(), 0); assert.equal(f.tasks.length, 0);
  assert.match(f.replies.at(-1)!.message!, /Not authorized.*Notes/);
  assert.equal(f.work.store.state().active!.grocery!.note, undefined);
  assert.match(f.work.store.state().active!.grocery!.blocked!.reason, /Not authorized/);
});

test("general voice delegation imports selected Notes on its first real work.context call without advertising arbitrary scripts", async t => {
  const calls: string[] = [];
  const f = fixture(t, async script => { calls.push(script); return shellResult(note); });
  const request = "Prepare my grocery cart from the selected note.";
  const task = f.work.enrich({ delegationId: "voice-grocery", request, userDialogue: request, dialogue: "", confirmation: false, offsetMs: 0, signal: new AbortController().signal });
  assert.equal(task.work!.mode, "grocery");
  assert.equal(task.groceryRun, true);
  assert.match(task.workInstructions!, /browser_read the existing cart/);
  const { sink } = makeSink(); f.runner.attach(sink, task);
  const context = await f.runner.run("work", { operation: "context", payload: {} });
  assert.equal(context.result.kind, "text");
  assert.deepEqual(calls, [READ_SELECTED_GROCERY_NOTE_SCRIPT]);
  assert.equal(f.work.store.state().active!.grocery!.note!.origin, "apple-notes");
  assert.deepEqual(f.work.store.state().active!.grocery!.items.map(i => i.request), ["Milk", "Eggs", "Bananas"]);
  assert.equal(f.browser.reads, 1);
  await f.runner.run("work", { operation: "context", payload: {} });
  assert.equal(f.browser.reads, 1, "later context reads do not navigate away from an in-progress cart");
  const unrelated = await f.runner.run("applescript", { script: 'tell application "Notes" to get every note' });
  assert.equal(unrelated.result.kind, "error"); assert.equal(calls.length, 1);
  const retry = f.work.enrich({ ...task, delegationId: "voice-grocery-retry" });
  f.runner.attach(sink, retry);
  await f.runner.run("work", { operation: "context", payload: {} });
  assert.equal(f.browser.reads, 2, "a new explicit voice preparation rechecks the browser");
  assert.equal(calls.length, 1, "a voice retry retains the already imported grocery note");
  f.runner.attach(undefined);
});

test("a schedule context read with saved groceries never imports Notes or starts browser preparation", async t => {
  let reads = 0;
  const f = fixture(t, async () => { reads++; return shellResult(note); });
  await f.command("start");
  const previous = "Prepare my grocery cart from the selected note.";
  const request = "What is on my calendar today?";
  for (const imported of [false, true]) {
    if (imported) f.work.receipt(f.work.store.scope()!, "applescript", { script: READ_SELECTED_GROCERY_NOTE_SCRIPT }, note);
    const before = f.work.store.state();
    const task = f.work.enrich({ delegationId: `schedule-${imported}`, request: `${previous}\n${request}`, userDialogue: `${previous}\n${request}`, dialogue: "", confirmation: false, offsetMs: 0, signal: new AbortController().signal, groceryRun: true });
    assert.equal(task.work!.mode, "grocery", "saved work remains available as context");
    assert.equal(task.groceryRun, false, "an earlier request or inherited task flag cannot authorize a new preparation");
    assert.doesNotMatch(task.workInstructions!, /browser_read the existing cart/, "a schedule request does not inherit cart preparation instructions");
    const { sink } = makeSink(); f.runner.attach(sink, task);
    const context = await f.runner.run("work", { operation: "context", payload: { groceryRun: true } });
    assert.equal(context.result.kind, "text");
    assert.equal(reads, 0, "context does not inspect the current private Notes selection");
    assert.equal(f.browser.navigations, 0); assert.equal(f.browser.reads, 0);
    assert.deepEqual(f.work.store.state(), before, "context reads do not mutate grocery progress or blockers");
    f.runner.attach(undefined);
  }
});

test("old browser evidence cannot satisfy a new preparation attempt when the fresh page is unreadable", async t => {
  const f = fixture(t, async () => shellResult(note));
  await f.command("start"); await f.command("grocery.run");
  assert.equal(f.starts(), 1);
  f.browser.readable = false;
  await f.command("grocery.run");
  assert.equal(f.starts(), 1, "no second model task begins with stale browser evidence");
  assert.ok(f.work.store.state().sources.some(s => s.kind === "web"), "prior browser source is retained as history");
  assert.match(f.replies.at(-1)!.message!, /Browser check failed|fresh readable page/);
  assert.equal(f.work.store.state().active!.grocery!.review, undefined);
  assert.ok(f.work.store.state().active!.grocery!.items.every(i => i.state === "pending"));
});

test("a model that ends without tools cannot silently lose its stated reason or turn it into a verified cart", async t => {
  const f = fixture(t, async () => shellResult(note), "I stopped because I thought the previous browser setting was still disabled.");
  await f.command("start"); await f.command("grocery.run");
  assert.equal(f.browser.reads, 3, "each bounded continuation reads the current page without replaying navigation");
  assert.equal(f.tasks.length, 3, "at most two continuations preserve the original Notes source");
  assert.match(f.replies.at(-1)!.message!, /^Cart review is unverified\. The agent stopped.*Agent reported: I stopped because/);
  assert.equal(f.work.store.state().active!.grocery!.review, undefined);
  assert.match(f.work.store.state().active!.grocery!.blocked!.reason, /^Cart review is unverified/, "persist actual missing verification, labeling the model belief only as reported");
});

test("pausing while selected Notes read is in flight discards late source and never invokes a model", async t => {
  let release!: () => void, arrived!: () => void;
  const called = new Promise<void>(r => { arrived = r; });
  const held = new Promise<void>(r => { release = r; });
  const f = fixture(t, async () => { arrived(); await held; return shellResult(note); });
  await f.command("start"); const run = f.command("grocery.run");
  await called; await f.command("pause"); release(); await run;
  assert.equal(f.starts(), 0); assert.equal(f.tasks.length, 0);
  assert.ok(!f.work.store.state().sources.some(s => s.kind === "note"));
  assert.equal(f.work.store.state().active, undefined);
});

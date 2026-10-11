import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Brain, BrainResult, BrainSink, BrainTask, ToolRunner } from "@hormes/brain";
import type { WorkReply } from "@hormes/protocol";
import { FakeHands, makeRunner } from "../../../brain/src/__tests__/fakes.ts";
import { GROCERY_READINESS_SCRIPT } from "../../../brain/src/grocery-browser.ts";
import { WorkCoordinator } from "../work/coordinator.ts";

const nativeNote = "HORMES_SELECTED_NOTE_V1\nx-coredata://synthetic/Note/p1\n2026-10-11\nSynthetic groceries\nSynthetic groceries\nMilk\nEggs\nBananas";
const promiseOnly = (): BrainResult => ({ status: "done", summary: "Received. Next, I will prepare the groceries." });
class Browser extends FakeHands {
  reads = 0; navigations = 0; clicks = 0; cartOpen = false; refuseURL = false;
  readonly events: string[] = [];
  override async request<T>(op: string, args: Record<string, unknown> = {}): Promise<T> {
    if (op === "frontmost") return { app: "Google Chrome" } as T;
    if (op === "browser_url") {
      if (this.refuseURL) throw new Error("Synthetic bound tab closed");
      return { url: "https://www.instacart.com/store/", title: "Synthetic store", windowId: 10, tabId: 101 } as T;
    }
    if (op === "browser_tabs") return { tabs: [{ url: "https://www.instacart.com/store/", title: "Synthetic store", windowId: 10, tabId: 101, index: 1, active: true }], active: 1 } as T;
    if (op === "browser_navigate") { this.navigations++; return {} as T; }
    if (op === "browser_js") {
      if (args["script"] === "1+1") return { result: "2" } as T;
      if (args["script"] === GROCERY_READINESS_SCRIPT) return { result: JSON.stringify({ url: "https://www.instacart.com/store/", readyState: "complete", visibleBusy: false, hasContent: true, hasSearchResults: true }) } as T;
      if (args["readOnly"] !== true) { this.clicks++; this.cartOpen = true; this.events.push("click:cart"); return { result: JSON.stringify({ ok: true, operation: "cart control clicked", control: "View Carts" }) } as T; }
      this.reads++; this.events.push(this.cartOpen ? "read:cart" : "read:badge");
      const text = this.cartOpen ? "Your cart\nMilk Quantity 1 Remove\nEggs Quantity 1 Remove\nBananas Quantity 1 Remove" : "View Carts. No product rows inspected.";
      return { result: JSON.stringify({ url: "https://www.instacart.com/store/", title: "Synthetic store", text, length: text.length }) } as T;
    }
    return super.request<T>(op);
  }
}
type Turn = (call: number, task: BrainTask, sink: BrainSink, work: WorkCoordinator, runner: ToolRunner) => Promise<BrainResult>;
function fixture(t: { after(fn: () => Promise<void>): void }, turn: Turn, confirmClick = false) {
  const dir = mkdtempSync(join(tmpdir(), "hormes-grocery-contract-"));
  const hands = new Browser(), tasks: BrainTask[] = [], replies: WorkReply[] = [];
  let work: WorkCoordinator, starts = 0, noteReads = 0;
  const { runner, dir: runnerDir } = makeRunner({
    ...(confirmClick ? { policy: (ctx) => ctx.kind === "browser_click" ? { verdict: "confirm" as const, reason: "Synthetic approval required" } : { verdict: "run" as const, reason: "Synthetic allowed read" } } : {}),
    runAppleScript: async () => { noteReads++; return { stdout: nativeNote, stderr: "", code: 0, signal: null, ms: 1, timedOut: false, cancelled: false }; },
    work: { isActive: s => work.isActive(s), model: (s, op, p) => work.model(s, op, p), receipt: (s, tool, args, text) => work.receipt(s, tool, args, text), prepareGrocery: (s, read, page) => work.prepareGrocery(s, read, page) },
  }, hands);
  const brain = { start: async () => { starts++; return { ready: true }; }, stop: async () => {}, cancel: async () => {},
    handle: async (task: BrainTask, sink: BrainSink) => {
      tasks.push(task); runner.attach(sink, task);
      try { return await turn(tasks.length, task, sink, work, runner); }
      finally { runner.attach(undefined); }
    },
  } as unknown as Brain;
  work = new WorkCoordinator({ stateDir: dir, redact: s => s, emit: r => replies.push(r), lane: () => ({ brain, runner: { setLane() {}, beginTurn() {}, attach: runner.attach.bind(runner), run: runner.run.bind(runner) } }) });
  t.after(async () => { await work.stop(); rmSync(dir, { recursive: true, force: true }); rmSync(runnerDir, { recursive: true, force: true }); });
  const start = () => work.command({ action: "start", mode: "grocery", requestId: randomUUID() });
  const run = () => work.command({ action: "grocery.run", requestId: randomUUID() });
  return { work, start, run, tasks, replies, hands, starts: () => starts, noteReads: () => noteReads };
}

test("explicit grocery acknowledgment gets a reconciled continuation with original scope/source and no repeated import", async t => {
  const f = fixture(t, async (call, task, _sink, work, runner) => {
    if (call === 1) return promiseOnly();
    const result = await runner.run("work", { operation: "grocery", payload: { stage: "blocked", reason: "Synthetic observed store handoff: select a store before cart preparation." } });
    assert.equal(result.result.kind, "text");
    assert.equal(work.store.scope()!.sessionId, task.work!.sessionId);
    return { status: "done", summary: "Select the store to continue." };
  });
  await f.start(); await f.run();
  assert.equal(f.tasks.length, 2); assert.equal(f.starts(), 1, "continuation stays inside the original bounded job");
  const [initial, continued] = f.tasks;
  assert.equal(continued!.signal, initial!.signal); assert.deepEqual(continued!.work, initial!.work);
  assert.equal(continued!.userDialogue, initial!.userDialogue, "no fabricated human instruction authorizes continuation");
  assert.equal(continued!.groceryRun, true);
  assert.match(continued!.workContext!, /Synthetic groceries/);
  assert.match(continued!.workContext!, /"origin":"apple-notes"/);
  assert.equal(f.hands.reads, 2, "fresh page reconciliation precedes the continuation"); assert.equal(f.hands.navigations, 0); assert.equal(f.noteReads(), 1);
  assert.match(f.work.store.state().active!.grocery!.blocked!.reason, /select a store/i);
  assert.equal(f.work.store.state().active!.grocery!.review, undefined);
});

test("three promise-only turns exhaust the bounded run with all grocery items pending", async t => {
  const f = fixture(t, async () => promiseOnly()); await f.start(); await f.run();
  assert.equal(f.tasks.length, 3, "at most two continuations; no unbounded autonomous retry");
  assert.equal(f.hands.reads, 3, "each continuation receives a new observed page");
  assert.equal(f.starts(), 1); assert.equal(f.noteReads(), 1);
  assert.ok(f.tasks.every(task => task.signal === f.tasks[0]!.signal));
  assert.equal(f.replies.at(-1)!.ok, false); assert.match(f.replies.at(-1)!.message!, /unverified/);
  const grocery = f.work.store.state().active!.grocery!;
  assert.equal(grocery.review, undefined);
  assert.match(grocery.blocked!.reason, /^Cart review is unverified\. The agent stopped without verified cart evidence\./, "the saved blocker describes the application-observed execution failure");
  assert.doesNotMatch(grocery.blocked!.reason, /login|permission|unavailable|out of stock/i, "no external cause is invented from a promise");
  assert.ok(grocery.items.every(i => i.state === "pending")); assert.equal(f.work.store.state().busy, false);
});

test("successful cart opening and plan continue from a fresh read without replaying the click", async t => {
  const f = fixture(t, async (call, task, _sink, work, runner) => {
    const grocery = work.store.state().active!.grocery!;
    if (call === 1) {
      assert.equal((await runner.run("browser_click", { text: "View Carts" })).result.kind, "text");
      assert.equal((await runner.run("work", { operation: "grocery", payload: { stage: "plan", noteRevision: grocery.note!.revision, steps: [{ text: "Reconcile the existing three items", itemIds: grocery.items.map(item => item.id) }] } })).result.kind, "text");
      return promiseOnly();
    }
    assert.deepEqual(f.hands.events, ["read:badge", "click:cart", "read:cart"], "app rereads current cart before invoking the model again");
    assert.equal(f.hands.clicks, 1); assert.equal(f.hands.navigations, 0);
    assert.equal(task.signal, f.tasks[0]!.signal); assert.deepEqual(task.work, f.tasks[0]!.work);
    assert.equal(task.userDialogue, f.tasks[0]!.userDialogue);
    const context = JSON.parse(task.workContext!) as { sources: Array<{ id: string; text: string }> };
    const source = context.sources.findLast(source => source.text.includes("Milk Quantity 1 Remove"));
    assert.ok(source, "continued context includes the fresh application-owned read");
    assert.match(task.workContext!, /Reconcile the existing three items/);
    for (const item of grocery.items) {
      assert.equal((await runner.run("work", { operation: "grocery", payload: { stage: "item", noteRevision: grocery.note!.revision, itemId: item.id, state: "in-cart", receiptId: source.id, quote: `${item.request} Quantity 1 Remove`, product: item.request } })).result.kind, "text");
    }
    assert.equal((await runner.run("work", { operation: "grocery", payload: { stage: "review", noteRevision: grocery.note!.revision } })).result.kind, "text");
    return { status: "done", summary: "The existing requested rows are ready for review." };
  });
  await f.start(); await f.run();
  assert.equal(f.tasks.length, 2, "verified review ends before the final allowed continuation");
  assert.equal(f.hands.reads, 2); assert.equal(f.hands.clicks, 1); assert.equal(f.noteReads(), 1); assert.equal(f.starts(), 1);
  assert.equal(f.work.store.state().active!.grocery!.phase, "review");
  assert.ok(f.work.store.state().active!.grocery!.items.every(item => item.state === "in-cart"));
  assert.equal(f.work.store.state().goals.find(goal => goal.kind === "grocery")!.state, "in-progress");
});

test("a failed or approval-requiring model tool prevents an additional grocery turn", async t => {
  for (const confirm of [false, true]) {
    const f = fixture(t, async (_call, _task, _sink, work, runner) => {
      const outcome = confirm
        ? await runner.run("browser_click", { text: "View Carts" })
        : await runner.run("work", { operation: "grocery", payload: { stage: "review", noteRevision: work.store.state().active!.grocery!.note!.revision } });
      assert.equal(outcome.result.kind, confirm ? "needs-confirmation" : "error");
      return promiseOnly();
    }, confirm);
    await f.start(); await f.run();
    assert.equal(f.tasks.length, 1); assert.equal(f.hands.reads, 1); assert.equal(f.hands.clicks, 0);
    assert.equal(f.work.store.state().active!.grocery!.review, undefined);
  }
});

test("failed application reconciliation stops before another model turn without navigation or repeated actions", async t => {
  const f = fixture(t, async () => { f.hands.refuseURL = true; return promiseOnly(); });
  await f.start(); await f.run();
  assert.equal(f.tasks.length, 1); assert.equal(f.hands.reads, 1); assert.equal(f.hands.navigations, 0); assert.equal(f.hands.clicks, 0);
  assert.match(f.work.store.state().active!.grocery!.blocked!.reason, /bound grocery tab|closed|left.*shopping/i);
  assert.equal(f.work.store.state().active!.grocery!.review, undefined);
});

test("a persisted blocker or failed provider ends without continuation", async t => {
  for (const terminal of ["blocked", "failed"] as const) {
    const f = fixture(t, async (_call, task, _sink, work) => {
      if (terminal === "failed") return { status: "failed", error: "Synthetic provider failure" };
      work.model(task.work!, "grocery", { stage: "blocked", reason: "Synthetic manual store selection required" });
      return promiseOnly();
    });
    await f.start(); await f.run(); assert.equal(f.tasks.length, 1, terminal);
    assert.equal(f.work.store.state().active!.grocery!.review, undefined);
  }
});

test("pause after acknowledgment prevents continuation into a closed grocery session", async t => {
  const f = fixture(t, async (_call, _task, _sink, work) => {
    await work.command({ action: "pause", requestId: randomUUID() }); return promiseOnly();
  });
  await f.start(); await f.run();
  assert.equal(f.tasks.length, 1); assert.equal(f.tasks[0]!.signal.aborted, true);
  assert.equal(f.work.store.state().active, undefined); assert.equal(f.work.store.state().busy, false);
});

test("ordinary requests with a saved grocery session never gain grocery continuation or preflight", async t => {
  const f = fixture(t, async () => promiseOnly()); await f.start();
  await f.work.command({ action: "ask", text: "What is on my calendar today?", requestId: randomUUID() });
  assert.equal(f.tasks.length, 1); assert.equal(f.tasks[0]!.groceryRun, false);
  assert.equal(f.hands.reads, 0); assert.equal(f.hands.navigations, 0); assert.equal(f.noteReads(), 0);
  assert.equal(f.work.store.state().active!.grocery!.blocked, undefined, "a general request does not mutate saved grocery progress");
});

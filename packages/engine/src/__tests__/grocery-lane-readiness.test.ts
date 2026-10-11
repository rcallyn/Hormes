import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { AgentRegistry } from "@hormes/agents";
import { ComputerToolset, ConfirmationDesk, ConfirmationState, FocusLease, NativeRequestError } from "@hormes/hands";
import type { Brain, BrainSink, BrainTask } from "@hormes/brain";
import type { WorkReply } from "@hormes/protocol";
import { FakeHands, makeSink, makeTask } from "../../../brain/src/__tests__/fakes.ts";
import { GROCERY_READINESS_SCRIPT } from "../../../brain/src/grocery-browser.ts";
import { LaneRunner } from "../threads/runner.ts";
import { WorkCoordinator } from "../work/coordinator.ts";

const note = "HORMES_SELECTED_NOTE_V1\nx-coredata://synthetic/Note/p1\n2026-10-11\nSynthetic groceries\nSynthetic groceries\nMilk\nEggs\nBananas";
class BusyBrowser extends FakeHands {
  attempts = 0; navigations = 0; reads = 0;
  failure: "busy" | "ambiguous" | undefined = "busy";
  readinessProbes = 0; loadingProbes = 0;
  onProbe: (() => void) | undefined;
  url = "https://www.instacart.com/store/";
  override async request<T>(op: string, args: Record<string, unknown> = {}): Promise<T> {
    if (op === "frontmost") return { app: "Google Chrome", pid: 1 } as T;
    if (op === "user_idle") return { foreignMs: 100_000, idleMs: 100_000 } as T;
    if (op === "browser_url") return { url: this.url, title: "Synthetic store", windowId: 10, tabId: 101 } as T;
    if (op === "browser_tabs") return { tabs: [{ url: this.url, title: "Synthetic store", windowId: 10, tabId: 101, index: 1, active: true }], active: 1 } as T;
    if (op === "browser_navigate") {
      this.attempts++;
      const failure = this.failure; this.failure = undefined;
      if (failure === "busy") throw new NativeRequestError({ code: "busy", message: "User is using the keyboard or mouse" });
      if (failure === "ambiguous") throw new Error("native navigation response timed out");
      this.navigations++; this.url = String(args["url"]); return { ok: true, windowId: 10, tabId: 101 } as T;
    }
    if (op === "browser_js") {
      if (args["script"] === "1+1") return { result: "2" } as T;
      if (args["script"] === GROCERY_READINESS_SCRIPT) {
        this.readinessProbes++; this.onProbe?.();
        const visibleBusy = this.loadingProbes-- > 0;
        return { result: JSON.stringify({ url: this.url, readyState: "complete", visibleBusy, hasContent: true, hasSearchResults: !visibleBusy }) } as T;
      }
      this.reads++;
      return { result: JSON.stringify({ url: this.url, title: "Synthetic store", text: "View Carts. Existing cart preserved.", length: 36 }) } as T;
    }
    return super.request<T>(op);
  }
}
function fixture(t: { after(fn: () => Promise<void>): void }) {
  const dir = mkdtempSync(join(tmpdir(), "hormes-grocery-lane-"));
  const hands = new BusyBrowser(); let time = 1_000_000, work: WorkCoordinator, modelCalls = 0, noteReads = 0;
  const now = () => time;
  const confirmations = new ConfirmationState();
  const toolset = new ComputerToolset({ hands, confirmations });
  const lease = new FocusLease({ hands, now, sleep: async ms => { time += ms; } });
  const runner = new LaneRunner({ stateDir: dir, agents: new AgentRegistry([]), toolset, lease,
    lane: "screen", laneId: "synthetic-grocery", desk: new ConfirmationDesk(confirmations, () => {}, now), now,
    runAppleScript: async () => { noteReads++; return { code: 0, signal: null, stdout: note, stderr: "", timedOut: false, cancelled: false, ms: 1 }; },
    work: { isActive: scope => work.isActive(scope), model: (scope, operation, payload) => work.model(scope, operation, payload), receipt: (scope, name, args, text) => work.receipt(scope, name, args, text), prepareGrocery: (scope, read, page) => work.prepareGrocery(scope, read, page) },
  });
  const brain = {
    start: async () => ({ ready: true }), stop: async () => {}, cancel: async () => {},
    handle: async (task: BrainTask, sink: BrainSink) => {
      modelCalls++; runner.attach(sink, task);
      try {
        const context = await runner.run("work", { operation: "context", payload: {} });
        assert.equal(context.result.kind, "text", "model context reuses this run's completed preflight");
        work.model(task.work!, "grocery", { stage: "blocked", reason: "Synthetic model stops after verified browser access; no cart actions." });
        return { status: "complete", summary: "Synthetic browser preflight observed." };
      } finally { runner.attach(undefined); }
    },
  } as unknown as Brain;
  const replies: WorkReply[] = [];
  work = new WorkCoordinator({ stateDir: dir, now, redact: s => s, emit: r => replies.push(r), lane: () => ({ runner, brain }) });
  t.after(async () => { runner.attach(undefined); await work.stop(); rmSync(dir, { recursive: true, force: true }); });
  const command = (action: "start" | "grocery.run") => work.command({ action, requestId: randomUUID(), ...(action === "start" ? { mode: "grocery" as const } : {}) });
  return { hands, work, runner, command, replies, advance: (ms: number) => { time += ms; }, modelCalls: () => modelCalls, noteReads: () => noteReads };
}

test("native busy before grocery navigation is retried by the real lane and reaches a fresh read plus model context", async t => {
  const f = fixture(t); f.hands.url = "https://example.org/not-a-store";
  await f.command("start"); await f.command("grocery.run");
  assert.equal(f.hands.attempts, 2, "the real FocusLease retry reaches native navigation again after a no-action busy response");
  assert.equal(f.hands.navigations, 1); assert.equal(f.hands.reads, 1);
  assert.equal(f.modelCalls(), 1); assert.equal(f.noteReads(), 1);
  assert.match(f.work.store.state().active!.grocery!.blocked!.reason, /Synthetic model stops/);
  assert.equal(f.work.store.state().sources.filter(s => s.kind === "web").length, 1);
  await f.command("grocery.run");
  assert.equal(f.hands.navigations, 1, "an explicit retry reads the existing store instead of reloading it");
  assert.equal(f.hands.reads, 2); assert.equal(f.modelCalls(), 2);
  assert.equal(f.noteReads(), 1, "the saved grocery source is preserved on explicit retry");
});

test("explicit grocery preparation freshly reads an existing retailer search or cart without navigating away", async t => {
  const f = fixture(t); f.hands.failure = undefined;
  await f.command("start");
  for (const url of ["https://www.instacart.com/store/aldi/s?k=bananas&xrs_id=synthetic", "https://www.instacart.com/store/cart"]) {
    f.hands.url = url;
    const before = new Set(f.work.store.state().sources.map(s => s.id));
    const reads = f.hands.reads;
    await f.command("grocery.run");
    assert.equal(f.hands.navigations, 0, "the currently rendered allowed shopping page is retained");
    assert.equal(f.hands.url, url); assert.equal(f.hands.reads, reads + 1);
    const source = f.work.store.state().sources.find(s => !before.has(s.id) && s.kind === "web");
    assert.equal(source?.url, url, "each explicit retry gets a new actual page receipt");
  }
  assert.equal(f.modelCalls(), 2); assert.equal(f.noteReads(), 1);
});

test("explicit grocery voice context uses the same existing-page preflight without repeated preparation", async t => {
  const f = fixture(t); f.hands.failure = undefined;
  f.hands.url = "https://www.instacart.com/store/aldi/s?k=bananas&xrs_id=synthetic";
  const request = "Prepare my grocery cart from the selected note.";
  const task = f.work.enrich({ ...makeTask(request), userDialogue: request });
  f.runner.attach(makeSink().sink, task);
  assert.equal((await f.runner.run("work", { operation: "context", payload: {} })).result.kind, "text");
  assert.equal(f.hands.navigations, 0); assert.equal(f.hands.reads, 1); assert.equal(f.noteReads(), 1);
  assert.equal((await f.runner.run("work", { operation: "context", payload: {} })).result.kind, "text");
  assert.equal(f.hands.navigations, 0); assert.equal(f.hands.reads, 1, "model context does not repeatedly prepare or reload the page");
});

test("loading an existing grocery search gets bounded fresh-read recovery without reloading the page", async t => {
  const f = fixture(t); f.hands.failure = undefined;
  f.hands.url = "https://www.instacart.com/store/aldi/s?k=bananas";
  f.hands.loadingProbes = 2; f.hands.onProbe = () => f.advance(13_000);
  await f.command("start"); await f.command("grocery.run");
  assert.equal(f.hands.readinessProbes, 3, "two exhausted readiness windows can recover on the final fresh read");
  assert.equal(f.hands.navigations, 0); assert.equal(f.hands.reads, 1); assert.equal(f.modelCalls(), 1);
  assert.equal(f.work.store.state().sources.filter(s => s.kind === "web").length, 1, "loading attempts never become source receipts");
});

test("persistently loading existing page stops after three readiness windows and never starts the model", async t => {
  const f = fixture(t); f.hands.failure = undefined;
  f.hands.url = "https://www.instacart.com/store/aldi/s?k=bananas";
  f.hands.loadingProbes = 100; f.hands.onProbe = () => f.advance(13_000);
  await f.command("start"); await f.command("grocery.run");
  assert.equal(f.hands.readinessProbes, 3); assert.equal(f.hands.navigations, 0);
  assert.equal(f.hands.reads, 0); assert.equal(f.modelCalls(), 0);
  assert.equal(f.work.store.state().sources.filter(s => s.kind === "web").length, 0);
  assert.match(f.work.store.state().active!.grocery!.blocked!.reason, /loading/);
});

test("ambiguous native navigation failure keeps the read fence instead of automatically issuing another navigation", async t => {
  const f = fixture(t); f.hands.failure = "ambiguous";
  await f.command("start");
  const task = { ...makeTask("Prepare my grocery cart"), work: f.work.store.scope()! };
  f.runner.attach(makeSink().sink, task);
  const first = await f.runner.run("browser_navigate", { url: f.hands.url });
  assert.equal(first.result.kind, "error"); assert.equal(f.hands.attempts, 1);
  const second = await f.runner.run("browser_navigate", { url: "https://www.instacart.com/store/s?k=eggs" });
  assert.equal(second.result.kind, "error"); assert.equal(f.hands.attempts, 1, "timeout does not prove that navigation never happened");
  assert.equal((await f.runner.run("browser_read", {})).result.kind, "text");
  assert.equal((await f.runner.run("browser_navigate", { url: "https://www.instacart.com/store/s?k=eggs" })).result.kind, "text");
  assert.equal(f.hands.attempts, 2);
});

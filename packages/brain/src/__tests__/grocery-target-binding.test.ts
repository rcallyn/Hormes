import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { NativeRequestError } from "@hormes/hands";
import { FakeHands, makeRunner, makeSink, makeTask } from "./fakes.ts";
import { GROCERY_READINESS_SCRIPT } from "../grocery-browser.ts";

const shopURL = "https://www.instacart.com/store/aldi/s?k=milk";
const personalURL = "https://example.org/personal-work";
interface Tab { windowId: number; tabId: number; url: string; title: string }
class Tabs extends FakeHands {
  tabs: Tab[] = [{ windowId: 10, tabId: 101, url: shopURL, title: "Synthetic groceries" }, { windowId: 20, tabId: 202, url: personalURL, title: "Synthetic personal work" }];
  front = 101;
  calls: Array<{ op: string; args: Record<string, unknown>; target?: number }> = [];
  private target(args: Record<string, unknown>) {
    const pinned = args["windowId"] !== undefined || args["tabId"] !== undefined;
    const tab = this.tabs.find(t => pinned ? t.windowId === args["windowId"] && t.tabId === args["tabId"] : t.tabId === this.front);
    if (!tab) throw new NativeRequestError({ code: "not_found", message: "The bound browser tab no longer exists" });
    return tab;
  }
  override async request<T>(op: string, args: Record<string, unknown> = {}): Promise<T> {
    const entry: { op: string; args: Record<string, unknown>; target?: number } = { op, args }; this.calls.push(entry);
    if (op === "frontmost") return { app: "Google Chrome" } as T;
    if (op === "focused_text") return { secure: false } as T;
    if (op === "browser_tabs") return { tabs: this.tabs.map((t, index) => ({ ...t, index: index + 1, active: t.tabId === this.front })), active: this.tabs.findIndex(t => t.tabId === this.front) + 1 } as T;
    if (op === "browser_navigate" && args["newTab"] === true) {
      const tab = { windowId: 30, tabId: 303, url: String(args["url"]), title: "Synthetic dedicated shopping" };
      this.tabs.push(tab); entry.target = tab.tabId;
      return { ok: true, windowId: tab.windowId, tabId: tab.tabId } as T;
    }
    if (["browser_url", "browser_js", "browser_navigate"].includes(op)) {
      const tab = this.target(args); entry.target = tab.tabId;
      if (op === "browser_url") return { ...tab } as T;
      if (op === "browser_navigate") { tab.url = String(args["url"]); return { ok: true, windowId: tab.windowId, tabId: tab.tabId } as T; }
      const script = String(args["script"]);
      if (script === "1+1") return { result: "2" } as T;
      if (script === GROCERY_READINESS_SCRIPT) return { result: JSON.stringify({ url: tab.url, readyState: "complete", visibleBusy: false, hasContent: true, hasSearchResults: true }) } as T;
      if (args["readOnly"] !== true) return { result: JSON.stringify({ ok: true, operation: "cart control clicked", control: "add" }) } as T;
      return { result: JSON.stringify({ url: tab.url, title: tab.title, text: tab.tabId === 202 ? "UNRELATED_PERSONAL_PAGE" : "Synthetic shopping rows. View Carts.", length: 36 }) } as T;
    }
    return super.request<T>(op);
  }
}
function fixture(t: { after(fn: () => void): void }) {
  const hands = new Tabs(), scope = { sessionId: `binding_${randomUUID()}`, mode: "grocery" as const };
  const signal = new AbortController().signal;
  let stateDir: string | undefined;
  const make = (runSignal = signal) => {
    const made = makeRunner({ ...(stateDir ? { stateDir } : {}), policy: () => ({ verdict: "run", reason: "synthetic policy" }), work: { isActive: () => true, model: () => "{}", receipt: () => undefined } }, hands);
    stateDir ??= made.dir;
    t.after(() => { made.runner.attach(undefined); rmSync(made.dir, { recursive: true, force: true }); });
    made.runner.attach(makeSink().sink, { ...makeTask("Prepare my grocery cart", runSignal), work: scope, groceryRun: true });
    return made.runner;
  };
  return { hands, scope, make, runner: make() };
}

test("grocery reads and actions stay in the exact shopping tab across foreground and runner changes", async t => {
  const f = fixture(t);
  assert.equal((await f.runner.run("browser_read", {})).result.kind, "text");
  f.runner.attach(undefined); f.hands.front = 202;
  const nextRunner = f.make(), before = f.hands.calls.length;
  const read = (await nextRunner.run("browser_read", {})).result;
  assert.equal(read.kind, "text"); if (read.kind === "text") assert.doesNotMatch(read.text, /UNRELATED_PERSONAL_PAGE/);
  assert.equal((await nextRunner.run("browser_click", { text: "Add", windowId: 20, tabId: 202 })).result.kind, "text");
  assert.equal((await nextRunner.run("browser_navigate", { url: "https://www.instacart.com/store/aldi/s?k=eggs", windowId: 20, tabId: 202 })).result.kind, "text");
  assert.equal((await nextRunner.run("browser_read", {})).result.kind, "text");
  const operations = f.hands.calls.slice(before).filter(c => ["browser_js", "browser_navigate"].includes(c.op));
  assert.ok(operations.length > 3);
  assert.ok(operations.every(c => c.args["windowId"] === 10 && c.args["tabId"] === 101 && c.target === 101), "model arguments and foreground changes cannot retarget the trusted grocery binding");
  assert.equal(f.hands.tabs.find(t => t.tabId === 202)!.url, personalURL);
});

test("closing the pinned grocery tab refuses instead of reading or replacing the foreground page", async t => {
  const f = fixture(t); await f.runner.run("browser_read", {});
  f.hands.tabs = f.hands.tabs.filter(t => t.tabId !== 101); f.hands.front = 202;
  const before = f.hands.calls.length;
  for (const [name, args] of [["browser_read", {}], ["browser_navigate", { url: shopURL }], ["browser_click", { text: "Add" }]] as const) {
    assert.equal((await f.runner.run(name, args)).result.kind, "error", name);
  }
  assert.equal(f.hands.calls.slice(before).some(c => c.op === "browser_navigate" || c.op === "browser_js" && c.target === 202), false);
  assert.equal(f.hands.tabs.length, 1); assert.equal(f.hands.tabs[0]!.url, personalURL);
});

test("a user navigating the pinned tab away from shopping prevents grocery replacement", async t => {
  const f = fixture(t); await f.runner.run("browser_read", {});
  f.hands.tabs[0]!.url = personalURL; const before = f.hands.calls.length;
  assert.equal((await f.runner.run("browser_read", {})).result.kind, "error");
  assert.equal((await f.runner.run("browser_navigate", { url: shopURL })).result.kind, "error");
  assert.equal(f.hands.calls.slice(before).some(c => c.op === "browser_navigate"), false);
  assert.equal(f.hands.tabs[0]!.url, personalURL);
});

test("a later explicit run can recover a closed target without rebinding the old run", async t => {
  const f = fixture(t); await f.runner.run("browser_read", {});
  f.hands.tabs = f.hands.tabs.filter(t => t.tabId === 202); f.hands.front = 202;
  assert.equal((await f.runner.run("browser_read", {})).result.kind, "error");
  const retry = f.make(new AbortController().signal);
  assert.equal((await retry.run("browser_read", {})).result.kind, "error", "new run still has no shopping page yet");
  assert.equal((await retry.run("browser_navigate", { url: "https://www.instacart.com/store/" })).result.kind, "text");
  assert.equal((await retry.run("browser_read", {})).result.kind, "text");
  assert.equal((await f.runner.run("browser_read", {})).result.kind, "error", "old run remains bound to its closed target");
  assert.equal(f.hands.tabs.find(t => t.tabId === 202)!.url, personalURL);
});

test("grocery preparation with no shopping tab creates a dedicated tab without overwriting the user page", async t => {
  const f = fixture(t); f.hands.tabs = f.hands.tabs.filter(t => t.tabId === 202); f.hands.front = 202;
  assert.equal((await f.runner.run("browser_read", {})).result.kind, "error");
  assert.equal((await f.runner.run("browser_navigate", { url: "https://www.instacart.com/store/" })).result.kind, "text");
  assert.equal((await f.runner.run("browser_read", {})).result.kind, "text");
  const navigation = f.hands.calls.find(c => c.op === "browser_navigate");
  assert.equal(navigation?.args["newTab"], true); assert.equal(navigation?.target, 303);
  assert.equal(f.hands.tabs.find(t => t.tabId === 202)!.url, personalURL);
  assert.ok(f.hands.calls.filter(c => c.op === "browser_js").every(c => c.target === 303), "no grocery DOM is read from unrelated content");
});

test("general browser tools retain their ordinary active-tab behavior without grocery target fields", async t => {
  const f = fixture(t); f.hands.front = 202;
  f.runner.attach(makeSink().sink, makeTask("Read the page I am looking at"));
  const read = (await f.runner.run("browser_read", {})).result;
  assert.equal(read.kind, "text"); if (read.kind === "text") assert.match(read.text, /UNRELATED_PERSONAL_PAGE/);
  assert.equal((await f.runner.run("browser_navigate", { url: "https://example.org/next" })).result.kind, "text");
  assert.equal(f.hands.tabs.find(t => t.tabId === 202)!.url, "https://example.org/next");
  assert.ok(f.hands.calls.filter(c => ["browser_js", "browser_navigate"].includes(c.op)).every(c => c.args["windowId"] === undefined && c.args["tabId"] === undefined && c.args["newTab"] === undefined));
});

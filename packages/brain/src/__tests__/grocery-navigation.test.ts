import { test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { randomUUID } from "node:crypto";
import { ComputerToolset, ConfirmationState } from "@hormes/hands";
import { BrowserTools } from "../browser.ts";
import { GROCERY_READINESS_SCRIPT, groceryActionScript, groceryNavigationReady, groceryUrlAllowed } from "../grocery-browser.ts";
import { FakeHands } from "./fakes.ts";

const home = "https://www.instacart.com/store/";
const eggs = "https://www.instacart.com/store/s?k=eggs";
const milk = "https://www.instacart.com/store/s?k=milk";
type Probe = Parameters<typeof groceryNavigationReady>[1];
const ready = (url = eggs): Probe => ({ url, readyState: "complete", visibleBusy: false, hasContent: true, hasSearchResults: true });

class DelayedBrowser extends FakeHands {
  events: string[] = [];
  probes: Probe[] = [];
  current = ready(home);
  rawReadUrl: string | undefined;
  js = true;
  override async request<T>(op: string, params: Record<string, unknown> = {}): Promise<T> {
    if (op === "frontmost") return { app: "Google Chrome" } as T;
    if (op === "browser_navigate") { this.events.push(`navigate:${params["url"]}`); return {} as T; }
    if (op === "browser_url") return { url: this.current.url, title: "Synthetic groceries", windowId: 10, tabId: 101 } as T;
    if (op === "browser_tabs") return { tabs: [{ url: this.current.url, title: "Synthetic groceries", windowId: 10, tabId: 101, index: 1, active: true }], active: 1 } as T;
    if (op === "browser_js") {
      if (!this.js) return { result: "missing value" } as T;
      const script = String(params["script"]);
      if (script === "1+1") return { result: "2" } as T;
      assert.equal(params["readOnly"], true, "readiness and page receipts are observation-only");
      if (script === GROCERY_READINESS_SCRIPT) {
        this.current = this.probes.shift() ?? this.current;
        this.events.push(`probe:${this.current.url}`);
        return { result: JSON.stringify(this.current) } as T;
      }
      assert.match(script, /document\.body.*innerText/, "only the production page reader is expected");
      const url = this.rawReadUrl ?? this.current.url;
      this.events.push(`read:${url}`);
      return { result: JSON.stringify({ url, title: "Synthetic groceries", text: "Synthetic product results: eggs. Add to cart.", length: 50 }) } as T;
    }
    if (op === "ax_tree") { this.events.push("ax_tree"); return { nodes: [{ role: "AXStaticText", value: "Synthetic page through accessibility" }], count: 1 } as T; }
    return super.request<T>(op);
  }
}
function fixture(grocery = true) {
  const hands = new DelayedBrowser(); let active = true, now = 0, sleeps = 0;
  const sessionId = randomUUID(), signal = new AbortController().signal;
  const toolset = new ComputerToolset({ hands, confirmations: new ConfirmationState() });
  const browser = new BrowserTools({ hands, toolset, policy: () => ({ verdict: "run", reason: "synthetic test policy" }),
    now: () => now,
    ...(grocery ? { grocery: () => () => active, grocerySessionId: () => sessionId, grocerySignal: () => signal } : {}),
    grocerySleep: async ms => { sleeps++; now += ms; },
  });
  return { browser, hands, stop: () => { active = false; }, sleeps: () => sleeps, elapsed: () => now };
}

test("grocery readiness rejects an old home, old query, skeleton and busy page even when URL changes", () => {
  for (const probe of [ready(home), ready(milk), { ...ready(), readyState: "loading" }, { ...ready(), visibleBusy: true }, { ...ready(), hasContent: false }, { ...ready(), hasSearchResults: false }]) {
    assert.equal(groceryNavigationReady(eggs, probe), false, JSON.stringify(probe));
  }
  assert.equal(groceryNavigationReady(eggs, ready()), true);
  assert.equal(groceryNavigationReady(eggs, { ...ready(), readyState: "interactive" }), true);
  assert.equal(groceryNavigationReady(eggs + "&retailer_id=123", ready(eggs + "&retailer_id=456")), false);
});

test("grocery navigation waits for rendered requested results and then requires an actual read before navigating again", async () => {
  const { browser, hands, sleeps } = fixture();
  hands.probes = [ready(home), ready(milk), { ...ready(), visibleBusy: true }, { ...ready(), hasSearchResults: false }, ready()];
  assert.equal((await browser.navigate({ url: eggs })).kind, "text");
  assert.ok(sleeps() >= 4, "stale and loading probes were retried rather than accepted");
  assert.equal(hands.events.some(e => e.startsWith("read:")), false, "readiness does not fabricate a page receipt");
  assert.equal((await browser.navigate({ url: milk })).kind, "error");
  assert.deepEqual(hands.events.filter(e => e.startsWith("navigate:")), [`navigate:${eggs}`]);
  const read = await browser.read({});
  assert.equal(read.kind, "text");
  if (read.kind === "text") assert.match(read.text, /Synthetic product results: eggs/);
  hands.probes = [ready(milk)];
  assert.equal((await browser.navigate({ url: milk })).kind, "text");
  const readAt = hands.events.indexOf(`read:${eggs}`), nextAt = hands.events.indexOf(`navigate:${milk}`);
  assert.ok(readAt > 0 && nextAt > readAt, "a real matching page read precedes the next navigation");
});

test("a stale actual read cannot clear the grocery navigation fence", async () => {
  const { browser, hands } = fixture();
  hands.probes = [ready()];
  assert.equal((await browser.navigate({ url: eggs })).kind, "text");
  hands.rawReadUrl = milk;
  assert.equal((await browser.read({})).kind, "error", "URL changed between readiness and page read");
  assert.equal((await browser.navigate({ url: milk })).kind, "error");
  assert.equal(hands.events.filter(e => e.startsWith("navigate:")).length, 1);
  hands.rawReadUrl = undefined;
  assert.equal((await browser.read({})).kind, "text");
  hands.probes = [ready(milk)];
  assert.equal((await browser.navigate({ url: milk })).kind, "text");
});

test("a grocery loading timeout is bounded and cannot silently replace the pending search", async () => {
  const { browser, hands, sleeps, elapsed } = fixture();
  hands.current = { ...ready(), visibleBusy: true };
  const out = await browser.navigate({ url: eggs });
  assert.equal(out.kind, "error");
  assert.ok(sleeps() > 0 && sleeps() <= 35, "finite polling budget");
  assert.ok(elapsed() <= 12_500, "no indefinite readiness wait");
  assert.equal((await browser.navigate({ url: milk })).kind, "error");
  assert.deepEqual(hands.events.filter(e => e.startsWith("navigate:")), [`navigate:${eggs}`]);
  hands.probes = [ready()];
  assert.equal((await browser.read({})).kind, "text", "a later actual read can recover without new navigation");
});

test("cancellation during grocery readiness stops further probes and prevents a subsequent action", async () => {
  const hands = new DelayedBrowser(); let active = true, sleeps = 0;
  const sessionId = randomUUID(), signal = new AbortController().signal;
  const browser = new BrowserTools({ hands, toolset: new ComputerToolset({ hands, confirmations: new ConfirmationState() }),
    policy: () => ({ verdict: "run", reason: "synthetic test policy" }), grocery: () => () => active, grocerySessionId: () => sessionId, grocerySignal: () => signal,
    grocerySleep: async () => { sleeps++; active = false; },
  });
  const out = await browser.navigate({ url: eggs });
  assert.equal(out.kind, "error"); assert.equal(sleeps, 1);
  assert.equal(hands.events.filter(e => e.startsWith("probe:")).length, 1);
  assert.equal((await browser.navigate({ url: milk })).kind, "error");
  assert.equal(hands.events.filter(e => e.startsWith("navigate:")).length, 1);
});

test("general browsing keeps immediate navigation and its accessibility read fallback", async () => {
  const { browser, hands, sleeps } = fixture(false);
  assert.equal((await browser.navigate({ url: "https://example.org/one" })).kind, "text");
  assert.equal((await browser.navigate({ url: "https://example.org/two" })).kind, "text");
  assert.equal(sleeps(), 0); assert.equal(hands.events.some(e => e.startsWith("probe:")), false);
  hands.js = false;
  const read = await browser.read({}); assert.equal(read.kind, "text");
  if (read.kind === "text") assert.match(read.text, /Synthetic page through accessibility/);
  assert.equal(hands.events.includes("ax_tree"), true);
});

test("parallel grocery navigation requests cannot overwrite an unread destination", async () => {
  const { browser, hands } = fixture(); hands.probes = [ready()];
  const results = await Promise.all([browser.navigate({ url: eggs }), browser.navigate({ url: milk })]);
  assert.equal(results[0]!.kind, "text"); assert.equal(results[1]!.kind, "error");
  assert.deepEqual(hands.events.filter(e => e.startsWith("navigate:")), [`navigate:${eggs}`]);
});

test("observed retailer search links stay bounded to shopping destinations", () => {
  const retailerSearch = "https://www.instacart.com/store/aldi/s?k=bananas&xrs_id=abc";
  assert.equal(groceryUrlAllowed(retailerSearch), true);
  assert.equal(groceryNavigationReady(retailerSearch, ready(retailerSearch)), true);
  for (const url of [retailerSearch + "&redirect=/checkout", "https://www.instacart.com/store/aldi/checkout?k=bananas", "https://www.instacart.com/api/orders?xrs_id=abc"]) assert.equal(groceryUrlAllowed(url), false);
});

test("observed product Add and View Carts labels execute while checkout metadata still refuses", () => {
  const url = "https://www.instacart.com/store/aldi/s?k=bananas&xrs_id=abc";
  for (const label of ["Add 1 ct Bananas, per lb", "Add 1 banana Banana", "View Carts. 4 unique items in your carts"]) {
    let clicked = 0;
    const element = {
      tagName: "BUTTON", type: "button", innerText: label, disabled: false,
      getAttribute: (name: string) => name === "aria-label" ? label : null,
      getBoundingClientRect: () => ({ width: 120, height: 40, bottom: 100, right: 200, top: 60, left: 80 }),
      closest: () => null, click: () => { clicked++; },
    };
    const execute = () => JSON.parse(runInNewContext(groceryActionScript("click", { text: label }, "function __jhFind() { return { els: [candidate], exact: true }; }"), {
      URL, location: { href: url }, innerWidth: 1000, innerHeight: 800, candidate: element,
    })) as { ok?: boolean; refused?: string };
    assert.equal(execute().ok, true, label); assert.equal(clicked, 1);
    element.getAttribute = (name: string) => name === "aria-label" ? "Place order and pay" : null;
    assert.match(execute().refused ?? "", /manual review/); assert.equal(clicked, 1, "unchanged benign visible label cannot hide payment metadata");
  }
});

test("grocery cart control exposes and uses its accessible label when visible text is only the count", async () => {
  const cartLabel = "View Carts. 4 unique items in your carts"; let clicked = 0;
  const element = {
    tagName: "BUTTON", type: "button", innerText: "4", disabled: false, children: [], value: "", title: "", name: "", id: "",
    getAttribute: (name: string) => name === "aria-label" ? cartLabel : null,
    getBoundingClientRect: () => ({ width: 120, height: 40, bottom: 100, right: 200, top: 60, left: 80 }),
    closest: () => null, matches: () => false, click: () => { clicked++; }, focus() {}, scrollIntoView() {},
  };
  class CartBrowser extends FakeHands {
    override async request<T>(op: string, args: Record<string, unknown> = {}): Promise<T> {
      if (op === "frontmost") return { app: "Google Chrome" } as T;
      if (op === "browser_url") return { url: home, title: "Synthetic store", windowId: 10, tabId: 101 } as T;
      if (op === "browser_tabs") return { tabs: [{ url: home, title: "Synthetic store", windowId: 10, tabId: 101, index: 1, active: true }], active: 1 } as T;
      if (op === "browser_js") {
        const script = String(args["script"]);
        if (script === "1+1") return { result: "2" } as T;
        return { result: runInNewContext(script, {
          URL, location: { href: home }, innerWidth: 1000, innerHeight: 800,
          document: { title: "Synthetic store", readyState: "complete", body: { innerText: "Store\n4" },
            querySelectorAll: (selector: string) => selector.includes("progressbar") ? [] : [element], querySelector: () => element },
          window: { screenX: 0, screenY: 0, outerHeight: 900, innerHeight: 800, outerWidth: 1000, innerWidth: 1000 },
        }) } as T;
      }
      return super.request<T>(op);
    }
  }
  const hands = new CartBrowser();
  const sessionId = randomUUID(), signal = new AbortController().signal;
  const browser = new BrowserTools({ hands, toolset: new ComputerToolset({ hands, confirmations: new ConfirmationState() }), grocery: () => () => true, grocerySessionId: () => sessionId, grocerySignal: () => signal, policy: () => ({ verdict: "run", reason: "synthetic test policy" }) });
  const read = await browser.read({}); assert.equal(read.kind, "text");
  if (read.kind === "text") assert.ok(read.text.includes(cartLabel), "cart accessible label reaches the real page receipt");
  const found = await browser.find({ text: cartLabel }); assert.equal(found.kind, "text");
  if (found.kind === "text") assert.equal(JSON.parse(found.text).count, 1);
  assert.equal((await browser.click({ text: cartLabel })).kind, "text"); assert.equal(clicked, 1);
});

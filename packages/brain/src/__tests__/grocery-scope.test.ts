import { test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { classifyToolScope } from "@hormes/core";
import { READ_SELECTED_GROCERY_NOTE_SCRIPT } from "@hormes/protocol";
import { FakeHands, makeRunner, makeSink, makeTask } from "./fakes.ts";
import { groceryUrlAllowed } from "../grocery-browser.ts";

class Element {
  tagName = "BUTTON"; innerText = "Add to cart"; type = "button"; href = ""; title = ""; name = ""; id = ""; placeholder = ""; value = ""; disabled = false;
  children: Element[] = []; attributes: Record<string, string> = {}; inForm = false; clicked = 0; focused = 0; changed = 0; visible = true;
  getAttribute(name: string) { return this.attributes[name] ?? null; }
  getBoundingClientRect() { return { width: this.visible ? 100 : 0, height: 40, bottom: 60, right: 130, top: 20, left: 30 }; }
  closest(selector: string) { return selector === "form" && this.inForm ? this : null; }
  click() { this.clicked++; } focus() { this.focused++; } dispatchEvent() { this.changed++; }
}
class Input extends Element { override tagName = "INPUT"; override type = "search"; override innerText = ""; }
Object.defineProperty(Input.prototype, "value", { set(this: Input, value: string) { this.attributes["typed"] = value; }, get(this: Input) { return this.attributes["typed"] ?? ""; } });
class Browser extends FakeHands {
  calls: string[] = []; url = "https://www.instacart.com/store/s?k=eggs"; js = true; element: Element = new Element(); afterPageRead?: () => void;
  override async request<T>(op: string, params: Record<string, unknown> = {}): Promise<T> {
    this.calls.push(op);
    if (op === "frontmost") return { app: "Google Chrome" } as T;
    if (op === "browser_url") { this.afterPageRead?.(); return { url: this.url, title: "Groceries" } as T; }
    if (op === "browser_tabs") return { tabs: [{ index: 1, windowId: 10, tabId: 101, url: this.url, title: "Groceries", active: true }], active: 1 } as T;
    if (op === "focused_text") return { secure: false } as T;
    if (op === "browser_navigate") { this.url = String(params["url"]); return {} as T; }
    if (op === "browser_js") {
      if (!this.js) return { result: "missing value" } as T;
      const script = String(params["script"]);
      if (script === "1+1") return { result: "2" } as T;
      const location = { href: this.url, assign: (url: string) => { this.url = url; } };
      const result = runInNewContext(script, { URL, location, innerHeight: 800, innerWidth: 1000,
        document: { activeElement: this.element, querySelector: () => this.element, querySelectorAll: () => [this.element] },
        HTMLInputElement: Input, Event: class {}, window: { screenX: 0, screenY: 0, outerHeight: 900, innerHeight: 800, outerWidth: 1000, innerWidth: 1000 } });
      return { result } as T;
    }
    return super.request<T>(op);
  }
}
function setup(browser = new Browser()) {
  let active = true;
  const { runner } = makeRunner({ policy: () => ({ verdict: "run", reason: "test broader approval" }), work: { isActive: () => active, model: () => "context", receipt: () => undefined } }, browser);
  runner.attach(makeSink().sink, { ...makeTask("Build my grocery cart"), work: { sessionId: "grocery", mode: "grocery" } });
  return { runner, browser, stop: () => { active = false; } };
}
test("grocery scope blocks all alternate execution and only permits fixed selected Notes read", async () => {
  const { runner, browser } = setup();
  for (const name of ["left_click", "click_element", "type", "key", "browser_key", "run_shell", "web_fetch", "web_search", "open_url", "open_app", "agent_start", "thread_start", "self_edit", "clipboard_write", "write_file"]) {
    assert.equal((await runner.run(name, { command: "buy", url: "https://www.instacart.com/api/orders", text: "Place order" })).result.kind, "error", name);
  }
  assert.equal(browser.calls.length, 0);
  const scope = { sessionId: "grocery", mode: "grocery" } as const;
  assert.equal(classifyToolScope("applescript", { script: READ_SELECTED_GROCERY_NOTE_SCRIPT }, undefined, scope).verdict, "run");
  assert.equal(classifyToolScope("applescript", { script: READ_SELECTED_GROCERY_NOTE_SCRIPT + '\ndo shell script "curl payment"' }, undefined, scope).verdict, "refuse");
});
test("only shopping URLs pass, with no checkout API redirect or foreign-origin path", () => {
  for (const path of ["/store/s?k=eggs", "/store/cart", "/store/items/item_123", "/store/wegmans/storefront"]) assert.equal(groceryUrlAllowed("https://www.instacart.com" + path), true, path);
  for (const url of ["https://www.instacart.com/store/checkout", "https://www.instacart.com/api/orders", "https://www.instacart.com/store/cart?redirect=/checkout", "https://www.instacart.com/store/cart#checkout", "https://instacart.com.evil.test/store/cart", "https://user@www.instacart.com/store/cart", "https://www.instacart.com/store/%63heckout", "javascript:buy()", "https://www.instacart.com:444/store/cart"]) assert.equal(groceryUrlAllowed(url), false, url);
});
test("normal add-to-cart click executes through production DOM script", async () => {
  const { runner, browser } = setup();
  assert.equal((await runner.run("browser_click", { text: "Add to cart" })).result.kind, "text");
  assert.equal(browser.element.clicked, 1);
  assert.equal(browser.calls.includes("click_element"), false);
});
test("selector laundering cannot turn Add into Place order even with broader approval", async () => {
  const { runner, browser } = setup();
  for (const label of ["Place order", "Pay now", "Checkout", "Buy", "Confirm order", "Continue", "Add to cart"]) {
    browser.element.innerText = label;
    browser.element.attributes = label === "Add to cart" ? { "aria-label": "Place order" } : {};
    assert.equal((await runner.run("browser_click", { text: "Add to cart", selector: "#anything" })).result.kind, "error", label);
  }
  assert.equal(browser.element.clicked, 0);
});
test("actual checkout page, hidden targets and form submit cannot mutate a cart", async () => {
  const { runner, browser } = setup();
  browser.url = "https://www.instacart.com/store/checkout";
  assert.equal((await runner.run("browser_click", { text: "Add" })).result.kind, "error");
  browser.url = "https://www.instacart.com/store/cart";
  browser.element.visible = false;
  assert.equal((await runner.run("browser_click", { selector: "button" })).result.kind, "error");
  browser.element.visible = true; browser.element.inForm = true; browser.element.type = "submit";
  assert.equal((await runner.run("browser_click", { text: "Add to cart" })).result.kind, "error");
  assert.equal(browser.element.clicked, 0);
});
test("typing is restricted to actual search field with no Return/newline or payment entry", async () => {
  const { runner, browser } = setup();
  browser.element = new Input();
  assert.equal((await runner.run("browser_type", { text: "eggs" })).result.kind, "text");
  assert.equal(browser.element.attributes["typed"], "eggs");
  for (const input of [{ text: "eggs", submit: true }, { text: "eggs\nPay" }]) assert.equal((await runner.run("browser_type", input)).result.kind, "error");
  browser.element.type = "text"; browser.element.name = "credit-card";
  assert.equal((await runner.run("browser_type", { text: "1234" })).result.kind, "error");
  assert.equal(browser.calls.includes("key") || browser.calls.includes("type"), false);
});
test("JS unavailable and expired work fail closed without AX/keyboard fallbacks", async () => {
  const { runner, browser, stop } = setup();
  browser.js = false;
  assert.equal((await runner.run("browser_click", { text: "Add to cart" })).result.kind, "error");
  assert.equal(browser.calls.includes("click_element"), false);
  browser.js = true; browser.afterPageRead = stop;
  assert.equal((await runner.run("browser_type", { text: "eggs" })).result.kind, "error");
  assert.equal(browser.element.clicked, 0);
});

test("grocery reads persist the actual DOM-access prerequisite instead of treating browser toolbar text as cart evidence", async () => {
  const browser = new Browser(); browser.js = false;
  const blocked: unknown[] = [], receipts: unknown[] = [];
  const { runner } = makeRunner({ work: {
    isActive: () => true,
    model: (_scope, operation, payload) => { blocked.push({ operation, payload }); return "saved"; },
    receipt: (...args) => { receipts.push(args); return undefined; },
  } }, browser);
  runner.attach(makeSink().sink, { ...makeTask("Prepare my grocery cart"), work: { sessionId: "grocery", mode: "grocery" } });
  const result = (await runner.run("browser_read", {})).result;
  assert.equal(result.kind, "error");
  if (result.kind !== "error") return;
  assert.match(result.message, /JavaScript from Apple Events.*Google Chrome/);
  assert.deepEqual(blocked, [{ operation: "grocery", payload: { stage: "blocked", reason: result.message } }]);
  assert.equal(receipts.length, 0, "toolbar/AX fallback cannot become cart evidence");
  assert.equal(browser.calls.includes("ax_tree"), false);
  assert.equal(browser.element.clicked, 0);
  runner.attach(undefined);
});


test("explicit selected-note import uses fixed read capability without redundant app confirmation", async () => {
  let scripts: string[] = [];
  const { runner, toolset } = makeRunner({
    work: { isActive: () => true, model: () => "context", receipt: () => undefined },
    runAppleScript: async script => {
      scripts.push(script);
      return { code: 0, signal: null, stdout: "HORMES_SELECTED_NOTE_V1\nsynthetic-note\ntoday\nGroceries\neggs", stderr: "", timedOut: false, cancelled: false, ms: 1 };
    },
  });
  runner.attach(makeSink().sink, { ...makeTask("Read my selected grocery note"), work: { sessionId: "grocery", mode: "grocery" } });
  assert.equal((await runner.run("applescript", { script: READ_SELECTED_GROCERY_NOTE_SCRIPT })).result.kind, "text");
  assert.deepEqual(scripts, [READ_SELECTED_GROCERY_NOTE_SCRIPT]);
  assert.equal(toolset.confirmations.pending, undefined);
  assert.equal((await runner.run("applescript", { script: READ_SELECTED_GROCERY_NOTE_SCRIPT.replace("selection", "every note") })).result.kind, "error");
  assert.equal(scripts.length, 1, "no widened Notes query executed");
});


test("grocery find with JavaScript disabled never searches another foreground tab through accessibility", async () => {
  const { runner, browser } = setup();
  browser.js = false;
  const result = await runner.run("browser_find", { text: "View Carts" });
  assert.equal(result.result.kind, "error");
  assert.equal(browser.calls.includes("find_element"), false);
  assert.equal(browser.calls.includes("ax_tree"), false);
});

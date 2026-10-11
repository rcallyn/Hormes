import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { resultText } from "../runner.ts";
import { groceryActionScript } from "../grocery-browser.ts";
import { FakeHands, makeRunner, makeSink, makeTask } from "./fakes.ts";

const url = "https://www.instacart.com/store/";
const aldi = "Continue Shopping — ALDI";
class Element {
  parentElement: Element | null = null;
  children: Element[] = [];
  visible = true;
  disabled = false;
  type = "button";
  title = ""; name = ""; id = ""; value = "";
  aria: string | null = null;
  form = false;
  clicks = 0;
  constructor(readonly tagName: string, public text = "") {}
  get innerText(): string { return this.text || this.children.map(child => child.innerText).join("\n"); }
  append(...children: Element[]): this { children.forEach(child => { child.parentElement = this; this.children.push(child); }); return this; }
  getAttribute(name: string): string | null { return name === "aria-label" ? this.aria : name === "role" && this.tagName === "BUTTON" ? "button" : null; }
  getBoundingClientRect() { return { width: this.visible ? 160 : 0, height: 30, left: 20, top: 40, right: 180, bottom: 70 }; }
  closest(name: string) { return name === "form" && this.form ? {} : null; }
  matches(selector: string) { return selector === "a" && this.tagName === "A"; }
  querySelectorAll(selector: string): Element[] {
    const descendants = this.children.flatMap(child => [child, ...child.all()]);
    if (selector === "h1,h2,h3,h4") return descendants.filter(el => /^H[1-4]$/.test(el.tagName));
    if (selector.includes("progressbar")) return [];
    if (selector.includes("button")) return descendants.filter(el => el.tagName === "BUTTON" && (!selector.includes("[aria-label]") || el.aria));
    return descendants;
  }
  all(): Element[] { return this.children.flatMap(child => [child, ...child.all()]); }
  click() { this.clicks++; }
  focus() {}
  scrollIntoView() {}
}
function card(retailer: string) {
  const heading = new Element("H2", retailer), label = new Element("DIV", "Personal Cart"), button = new Element("BUTTON", "Continue Shopping");
  return { heading, label, button, group: new Element("SECTION").append(heading, label, button) };
}
class ChooserHands extends FakeHands {
  readonly aldi = card("ALDI");
  readonly dicks = card("DICK’S Sporting Goods");
  readonly body = new Element("BODY").append(this.aldi.group, this.dicks.group);
  readonly actions: string[] = [];
  override async request<T>(op: string, args: Record<string, unknown> = {}): Promise<T> {
    if (op === "frontmost") return { app: "Google Chrome" } as T;
    if (op === "browser_url") return { url, title: "Synthetic Carts", windowId: 10, tabId: 101 } as T;
    if (op === "browser_tabs") return { tabs: [{ windowId: 10, tabId: 101, url, title: "Synthetic Carts", index: 1, active: true }] } as T;
    if (op === "browser_js") {
      if (!args["readOnly"]) this.actions.push(String(args["script"]));
      return { result: runInNewContext(String(args["script"]), {
        URL, location: { href: url }, innerWidth: 1000, innerHeight: 800,
        window: { screenX: 0, screenY: 0, outerHeight: 900, innerHeight: 800, outerWidth: 1000, innerWidth: 1000 },
        document: { title: "Synthetic Carts", readyState: "complete", body: this.body, querySelectorAll: (selector: string) => this.body.querySelectorAll(selector) },
      }) } as T;
    }
    return super.request<T>(op);
  }
}
function fixture(t: { after(fn: () => void): void }, grocery = true) {
  const hands = new ChooserHands(), receipts: string[] = [];
  const { runner, dir } = makeRunner({ work: { isActive: () => true, model: () => "{}", receipt: (_scope, _name, _args, text) => { receipts.push(text); return undefined; } } }, hands);
  t.after(() => { runner.attach(undefined); rmSync(dir, {recursive: true, force: true}); });
  runner.attach(makeSink().sink, { ...makeTask(grocery ? "Prepare my grocery cart from the selected note" : "Read the cart chooser"), ...(grocery ? { work: { sessionId: randomUUID(), mode: "grocery" as const }, groceryRun: true } : {}) });
  return { hands, runner, receipts };
}

test("fresh grocery read and find distinguish repeated actual retailer buttons, then select only the named cart", async t => {
  const { hands, runner, receipts } = fixture(t);
  hands.aldi.group.append(new Element("H3", "Personal Cart"));
  const read = resultText((await runner.run("browser_read", {})).result);
  assert.match(read, /Continue Shopping — ALDI/); assert.match(read, /Continue Shopping — DICK’S Sporting Goods/);
  assert.doesNotMatch(read, /Milk|Eggs|Bananas|Quantity|Cart inspected/, "chooser labels cannot invent cart contents");
  assert.equal(hands.actions.length, 0);
  const found = resultText((await runner.run("browser_find", {text: aldi})).result);
  assert.match(found, /"count":1/); assert.match(found, /"text":"Continue Shopping — ALDI"/);
  const click = await runner.run("browser_click", {text: aldi}); assert.equal(click.result.kind, "text");
  assert.equal(hands.aldi.button.clicks, 1); assert.equal(hands.dicks.button.clicks, 0);
  assert.match(resultText(click.result), /Read the cart to verify/);
  hands.aldi.group.text = "ALDI\nYour cart\nWhole Milk — Quantity 1 — Remove\nLarge Eggs — Quantity 1 — Remove\nBananas — Quantity 3 — Remove";
  const inspected = resultText((await runner.run("browser_read", {})).result);
  assert.match(inspected, /Whole Milk — Quantity 1 — Remove/);
  assert.ok(receipts.some(receipt => receipt.includes("Whole Milk — Quantity 1 — Remove")));
  assert.equal(hands.aldi.button.clicks, 1, "read-first reconciliation does not add or repeat actions");
});

test("bare Continue Shopping and generic Continue remain refused, including a single visible button", async t => {
  const { hands, runner } = fixture(t);
  for (const text of ["Continue Shopping", "Continue"]) assert.equal((await runner.run("browser_click", {text})).result.kind, "error");
  hands.dicks.button.visible = false;
  assert.equal((await runner.run("browser_click", {text:"Continue Shopping"})).result.kind, "error");
  assert.equal(hands.aldi.button.clicks + hands.dicks.button.clicks, 0);
});

test("a changed retailer heading after observation refuses the stale contextual target", async t => {
  const { hands, runner } = fixture(t);
  assert.match(resultText((await runner.run("browser_read", {})).result), /Continue Shopping — ALDI/);
  hands.aldi.heading.text = "Different retailer";
  const result = await runner.run("browser_click", {text: aldi});
  assert.equal(result.result.kind, "error"); assert.match(resultText(result.result), /missing or ambiguous/);
  assert.equal(hands.aldi.button.clicks + hands.dicks.button.clicks, 0);
});

test("duplicate matching retailer groups cannot silently pick the first cart", async t => {
  const { hands, runner } = fixture(t); hands.dicks.heading.text = "ALDI";
  assert.match(resultText((await runner.run("browser_find", {text: aldi})).result), /"count":2/);
  assert.equal((await runner.run("browser_click", {text: aldi})).result.kind, "error");
  assert.equal(hands.aldi.button.clicks + hands.dicks.button.clicks, 0);
});

test("missing, hidden or ambiguous cart context and form submission never gain a Continue capability", async t => {
  const { hands, runner } = fixture(t);
  const refuse = async () => { assert.equal((await runner.run("browser_click", {text: aldi})).result.kind, "error"); assert.equal(hands.aldi.button.clicks, 0); };
  hands.aldi.label.text = "Other context"; await refuse(); hands.aldi.label.text = "Personal Cart";
  hands.aldi.heading.visible = false; await refuse(); hands.aldi.heading.visible = true;
  hands.aldi.button.visible = false; await refuse(); hands.aldi.button.visible = true;
  const second = new Element("H3", "Checkout"); hands.aldi.group.append(second); await refuse(); hands.aldi.group.children.pop();
  hands.aldi.button.form = true; await refuse(); hands.aldi.button.form = false;
  hands.aldi.button.aria = "Continue Shopping and Checkout"; await refuse(); hands.aldi.button.aria = null;
  hands.aldi.heading.text = "Checkout";
  assert.equal((await runner.run("browser_click", {text: "Continue Shopping — Checkout"})).result.kind, "needs-confirmation", "ordinary payment policy intercepts the request first");
  const guarded = JSON.parse(runInNewContext(groceryActionScript("click", {text: "Continue Shopping — Checkout"}, ""), {
    URL, location: {href: url}, innerWidth: 1000, innerHeight: 800,
    document: {querySelectorAll: (selector: string) => hands.body.querySelectorAll(selector)},
  }));
  assert.match(guarded.refused, /manual review/, "the finite grocery guard still refuses even if the outer policy were approved");
  assert.equal(hands.aldi.button.clicks, 0);
});

test("general browser read and find do not invent grocery contextual names", async t => {
  const { runner, hands } = fixture(t, false);
  const read = resultText((await runner.run("browser_read", {})).result);
  assert.match(read, /ALDI\nPersonal Cart\nContinue Shopping/); assert.doesNotMatch(read, /Continue Shopping —|Visible button labels/);
  assert.match(resultText((await runner.run("browser_find", {text:"Continue Shopping"})).result), /"count":2/);
  assert.equal(hands.actions.length, 0);
});

test("observed singular counted Cart header has read-find-click parity on the same bound shopping tab", async t => {
  const { hands, runner, receipts } = fixture(t);
  const header = new Element("BUTTON", "3");
  hands.body.children = []; hands.body.append(header);
  const targets: Record<string, unknown>[] = [];
  const request = hands.request.bind(hands);
  hands.request = async <T>(op: string, args: Record<string, unknown> = {}): Promise<T> => {
    if (op === "browser_url" || op === "browser_js") targets.push(args);
    return request<T>(op, args);
  };
  for (const label of ["View Cart. 3 unique items in your cart", "View Cart. 1 unique item in your cart", "View Cart. 0 unique items in your cart", "View Carts. 12 unique items in your carts"]) {
    header.aria = label;
    assert.ok(resultText((await runner.run("browser_read", {})).result).includes(label));
    const found = resultText((await runner.run("browser_find", {text:label})).result);
    assert.match(found, /"count":1/); assert.ok(found.includes(label));
    const before = header.clicks;
    const clicked = await runner.run("browser_click", {text:label});
    assert.equal(clicked.result.kind, "text", resultText(clicked.result));
    assert.equal(header.clicks, before + 1);
    assert.match(resultText(clicked.result), /Read the cart to verify the result; no purchase was authorized/);
  }
  assert.ok(targets.length > 0 && targets.every(args => args["windowId"] === 10 && args["tabId"] === 101), "read, find and click use the original allowed tab");
  assert.ok(receipts.some(receipt => receipt.includes("View Cart. 3 unique items in your cart")));
  assert.ok(receipts.every(receipt => !/Milk|Eggs|Bananas|Quantity/.test(receipt)), "a header count cannot invent product evidence");
});

test("counted Cart labels still refuse checkout changes, form submission and ambiguous targets", async t => {
  const { hands, runner } = fixture(t);
  const label = "View Cart. 3 unique items in your cart", header = new Element("BUTTON", "3");
  header.aria = label; hands.body.children = []; hands.body.append(header);
  assert.match(resultText((await runner.run("browser_find", {text:label})).result), /"count":1/);
  header.aria = label + " — Checkout";
  assert.equal((await runner.run("browser_click", {text:label})).result.kind, "error");
  header.aria = label; header.form = true; header.type = "submit";
  assert.equal((await runner.run("browser_click", {text:label})).result.kind, "error");
  header.form = false; header.type = "button";
  const duplicate = new Element("BUTTON", "3"); duplicate.aria = label; hands.body.append(duplicate);
  assert.equal((await runner.run("browser_click", {text:label})).result.kind, "error");
  assert.equal(header.clicks + duplicate.clicks, 0);
});

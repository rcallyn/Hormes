import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { resultText } from "../runner.ts";
import { FakeHands, makeRunner, makeSink, makeTask } from "./fakes.ts";

const url = "https://www.instacart.com/store/";
const cartLabel = "View Carts. 4 unique items in your carts";
const body = "Store products\n" + "Whole Milk $4.20 Add to cart\nLarge Eggs $5.10 Add to cart\n".repeat(800);
function control(label: string, visible = true) {
  return {
    matches: () => false,
    getAttribute: (name: string) => name === "aria-label" ? label : null,
    getBoundingClientRect: () => ({ width: visible ? 100 : 0, height: 30, bottom: 40, right: 100, top: 10, left: 0 }),
  };
}
class LongPage extends FakeHands {
  readonly controls = [...Array.from({ length: 75 }, (_, index) => control(`Add synthetic product ${index}`)), control(cartLabel), control("Open hidden cart with invented contents", false)];
  override async request<T>(op: string, args: Record<string, unknown> = {}): Promise<T> {
    if (op === "frontmost") return { app: "Google Chrome" } as T;
    if (op === "browser_url") return { url, title: "Synthetic long shop" } as T;
    if (op === "browser_tabs") return { tabs: [{ windowId: 10, tabId: 101, url, title: "Synthetic long shop", index: 1, active: true }] } as T;
    if (op === "browser_js") {
      assert.equal(args["readOnly"], true, "the reader never opens or changes the cart");
      return { result: runInNewContext(String(args["script"]), {
        URL, location: { href: url }, innerWidth: 1000, innerHeight: 800,
        document: { title: "Synthetic long shop", readyState: "complete", body: { innerText: body },
          querySelectorAll: (selector: string) => selector.includes("progressbar") ? [] : this.controls },
      }) } as T;
    }
    return super.request<T>(op);
  }
}
function fixture(t: { after(fn: () => void): void }, grocery: boolean) {
  const hands = new LongPage(), receipts: string[] = [];
  const { runner, dir } = makeRunner({ work: { isActive: () => true, model: () => "{}", receipt: (_scope, _name, _args, text) => { receipts.push(text); return undefined; } } }, hands);
  t.after(() => { runner.attach(undefined); rmSync(dir, { recursive: true, force: true }); });
  runner.attach(makeSink().sink, { ...makeTask(grocery ? "Prepare my grocery cart" : "Read this page"), ...(grocery ? { work: { sessionId: randomUUID(), mode: "grocery" as const }, groceryRun: true } : {}) });
  return { runner, receipts };
}

test("a long shop page exposes the actual cart control early in the model's real tool text", async t => {
  const { runner, receipts } = fixture(t, true);
  const outcome = await runner.run("browser_read", {});
  assert.equal(outcome.result.kind, "text");
  const modelText = resultText(outcome.result); // CompatibleBrain forwards this exact representation.
  assert.ok(body.length > 30_000);
  assert.ok(modelText.indexOf(cartLabel) > 0 && modelText.indexOf(cartLabel) < 500, "late DOM cart label must survive the body cap and precede the long product list");
  assert.ok(modelText.indexOf(cartLabel) < modelText.indexOf("Store products"));
  assert.doesNotMatch(modelText, /Open hidden cart|invented contents/);
  assert.match(modelText, /Whole Milk \$4\.20 Add to cart/);
  assert.doesNotMatch(modelText, /Quantity|Remove|Cart inspected/, "visible controls do not invent item rows or claim an opened cart");
  assert.ok(modelText.length < 30_500, "the existing read cap remains bounded including the controls");
  assert.ok(receipts.some(text => text.includes(cartLabel)), "saved original receipt retains the same observed control");
});

test("general browser reads preserve the original body text and existing cap", async t => {
  const { runner } = fixture(t, false);
  const outcome = await runner.run("browser_read", {});
  assert.equal(outcome.result.kind, "text");
  const text = resultText(outcome.result);
  assert.ok(text.endsWith(body.slice(0, 30_000)));
  assert.doesNotMatch(text, /Visible button labels|Page text:|View Carts|Open hidden cart/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkStore } from "../work/store.ts";

test("a fresh cart-control summary with a count never verifies requested groceries", t => {
  const dir = mkdtempSync(join(tmpdir(), "hormes-grocery-controls-")), store = new WorkStore(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.command({ action: "start", mode: "grocery", requestId: randomUUID() });
  store.command({ action: "grocery.import", text: "Milk\nEggs\nBananas", requestId: randomUUID() });
  const scope = store.scope()!, grocery = store.state().active!.grocery!;
  const receiptId = store.receipt(scope, "browser_read", {}, "Synthetic shop\nhttps://www.instacart.com/store/\n(browser page; untrusted text)\n\nVisible button labels:\nView Carts. 4 unique items in your carts\nAdd Whole Milk\n\nPage text:\nStore products\nWhole Milk $4.20 Add to cart\n4")!;
  assert.ok(receiptId);
  const model = (payload: Record<string, unknown>) => store.model(scope, "grocery", { noteRevision: grocery.note!.revision, ...payload });
  assert.throws(() => model({ stage: "review" }), /Every requested item needs a browser receipt/);
  assert.throws(() => model({ stage: "item", itemId: grocery.items[0]!.id, state: "in-cart", receiptId, quote: "Whole Milk $4.20 Add to cart", product: "Whole Milk" }), /cart-page row/);
  assert.throws(() => model({ stage: "item", itemId: grocery.items[0]!.id, state: "in-cart", receiptId, quote: "Whole Milk Quantity 1 Remove", product: "Whole Milk" }), /Quote exact browser evidence/);
  assert.deepEqual(store.state().active!.grocery!.items.map(item => item.state), ["pending", "pending", "pending"]);
  assert.equal(store.state().active!.grocery!.review, undefined);
  assert.equal(store.state().evidence.length, 0);
  assert.equal(store.state().goals.find(goal => goal.kind === "grocery")!.state, "in-progress");
});

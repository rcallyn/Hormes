import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { READ_SELECTED_GROCERY_NOTE_SCRIPT, type WorkCommand, type WorkReply } from "@hormes/protocol";
import { WorkStore, DEMO_BLOCKS } from "../work/store.ts";
import { WorkCoordinator } from "../work/coordinator.ts";
import type { Brain } from "@hormes/brain";

function fixture(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(join(tmpdir(), "hormes-grocery-")); let at = 1_800_000_000_000;
  const store = new WorkStore(dir, () => at);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const send = (c: Omit<WorkCommand, "requestId">) => store.command({ ...c, requestId: randomUUID() });
  send({ action: "demo", blockId: "grocery" });
  const model = (payload: Record<string, unknown>) => store.model(store.scope()!, "grocery", { noteRevision: store.state().active!.grocery!.note?.revision, ...payload });
  const receipt = (text: string, url = "https://www.instacart.com/store/checkout_v3") => store.receipt(store.scope()!, "browser_read", {}, `Groceries\n${url}\n(browser page; untrusted text)\n\n${text}`)!;
  return { store, dir, send, model, receipt, advance: (ms: number) => { at += ms; } };
}
const nativeNote = (text = "Groceries\n- Milk\n- Eggs\n[x] Already bought apples", modified = "Sunday, October 11, 2026 at 9:00 AM") => `HORMES_SELECTED_NOTE_V1\nx-coredata://notes/Note/p1\n${modified}\nGroceries\n${text}`;

test("selected note → original items and separate plan → actual cart receipts → review persists without purchase or goal completion", t => {
  const { store, dir, model, receipt } = fixture(t), scope = store.scope()!;
  assert.equal(store.state().active!.grocery!.note, undefined);
  const sourceId = store.receipt(scope, "applescript", { script: READ_SELECTED_GROCERY_NOTE_SCRIPT }, nativeNote())!;
  const grocery = store.state().active!.grocery!;
  assert.equal(grocery.note!.origin, "apple-notes"); assert.deepEqual(grocery.items.map(i => i.request), ["Milk", "Eggs"]);
  assert.equal(store.state().sources.find(s => s.id === sourceId)!.text, nativeNote().split("\n").slice(4).join("\n"));
  model({ stage: "plan", steps: [{ text: "Find the requested dairy and eggs, then verify the cart", itemIds: grocery.items.map(i => i.id) }] });
  assert.ok(store.state().active!.grocery!.items.every(i => i.state === "pending"));
  const cart = receipt("Your cart\nWhole Milk · Quantity 1 · $4.20 · Remove\nLarge Eggs · Quantity 1 · $5.10 · Remove\nCheckout");
  model({ stage: "item", itemId: grocery.items[0]!.id, state: "in-cart", receiptId: cart, quote: "Whole Milk · Quantity 1 · $4.20 · Remove", product: "Whole Milk", priceText: "$4.20" });
  model({ stage: "item", itemId: grocery.items[1]!.id, state: "in-cart", receiptId: cart, quote: "Large Eggs · Quantity 1 · $5.10 · Remove", product: "Large Eggs", priceText: "$5.10" });
  model({ stage: "review" });
  const final = store.state().active!.grocery!;
  assert.equal(final.phase, "review"); assert.match(final.review!.summary, /2 of 2/); assert.match(final.review!.summary, /purchase have not been performed/);
  assert.equal(store.state().goals.find(g => g.kind === "grocery")!.state, "in-progress"); assert.equal(store.state().evidence.length, 0);
  assert.throws(() => model({ stage: "purchase" }), /never performed/);
  assert.throws(() => store.model(scope, "artifact", { text: "Order placed", sourceIds: [cart] }), /no purchase/);
  store.close(); const reopened = new WorkStore(dir);
  try { assert.deepEqual(reopened.state().active!.grocery, final); } finally { reopened.close(); }
});

test("pasted list is labeled, original revisions preserved, unchanged native reads idempotent, stale evidence rejected", t => {
  const { store, send, model, receipt } = fixture(t);
  send({ action: "grocery.import", text: "- Milk", title: "Groceries" });
  assert.equal(store.state().active!.grocery!.note!.origin, "pasted");
  const old = store.state().active!.grocery!.note!, oldReceipt = receipt("Your cart\nWhole Milk Quantity 1 Remove");
  send({ action: "grocery.import", text: "- Eggs", title: "Groceries" });
  assert.ok(store.state().sources.some(s => s.id === old.sourceId && s.text === "- Milk"));
  assert.throws(() => model({ stage: "plan", noteRevision: old.revision, steps: [] }), /list changed/);
  assert.throws(() => model({ stage: "item", itemId: store.state().active!.grocery!.items[0]!.id, state: "in-cart", receiptId: oldReceipt, quote: "Whole Milk Quantity 1 Remove", product: "Whole Milk" }), /recent browser_read/);
  const scope = store.scope()!;
  assert.equal(store.receipt(scope, "applescript", { script: "tell application \"Notes\" to get name of first note" }, nativeNote()), undefined);
  const nativeId = store.receipt(scope, "applescript", { script: READ_SELECTED_GROCERY_NOTE_SCRIPT }, nativeNote());
  assert.equal(store.receipt(scope, "applescript", { script: READ_SELECTED_GROCERY_NOTE_SCRIPT }, nativeNote()), nativeId);
  assert.throws(() => store.receipt(scope, "applescript", { script: READ_SELECTED_GROCERY_NOTE_SCRIPT }, "[exit 1]\nNot authorized"), /Notes did not return/);
  assert.throws(() => model({ stage: "import", text: "invented note" }), /plan, item and review/);
});

test("search/Add-to-cart text, invented price, wrong domain, stale receipts and later cart removals cannot produce a review", t => {
  const { store, send, model, receipt, advance } = fixture(t);
  send({ action: "grocery.import", text: "Milk" }); const itemId = store.state().active!.grocery!.items[0]!.id;
  assert.equal(receipt("Your cart\nWhole Milk Quantity 1 Remove", "https://instacart.com.evil.invalid/cart"), undefined);
  const search = receipt("Whole Milk $4.20 Add to cart");
  assert.throws(() => model({ stage: "item", itemId, state: "in-cart", receiptId: search, quote: "Whole Milk $4.20 Add to cart", product: "Whole Milk" }), /cart-page row/);
  const cart = receipt("Your cart\nWhole Milk Quantity 1 $4.20 Remove");
  const payload = { stage: "item", itemId, state: "in-cart", receiptId: cart, quote: "Whole Milk Quantity 1 $4.20 Remove", product: "Whole Milk" };
  assert.throws(() => model({ ...payload, priceText: "$0.01" }), /price must appear/);
  model(payload); receipt("Your cart\nEmpty cart"); assert.throws(() => model({ stage: "review" }), /final cart/);
  advance(31 * 60_000); assert.throws(() => model(payload), /recent browser_read/);
  assert.equal(store.state().active!.grocery!.phase, "working");
});

test("unavailable and proposed substitute require actual evidence and remain human review flags", t => {
  const { store, send, model, receipt } = fixture(t);
  send({ action: "grocery.import", text: "Milk\nEggs" }); const items = store.state().active!.grocery!.items;
  const page = receipt("Whole Milk is out of stock\nOrganic Eggs $6.00 available");
  model({ stage: "item", itemId: items[0]!.id, state: "unavailable", receiptId: page, quote: "Whole Milk is out of stock", product: "Whole Milk" });
  model({ stage: "item", itemId: items[1]!.id, state: "substitution-needs-review", receiptId: page, quote: "Organic Eggs $6.00 available", product: "Organic Eggs", priceText: "$6.00" });
  model({ stage: "review" }); assert.match(store.state().active!.grocery!.review!.summary, /0 of 2.*2 unavailable or needing substitution review/);
  assert.equal(store.state().active!.grocery!.items[1]!.request, "Eggs");
});

test("new grocery sessions do not inherit another list, task receipt or synthetic completion; travel remains available", t => {
  const { store, send, model, receipt } = fixture(t);
  send({ action: "grocery.import", text: "Milk" }); const prior = store.scope()!, old = receipt("Your cart\nMilk Quantity 1 Remove");
  send({ action: "start", mode: "grocery" }); assert.equal(store.state().active!.demo, false); assert.equal(store.state().active!.grocery!.note, undefined);
  send({ action: "grocery.import", text: "Milk" });
  assert.throws(() => model({ stage: "item", itemId: store.state().active!.grocery!.items[0]!.id, state: "in-cart", receiptId: old, quote: "Milk Quantity 1 Remove", product: "Milk" }), /recent browser_read/);
  assert.throws(() => store.receipt(prior, "applescript", { script: READ_SELECTED_GROCERY_NOTE_SCRIPT }, nativeNote()), /expired/);
  assert.ok(!DEMO_BLOCKS.some(b => b.mode === "travel")); assert.ok(DEMO_BLOCKS.some(b => b.mode === "grocery"));
  send({ action: "start", mode: "travel" }); assert.equal(store.state().active!.mode, "travel");
});

test("coordinator uses the existing screen lane, publishes a review notification and stops without purchase", async t => {
  const dir = mkdtempSync(join(tmpdir(), "hormes-grocery-coordinator-")); const replies: WorkReply[] = []; let lane = "";
  let coordinator: WorkCoordinator;
  const brain = { start: async () => ({ ready: true }), stop: async () => {}, cancel: async () => {}, handle: async (task: { work: { sessionId: string; mode: "grocery" }; request: string }) => {
    assert.match(task.request, /Never checkout or buy/);
    const grocery = coordinator.store.state().active!.grocery!, item = grocery.items[0]!;
    const receiptId = coordinator.receipt(task.work, "browser_read", {}, "Instacart\nhttps://www.instacart.com/store/cart\n(browser)\nYour cart\nMilk Quantity 1 Remove")!;
    coordinator.model(task.work, "grocery", { stage: "item", noteRevision: grocery.note!.revision, itemId: item.id, state: "in-cart", receiptId, quote: "Milk Quantity 1 Remove", product: "Milk" });
    coordinator.model(task.work, "grocery", { stage: "review", noteRevision: grocery.note!.revision });
    return { status: "complete", summary: "Prepared" };
  } } as unknown as Brain;
  coordinator = new WorkCoordinator({ stateDir: dir, emit: r => replies.push(r), redact: s => s, lane: () => ({ brain, runner: { setLane: value => { lane = value; }, beginTurn: () => {}, attach() {}, run: async name => {
    const text = name === "browser_read" ? "Instacart\nhttps://www.instacart.com/store/\n(Synthetic DOM receipt)\nView Cart" : "Loading store";
    if (name === "browser_read") coordinator.receipt(coordinator.store.scope()!, name, {}, text);
    return { result: { kind: "text" as const, text }, ms: 1 };
  } } }) });
  t.after(async () => { await coordinator.stop(); rmSync(dir, { recursive: true, force: true }); });
  await coordinator.command({ action: "start", mode: "grocery", requestId: randomUUID() });
  await coordinator.command({ action: "grocery.import", text: "Milk", requestId: randomUUID() });
  await coordinator.command({ action: "grocery.run", requestId: "prepare" });
  assert.equal(lane, "screen"); assert.ok(replies.some(r => r.requestId === "prepare" && r.presentation === "open" && r.speech?.includes("Nothing has been purchased")));
  assert.equal(coordinator.store.state().active!.grocery!.phase, "review");
});

test("blocked prerequisites stay actionable without a fabricated list or cart and retry preserves verified progress", t => {
  const { store, send, model } = fixture(t);
  model({ stage: "blocked", reason: "Select one unlocked grocery note in Apple Notes, then retry." });
  assert.equal(store.state().active!.grocery!.phase, "needs-list"); assert.match(store.state().active!.next, /Select one unlocked/);
  assert.equal(store.state().active!.grocery!.note, undefined);
  send({ action: "grocery.import", text: "Milk" });
  model({ stage: "blocked", reason: "Sign in to Instacart and choose a store/address, then retry." });
  assert.equal(store.state().active!.grocery!.phase, "ready"); assert.equal(store.state().active!.grocery!.review, undefined);
  send({ action: "grocery.run" }); assert.equal(store.state().active!.grocery!.blocked, undefined);
  assert.equal(store.state().active!.grocery!.items[0]!.request, "Milk");
});

test("only a current explicit grocery-cart user request routes general voice into preparation", async t => {
  const dir = mkdtempSync(join(tmpdir(), "hormes-grocery-voice-"));
  const coordinator = new WorkCoordinator({ stateDir: dir, emit: () => {}, redact: s => s, lane: () => undefined });
  t.after(async () => { await coordinator.stop(); rmSync(dir, { recursive: true, force: true }); });
  const task = (request: string, userDialogue: string) => ({ request, userDialogue, dialogue: "", delegationId: randomUUID(), confirmation: false, offsetMs: 0, signal: new AbortController().signal });
  for (const [request, user] of [
    ["Prepare my grocery cart from the selected note", "What is on my to-do list?"],
    ["What is on my to-do list?", "What is on my to-do list?"],
    ["Do not build my grocery cart", "Do not build my grocery cart"],
    ["How can you prepare my grocery cart?", "How can you prepare my grocery cart?"],
    ["Buy groceries", "Buy groceries"],
  ]) { coordinator.enrich(task(request!, user!)); assert.equal(coordinator.store.scope(), undefined); }
  const text = "Please prepare my grocery cart from the selected note";
  const routed = coordinator.enrich(task(text, text));
  assert.equal(routed.work!.mode, "grocery"); assert.equal(coordinator.store.state().active!.grocery!.phase, "needs-list");
  assert.ok(routed.workContext!.includes("selectedNoteScript"));
  assert.match(routed.workInstructions!, /never checkout/, "purchase boundary is application guidance, not already-done source data");
  const original = routed.work!.sessionId;
  coordinator.enrich(task(text, text)); assert.equal(coordinator.store.scope()!.sessionId, original, "retry reuses the current grocery session");
});

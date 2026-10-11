import { test } from "node:test";
import assert from "node:assert/strict";
import { ConfirmationState } from "@hormes/hands";
import { world } from "./world.ts";

test("owner proof binds to one fresh pending action; speech, stale proofs, expiry and replay arm nothing", () => {
  let now = 100;
  const state = new ConfirmationState(1000, () => now);
  state.requireOwner = () => true;
  const grantable = state.ask("act in password manager", "left_click", { coordinate: [1, 2] }, { app: "1Password", actionClass: "click" });
  assert.equal(state.arm(), undefined, "a routine standing grant also requires owner authentication");
  assert.equal(state.authenticatePending(grantable.id), true);
  assert.ok(state.arm());
  state.dropQuestion();
  const first = state.ask("send message", "type", { text: "one" });
  assert.equal(state.arm(), undefined);
  assert.equal(state.consume("type", { text: "one" }), false);
  state.ask("delete file", "delete", { path: "two" });
  assert.equal(state.authenticatePending(first.id), false);
  const current = state.pending!;
  assert.equal(state.authenticatePending(current.id), true); assert.ok(state.arm());
  assert.equal(state.consume("delete", { path: "different" }), false);
  assert.equal(state.consume("delete", { path: "two" }), true);
  assert.equal(state.authenticatePending(current.id), false);
  const expired = state.ask("pay", "click", { coordinate: [1, 2] }); now += 1001;
  assert.equal(state.authenticatePending(expired.id), false); assert.equal(state.arm(), undefined);
});

test("Console allow requests native authentication; denied, stale, forged and changed targets cannot approve", async (t) => {
  const w = world({}, { ownerApprovals: true }); t.after(() => w.engine.stop());
  w.engine.updateSettings({ ownerApproval: true });
  const ask = () => w.engine.desk.lane("hormes", "Hormes").ask("Send the message", "type", { text: "hello" });
  let calls = 0, approve = false, replace = false;
  const request = w.handsBg.request.bind(w.handsBg);
  w.handsBg.request = async <T>(op: string, params: Record<string, unknown> = {}): Promise<T> => {
    if (op !== "owner_approval") return request<T>(op, params);
    calls++;
    if (replace) ask();
    return { approved: approve, pendingId: params["pendingId"] } as T;
  };
  await w.engine.start(); await w.engine.ready(); await w.engine.wake("test");
  let pending = ask();
  await w.engine.sayText("yes"); assert.equal(calls, 0, "typed yes cannot manufacture native owner proof");
  await w.engine.command({ type: "thread.answer", threadId: "main", yes: true }); assert.equal(calls, 0);
  await w.engine.command({ type: "thread.answer", threadId: "main", yes: true, pendingId: pending.id }); assert.equal(calls, 1);
  assert.equal(w.engine.confirmations.consume("type", { text: "hello" }), false);
  approve = true; replace = true;
  await w.engine.command({ type: "thread.answer", threadId: "main", yes: true, pendingId: pending.id });
  assert.equal(w.engine.confirmations.requiresOwner, true);
  pending = w.engine.confirmations.pending!; replace = false;
  await w.engine.command({ type: "thread.answer", threadId: "main", yes: true, pendingId: pending.id });
  assert.equal(w.engine.confirmations.requiresOwner, false);
  assert.equal(w.engine.confirmations.consume("type", { text: "hello" }), true, "authenticated Console Allow arms the exact action through the typed path");
  assert.equal(w.engine.confirmations.consume("type", { text: "hello" }), false, "approval is spent once");
  const before = calls;
  await w.engine.command({ type: "thread.answer", threadId: "main", yes: true, pendingId: pending.id }); assert.equal(calls, before);
});

test("disabling owner approvals is itself authenticated and a brain settings callback cannot disable it", async (t) => {
  const w = world({}, { ownerApprovals: true }); t.after(() => w.engine.stop());
  w.engine.updateSettings({ ownerApproval: true });
  w.engine.updateSettings({ ownerApproval: false }); assert.equal(w.engine.currentSettings.ownerApproval, true);
  let approved = false;
  const request = w.handsBg.request.bind(w.handsBg);
  w.handsBg.request = async <T>(op: string, params: Record<string, unknown> = {}): Promise<T> => op === "owner_approval" ? { approved, pendingId: params["pendingId"] } as T : request<T>(op, params);
  await w.engine.command({ type: "set-settings", patch: { ownerApproval: false } }); assert.equal(w.engine.currentSettings.ownerApproval, true);
  approved = true;
  await w.engine.command({ type: "set-settings", patch: { ownerApproval: false } }); assert.equal(w.engine.currentSettings.ownerApproval, false);
});

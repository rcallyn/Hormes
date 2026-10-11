import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpsRequest } from "node:https";
import { PhoneBridge } from "../phone.ts";
import type { PhoneAnswer, PhoneState } from "@hormes/protocol";
import type { ActivityPush } from "../phone-push.ts";

async function call(port: number, path: string, body?: unknown, token?: string) {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req = httpsRequest({ hostname: "127.0.0.1", port, path, method: payload === undefined ? "GET" : "POST", rejectUnauthorized: false, headers: { ...(payload ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) } }, res => {
      const chunks: Buffer[] = []; res.on("data", c => chunks.push(c)); res.on("end", () => resolve({ status: res.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString()) }));
    }); req.on("error", reject); req.end(payload);
  });
}
test("phone TLS bridge requires single-use pairing and authentication, offers no daemon tools, and revokes devices", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hormes-phone-server-"));
  let now = 1000, published = 0;
  const saved: PhoneAnswer[] = [];
  const states: PhoneState[] = [];
  const work = { store: { phoneQuiz: () => null, phoneAnswer: (a: PhoneAnswer, deviceId: string) => { assert.ok(deviceId); saved.push(a); if (a.cardId === "invalid") throw new Error("Unknown question"); return { attemptId: a.attemptId, recordId: "record", cardId: a.cardId, result: "correct" as const, assisted: false }; } }, publish() { published++; } };
  const bridge = new PhoneBridge(dir, work, s => states.push(s), () => now);
  try {
    await bridge.start(0, "127.0.0.1");
    const state = await bridge.pair();
    const params = new URL(state.pairing!.url).searchParams;
    const port = Number(params.get("port")), code = params.get("code");
    assert.equal(params.get("fingerprint")!.length, 64);
    assert.equal((await call(port, "/v1/quiz")).status, 401);
    assert.equal((await call(port, "/v1/pair", { code: "invalid" })).status, 401);
    now += 120_001;
    assert.equal((await call(port, "/v1/pair", { code })).status, 401, "expired codes are refused");
    const fresh = new URL((await bridge.pair()).pairing!.url).searchParams.get("code");
    const paired = await call(port, "/v1/pair", { code: fresh, name: "Test iPhone" });
    assert.equal(paired.status, 200);
    assert.equal((await call(port, "/v1/pair", { code: fresh })).status, 401, "a consumed code cannot pair another phone");
    const token = paired.body.token;
    assert.equal((await call(port, "/v1/quiz", undefined, token)).body.quiz, null);
    assert.equal((await call(port, "/v1/tool.run", { name: "run_shell" }, token)).status, 404);
    assert.equal((await call(port, "/v1/answers", { answers: [] }, token)).status, 400);
    const submitted = await call(port, "/v1/answers", { answers: [{ attemptId: "one", quizId: "quiz", cardId: "card", choiceIndex: 0, answeredAt: 5 }, { attemptId: "two", quizId: "quiz", cardId: "invalid", choiceIndex: 0, answeredAt: 5 }] }, token);
    assert.equal(submitted.body.receipts.length, 1); assert.equal(submitted.body.rejected.length, 1); assert.equal(published, 1);
    assert.ok(!readFileSync(join(dir, "phone", "devices.json"), "utf8").includes(token), "raw tokens are never stored on the Mac");
    assert.ok(!JSON.stringify(bridge.state()).includes(token));
    bridge.revoke(paired.body.deviceId);
    assert.equal((await call(port, "/v1/quiz", undefined, token)).status, 401);
  } finally { await bridge.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("a newly prepared review automatically starts once, with private rotated push tokens and bounded retries", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hormes-phone-auto-"));
  let now = 1000, failed = false;
  let quiz = { version: 1 as const, id: `phone_${"a".repeat(64)}`, sessionId: "session", deckId: "deck", title: "Class", demo: false, issuedAt: 1000, goalVersion: 1, cards: [{ id: "one", front: "Question?", options: ["A", "B"], correctOption: 0, explanation: "Reference" }], answers: [], limitation: "Practice" };
  const delivered: ActivityPush[] = [];
  const push = { configured: true, configure() {}, async send(token: string, payload: ActivityPush) { assert.equal(token, "b".repeat(64)); if (failed) throw new Error("Delivery unavailable"); delivered.push(payload); } };
  const bridge = new PhoneBridge(dir, { store: { phoneQuiz: () => quiz, phoneAnswer() { throw new Error(); } }, publish() {} }, () => {}, () => now, push);
  try {
    await bridge.start(0, "127.0.0.1");
    const params = new URL((await bridge.pair()).pairing!.url).searchParams, port = Number(params.get("port"));
    const paired = await call(port, "/v1/pair", { code: params.get("code") });
    assert.equal((await call(port, "/v1/push-token", { token: "b".repeat(64) })).status, 401);
    assert.equal((await call(port, "/v1/push-token", { token: "bad" }, paired.body.token)).status, 400);
    assert.equal((await call(port, "/v1/push-token", { token: "b".repeat(64) }, paired.body.token)).status, 200);
    await bridge.quizReady(); assert.equal(delivered.length, 1);
    await bridge.quizReady(); assert.equal(delivered.length, 1, "work updates must not restart a review");
    assert.equal(bridge.state().devices[0]!.automaticDelivery, true);
    assert.ok(!JSON.stringify(bridge.state()).includes("b".repeat(64)));
    quiz = { ...quiz, id: `phone_${"c".repeat(64)}` }; failed = true;
    await bridge.quizReady(); assert.equal(bridge.state().error, "Delivery unavailable");
    failed = false; await bridge.quizReady(); assert.equal(delivered.length, 1, "no burst after a failed push");
    now += 60_001; await bridge.quizReady(); assert.equal(delivered.length, 2);
    quiz = { ...quiz, id: `phone_${"d".repeat(64)}` };
    await call(port, "/v1/push-token", { token: "b".repeat(64), runningQuizId: quiz.id }, paired.body.token);
    await bridge.quizReady(); assert.equal(delivered.length, 2, "a foreground activity must not get a duplicate push");
    bridge.revoke(paired.body.deviceId); quiz = { ...quiz, id: `phone_${"e".repeat(64)}` };
    await bridge.quizReady(); assert.equal(delivered.length, 2, "revoked devices stop receiving reviews");
  } finally { await bridge.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("corrupted device records preserve the original file and do not crash the daemon", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hormes-phone-corrupt-")), original = "damaged records";
  mkdirSync(join(dir, "phone")); writeFileSync(join(dir, "phone", "devices.json"), original);
  try {
    const bridge = new PhoneBridge(dir, { store: { phoneQuiz: () => null, phoneAnswer() { throw new Error(); } }, publish() {} }, () => {});
    assert.match(bridge.state().error!, /preserved/);
    await assert.rejects(bridge.pair(), /preserved/);
    assert.equal(readFileSync(join(dir, "phone", "devices.json"), "utf8"), original);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

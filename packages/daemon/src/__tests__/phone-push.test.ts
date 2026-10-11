import { test } from "node:test";
import assert from "node:assert/strict";
import { createDecipheriv, createHash, generateKeyPairSync, randomBytes, verify } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, createServer } from "node:http2";
import { inflateRawSync } from "node:zlib";
import { PhonePush, reviewPush } from "../phone-push.ts";
import type { PhoneQuiz } from "@hormes/protocol";

const quiz: PhoneQuiz = { version: 1, id: `phone_${"a".repeat(64)}`, sessionId: "class", deckId: "deck", title: "Microeconomics", demo: true, issuedAt: 1000, goalVersion: 1, cards: [
  { id: "one", front: "What is opportunity cost?", options: ["Best forgone alternative", "All money spent"], correctOption: 0, explanation: "It is the best forgone alternative." },
  { id: "two", front: "A budget constraint describes…", options: ["Affordable combinations", "All desired goods"], correctOption: 0, explanation: "Affordable choices." }
], answers: [], limitation: "Practice, not broader mastery." };

test("automatic delivery seals the offline quiz for one paired phone and obeys Apple's payload limit", () => {
  const tokenHash = createHash("sha256").update("test-pairing-token").digest("hex");
  const payload = reviewPush(quiz, tokenHash, 2000)!;
  const json = JSON.stringify(payload);
  assert.equal(payload.aps.event, "start");
  assert.equal(payload.aps.timestamp, 2);
  assert.equal(payload.aps["attributes-type"], "ReviewActivityAttributes");
  assert.ok(!json.includes("correctOption") && !json.includes("explanation"));
  assert.ok(Buffer.byteLength(json) < 4000);
  const combined = Buffer.from(payload.aps.attributes.sealedQuiz!.slice(3), "base64");
  const open = (key: Buffer) => { const cipher = createDecipheriv("aes-256-gcm", key, combined.subarray(0, 12)); cipher.setAuthTag(combined.subarray(-16)); return inflateRawSync(Buffer.concat([cipher.update(combined.subarray(12, -16)), cipher.final()])); };
  assert.deepEqual(JSON.parse(open(Buffer.from(tokenHash, "hex")).toString()), quiz);
  assert.throws(() => open(Buffer.alloc(32)), "another phone cannot decrypt the private reference key");
  const big = { ...quiz, title: "界".repeat(100), cards: [{ ...quiz.cards[0]!, front: "Long ".repeat(200), explanation: randomBytes(9000).toString("hex") }] };
  const fallback = reviewPush(big, tokenHash, 2000)!;
  assert.equal(fallback.aps.attributes.sealedQuiz, undefined);
  assert.equal(fallback.aps["content-state"].needsApp, true);
  assert.ok(Buffer.byteLength(JSON.stringify(fallback)) < 4000);
  assert.equal(reviewPush({ ...quiz, answers: quiz.cards.map(c => ({ cardId: c.id, choiceIndex: 0, result: "correct", assisted: false })) }, tokenHash, 2000), null, "completed quizzes must not reappear");
});

test("Apple Push setup validates P-256 keys, keeps secrets private, and rotates JOSE tokens within one hour", () => {
  const dir = mkdtempSync(join(tmpdir(), "hormes-apns-"));
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const key = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  let now = 1_000_000;
  try {
    const push = new PhonePush(dir, () => now);
    assert.equal(push.configured, false);
    assert.throws(() => push.configure({ teamId: "ABCDE12345", keyId: "INVALID", key, environment: "sandbox" }), /valid Team ID/);
    push.configure({ teamId: "ABCDE12345", keyId: "12345ABCDE", key, environment: "sandbox" });
    assert.equal(statSync(join(dir, "phone", "apns-key.p8")).mode & 0o777, 0o600);
    assert.ok(!readFileSync(join(dir, "phone", "apns.json"), "utf8").includes("PRIVATE KEY"));
    const jwt = push.authorization(), [header, claims, signature] = jwt.split(".");
    assert.deepEqual(JSON.parse(Buffer.from(header!, "base64url").toString()), { alg: "ES256", kid: "12345ABCDE" });
    assert.deepEqual(JSON.parse(Buffer.from(claims!, "base64url").toString()), { iss: "ABCDE12345", iat: 1000 });
    assert.ok(verify("sha256", Buffer.from(`${header}.${claims}`), { key: keys.publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature!, "base64url")));
    now += 21 * 60_000; assert.equal(push.authorization(), jwt);
    now += 30 * 60_000; assert.notEqual(push.authorization(), jwt);
    assert.equal(new PhonePush(dir).configured, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("APNs delivery uses the Live Activity topic and HTTP/2 headers, with sanitized failures", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hormes-apns-wire-")), server = createServer();
  let status = 200, requests = 0;
  server.on("stream", (stream, headers) => {
    requests++;
    assert.equal(headers[":method"], "POST"); assert.equal(headers[":path"], `/3/device/${"b".repeat(64)}`);
    assert.equal(headers["apns-topic"], "com.hormes.phone.push-type.liveactivity");
    assert.equal(headers["apns-push-type"], "liveactivity"); assert.equal(headers["apns-priority"], "10");
    assert.match(String(headers.authorization), /^bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    const chunks: Buffer[] = []; stream.on("data", chunk => chunks.push(Buffer.from(chunk)));
    stream.on("end", () => {
      const payload = JSON.parse(Buffer.concat(chunks).toString()); assert.equal(payload.aps.event, "start");
      assert.ok(payload.aps.attributes.sealedQuiz); stream.respond({ ":status": status }); stream.end(JSON.stringify({ reason: "SensitiveAppleResponse", token: "b".repeat(64) }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  try {
    const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const push = new PhonePush(dir, () => 1000, url => { assert.equal(url, "https://api.sandbox.push.apple.com"); return connect(`http://127.0.0.1:${port}`); });
    push.configure({ teamId: "ABCDE12345", keyId: "12345ABCDE", key: keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString(), environment: "sandbox" });
    const payload = reviewPush(quiz, "c".repeat(64), 1000)!;
    await push.send("b".repeat(64), payload);
    assert.equal(requests, 1);
    status = 403;
    await assert.rejects(push.send("b".repeat(64), payload), error => error instanceof Error && error.message.includes("403") && !error.message.includes("SensitiveAppleResponse") && !error.message.includes("b".repeat(64)));
    await assert.rejects(push.send("../bad", payload), /invalid/);
    assert.equal(requests, 2);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); rmSync(dir, { recursive: true, force: true }); }
});

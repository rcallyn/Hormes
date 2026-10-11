import { connect, type ClientHttp2Session } from "node:http2";
import { createCipheriv, createPrivateKey, randomBytes, sign, type KeyObject } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import type { PhoneQuiz } from "@hormes/protocol";

export interface PhonePushConfiguration { teamId: string; keyId: string; key: string; environment: "sandbox" | "production" }
interface Credentials { teamId: string; keyId: string; environment: "sandbox" | "production"; key: KeyObject }
export interface ActivityPush {
  aps: { timestamp: number; event: "start"; "attributes-type": string; attributes: { quizId: string; sealedQuiz?: string }; "content-state": Record<string, unknown>; alert: { title: string; body: string } };
}

/** The review key travels encrypted to the paired phone, including when the Mac is off its Wi-Fi. */
export function reviewPush(quiz: PhoneQuiz, tokenHash: string, now: number): ActivityPush | null {
  const card = quiz.cards.find(c => !quiz.answers.some(a => a.cardId === c.id));
  if (!card) return null;
  const fits = card.front.length <= 150 && card.options.length <= 4 && card.options.every(o => o.length <= 42);
  const state = { cardId: card.id, title: quiz.title.slice(0, 60), question: card.front.slice(0, 180), options: fits ? card.options : [], index: quiz.cards.indexOf(card) + 1, total: quiz.cards.length, completed: quiz.answers.length, answered: false, correct: false, feedback: "", demo: quiz.demo, needsApp: !fits };
  const payload: ActivityPush = { aps: { timestamp: Math.floor(now / 1000), event: "start", "attributes-type": "ReviewActivityAttributes", attributes: { quizId: quiz.id }, "content-state": state, alert: { title: "Your class review is ready", body: quiz.title.slice(0, 80) } } };
  // CryptoKit's combined representation is nonce + ciphertext + authentication tag.
  const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", Buffer.from(tokenHash, "hex"), nonce);
  const plain = Buffer.from(JSON.stringify(quiz)), compressed = deflateRawSync(plain);
  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
  if (plain.length <= 128_000) payload.aps.attributes.sealedQuiz = `v1.${Buffer.concat([nonce, encrypted, cipher.getAuthTag()]).toString("base64")}`;
  if (Buffer.byteLength(JSON.stringify(payload)) > 4000) delete payload.aps.attributes.sealedQuiz;
  if (Buffer.byteLength(JSON.stringify(payload)) > 4000) {
    payload.aps["content-state"] = { ...state, title: "Class review", question: "Your class review is ready", options: [], needsApp: true };
  }
  return payload;
}

export class PhonePush {
  private credentials: Credentials | undefined;
  private jwt: { value: string; at: number } | undefined;
  private readonly dir: string;
  constructor(stateDir: string, private readonly now = Date.now, private readonly transport: (url: string) => ClientHttp2Session = connect) {
    this.dir = join(stateDir, "phone");
    try {
      if (existsSync(join(this.dir, "apns.json"))) {
        const metadata = JSON.parse(readFileSync(join(this.dir, "apns.json"), "utf8"));
        this.credentials = this.validate({ ...metadata, key: readFileSync(join(this.dir, "apns-key.p8"), "utf8") });
      }
    } catch { /* Pairing and offline reviews remain usable if push setup is incomplete. */ }
  }
  get configured(): boolean { return !!this.credentials; }
  private validate(input: PhonePushConfiguration): Credentials {
    try {
      if (!input || typeof input.teamId !== "string" || typeof input.keyId !== "string" || !/^[A-Z0-9]{10}$/.test(input.teamId) || !/^[A-Z0-9]{10}$/.test(input.keyId) || !["sandbox", "production"].includes(input.environment) || typeof input.key !== "string" || input.key.length > 4096) throw new Error();
      const key = createPrivateKey(input.key);
      if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error();
      return { teamId: input.teamId, keyId: input.keyId, environment: input.environment, key };
    } catch { throw new Error("Choose an Apple Push .p8 key with a valid Team ID and Key ID."); }
  }
  configure(input: PhonePushConfiguration): void {
    const credentials = this.validate(input);
    mkdirSync(this.dir, { recursive: true, mode: 0o700 }); chmodSync(this.dir, 0o700);
    for (const [name, value] of [["apns-key.p8", input.key], ["apns.json", JSON.stringify({ teamId: input.teamId, keyId: input.keyId, environment: input.environment })]]) {
      const file = join(this.dir, name!); writeFileSync(`${file}.tmp`, value!, { mode: 0o600 }); chmodSync(`${file}.tmp`, 0o600); renameSync(`${file}.tmp`, file);
    }
    this.credentials = credentials; this.jwt = undefined;
  }
  /** ES256 uses a 64-byte JOSE signature; the private .p8 key is never sent to Apple or iPhone. */
  authorization(): string {
    const c = this.credentials;
    if (!c) throw new Error("Automatic delivery needs Apple Push setup in Mac Settings.");
    const now = this.now();
    if (!this.jwt || now - this.jwt.at >= 50 * 60_000) {
      const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: c.keyId })).toString("base64url");
      const claims = Buffer.from(JSON.stringify({ iss: c.teamId, iat: Math.floor(now / 1000) })).toString("base64url");
      const input = `${header}.${claims}`;
      this.jwt = { value: `${input}.${sign("sha256", Buffer.from(input), { key: c.key, dsaEncoding: "ieee-p1363" }).toString("base64url")}`, at: now };
    }
    return this.jwt.value;
  }
  async send(token: string, payload: ActivityPush): Promise<void> {
    if (!/^[a-f0-9]{64,512}$/.test(token) || token.length % 2) throw new Error("The iPhone delivery token is invalid. Reconnect your phone.");
    const jwt = this.authorization(), c = this.credentials!;
    const client = this.transport(`https://${c.environment === "sandbox" ? "api.sandbox" : "api"}.push.apple.com`);
    await new Promise<void>((resolve, reject) => {
      let status = 0, settled = false;
      const finish = (error?: Error) => { if (settled) return; settled = true; clearTimeout(timer); client.destroy(); error ? reject(error) : resolve(); };
      const timer = setTimeout(() => finish(new Error("Apple Push did not respond. Delivery will retry on the next connection.")), 8000);
      client.on("error", () => finish(new Error("Apple Push could not connect. Check your Mac’s internet connection.")));
      const req = client.request({ ":method": "POST", ":path": `/3/device/${token}`, authorization: `bearer ${jwt}`, "apns-topic": "com.hormes.phone.push-type.liveactivity", "apns-push-type": "liveactivity", "apns-priority": "10", "apns-expiration": String(Math.floor(this.now() / 1000) + 1800) });
      req.on("response", headers => { status = Number(headers[":status"]); });
      req.on("data", () => {}); // Never echo Apple's response or device token into logs.
      req.on("error", () => finish(new Error("Apple Push could not deliver this review. Check push setup in Mac Settings.")));
      req.on("end", () => finish(status === 200 ? undefined : new Error(`Apple Push refused delivery (${status}). Check the key, environment and iPhone signing setup.`)));
      req.end(JSON.stringify(payload));
    });
  }
}

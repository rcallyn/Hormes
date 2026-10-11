import { createServer, type Server } from "node:https";
import { createHash, randomBytes, randomUUID, timingSafeEqual, X509Certificate } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { PhoneAnswer, PhoneAnswerReceipt, PhoneDevice, PhoneQuiz, PhoneState } from "@hormes/protocol";
import { PhonePush, reviewPush, type PhonePushConfiguration } from "./phone-push.ts";

export interface PhoneWork {
  store: { phoneQuiz(exportId?: string): PhoneQuiz | null; phoneAnswer(answer: PhoneAnswer, deviceId: string): PhoneAnswerReceipt };
  publish(): void;
  setPhoneReviewEnabled?(check: () => boolean): void;
}
type Device = PhoneDevice & { tokenHash: string; pushToken?: string; deliveredQuizId?: string };
const hash = (s: string): string => createHash("sha256").update(s).digest("hex");
const same = (a: string, b: string): boolean => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const PHONE_PORT = 47831;

/** Opt-in TLS quiz listener. The Unix daemon protocol stays private. */
export class PhoneBridge {
  private server: Server | undefined;
  private starting: Promise<void> | undefined;
  private devices: Device[];
  private pairing: { code: string; expiresAt: number; url: string } | undefined;
  private expiry: NodeJS.Timeout | undefined;
  private fingerprint = "";
  private port = PHONE_PORT;
  private readonly dir: string;
  private readonly rates = new Map<string, { at: number; count: number }>();
  private readonly push: Pick<PhonePush, "configured" | "configure" | "send">;
  private readonly delivering = new Set<string>();
  private readonly retryAt = new Map<string, number>();
  private error: string | undefined;
  private devicesReadable = true;
  constructor(stateDir: string, private readonly work: PhoneWork, private readonly changed: (state: PhoneState) => void, private readonly now = Date.now, push?: Pick<PhonePush, "configured" | "configure" | "send">) {
    this.dir = join(stateDir, "phone");
    this.push = push ?? new PhonePush(stateDir, now);
    this.devices = [];
    try {
      if (existsSync(join(this.dir, "devices.json"))) {
        const devices: unknown = JSON.parse(readFileSync(join(this.dir, "devices.json"), "utf8"));
        if (!Array.isArray(devices) || devices.length > 8 || devices.some(d => typeof d?.id !== "string" || typeof d.name !== "string" || !/^[a-f0-9]{64}$/.test(d.tokenHash) || !Number.isFinite(d.pairedAt) || !Number.isFinite(d.lastSeenAt) || d.pushToken !== undefined && !/^[a-f0-9]{64,512}$/.test(d.pushToken))) throw new Error();
        this.devices = devices;
      }
    } catch { this.devicesReadable = false; this.error = "Saved iPhone connections could not be read. The original file has been preserved."; }
  }
  state(): PhoneState {
    const pairing = this.pairing && this.pairing.expiresAt > this.now() ? { url: this.pairing.url, expiresAt: this.pairing.expiresAt } : undefined;
    return { enabled: !!this.server, devices: this.devices.map(d => ({ id: d.id, name: d.name, pairedAt: d.pairedAt, lastSeenAt: d.lastSeenAt, automaticDelivery: this.push.configured && !!d.pushToken })), pushConfigured: this.push.configured, ...(this.error ? { error: this.error } : {}), ...(pairing ? { pairing } : {}) };
  }
  async restore(): Promise<void> { if (this.devicesReadable && existsSync(join(this.dir, "enabled"))) { await this.start(); await this.quizReady(); } }
  async pair(): Promise<PhoneState> {
    if (!this.devicesReadable) throw new Error(this.error);
    await this.start();
    const candidates = Object.entries(networkInterfaces()).flatMap(([name, entries]) => (entries ?? []).filter(e => !e.internal && e.family === "IPv4").map(e => ({ name, address: e.address })));
    const host = candidates.find(e => e.name === "en0")?.address ?? candidates.find(e => /^en/.test(e.name))?.address;
    if (!host) throw new Error("Connect the Mac and iPhone to the same Wi-Fi, then try pairing again.");
    const code = randomBytes(24).toString("base64url");
    const expiresAt = this.now() + 120_000;
    const params = new URLSearchParams({ host, port: String(this.port), code, fingerprint: this.fingerprint });
    this.pairing = { code, expiresAt, url: `hormes://pair?${params}` };
    if (this.expiry) clearTimeout(this.expiry);
    this.expiry = setTimeout(() => { this.pairing = undefined; this.changed(this.state()); }, 120_000);
    this.expiry.unref();
    this.changed(this.state());
    return this.state();
  }
  cancelPairing(): void { this.pairing = undefined; if (this.expiry) clearTimeout(this.expiry); this.changed(this.state()); }
  revoke(id: string): void {
    if (!this.devicesReadable) throw new Error(this.error);
    this.devices = this.devices.filter(d => d.id !== id); this.saveDevices(); this.changed(this.state());
  }
  configurePush(configuration: PhonePushConfiguration): void {
    this.push.configure(configuration); this.error = undefined; this.retryAt.clear(); this.changed(this.state()); void this.quizReady();
  }
  /** A saved quiz appears on the paired phone without a foreground app trigger. */
  async quizReady(): Promise<void> {
    if (!this.devicesReadable || !this.devices.length || !this.push.configured) return;
    const quiz = this.work.store.phoneQuiz();
    if (!quiz) return;
    await Promise.all(this.devices.map(async device => {
      if (!device.pushToken || device.deliveredQuizId === quiz.id || this.delivering.has(device.id) || (this.retryAt.get(device.id) ?? 0) > this.now()) return;
      const payload = reviewPush(quiz, device.tokenHash, this.now());
      if (!payload) return;
      this.delivering.add(device.id);
      try {
        await this.push.send(device.pushToken, payload);
        if (!this.devices.includes(device)) return;
        device.deliveredQuizId = quiz.id; this.saveDevices(); this.error = undefined;
      } catch (error) { this.retryAt.set(device.id, this.now() + 60_000); this.error = (error as Error).message; }
      finally { this.delivering.delete(device.id); this.changed(this.state()); }
    }));
  }
  private saveDevices(): void {
    const temp = join(this.dir, "devices.json.tmp");
    writeFileSync(temp, JSON.stringify(this.devices), { mode: 0o600 });
    chmodSync(temp, 0o600); renameSync(temp, join(this.dir, "devices.json"));
  }
  /** A stable certificate pins the Mac identity across relaunches; tokens are stored as hashes. */
  async start(port = PHONE_PORT, host = "0.0.0.0"): Promise<void> {
    if (this.server) return;
    if (this.starting) return this.starting;
    this.starting = this.listen(port, host);
    try { await this.starting; } finally { this.starting = undefined; }
  }
  private async listen(port: number, host: string): Promise<void> {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 }); chmodSync(this.dir, 0o700);
    const keyPath = join(this.dir, "key.pem"), certPath = join(this.dir, "cert.pem");
    if (!existsSync(keyPath) || !existsSync(certPath)) {
      await promisify(execFile)("/usr/bin/openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath, "-out", certPath, "-days", "3650", "-subj", "/CN=Hormes Phone Bridge"], { env: { PATH: "/usr/bin:/bin" }, timeout: 15_000 });
      chmodSync(keyPath, 0o600);
    }
    const cert = readFileSync(certPath), key = readFileSync(keyPath);
    this.fingerprint = createHash("sha256").update(new X509Certificate(cert).raw).digest("hex");
    const server = createServer({ key, cert, minVersion: "TLSv1.2" }, (req, res) => { void this.request(req, res); });
    server.requestTimeout = 15_000; server.headersTimeout = 10_000; server.keepAliveTimeout = 1000;
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, host, () => { server.removeListener("error", reject); resolve(); }); });
    server.on("error", () => this.changed({ ...this.state(), error: "The iPhone connection stopped. Try pairing again." }));
    this.server = server;
    const address = server.address(); this.port = typeof address === "object" && address ? address.port : port;
    writeFileSync(join(this.dir, "enabled"), "1", { mode: 0o600 });
  }
  private reply(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }); res.end(JSON.stringify(body));
  }
  private async body(req: IncomingMessage): Promise<unknown> {
    if (!req.headers["content-type"]?.startsWith("application/json")) throw new Error("Use a JSON request.");
    let bytes = 0; const chunks: Buffer[] = [];
    for await (const chunk of req) { bytes += chunk.length; if (bytes > 16_384) throw new Error("Request too large."); chunks.push(Buffer.from(chunk)); }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  }
  private async request(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const ip = req.socket.remoteAddress ?? "unknown", now = this.now();
      if (this.rates.size > 128) { for (const [k, v] of this.rates) if (now - v.at > 60_000) this.rates.delete(k); }
      if (!this.rates.has(ip) && this.rates.size >= 128) return this.reply(res, 429, { error: "Try again shortly." });
      const rate = this.rates.get(ip);
      if (rate && now - rate.at < 60_000) { if (++rate.count > 120) return this.reply(res, 429, { error: "Try again shortly." }); }
      else this.rates.set(ip, { at: now, count: 1 });
      if (req.method === "POST" && req.url === "/v1/pair") {
        const input = await this.body(req) as { code?: unknown; name?: unknown };
        if (!input || typeof input.code !== "string" || !this.pairing || now >= this.pairing.expiresAt || !same(input.code, this.pairing.code)) return this.reply(res, 401, { error: "Pairing expired. Generate a new QR code on the Mac." });
        if (this.devices.length >= 8) return this.reply(res, 409, { error: "Remove an old phone in Mac Settings before pairing." });
        const token = randomBytes(32).toString("base64url");
        const device: Device = { id: randomUUID(), name: typeof input.name === "string" ? input.name.trim().slice(0, 80) || "iPhone" : "iPhone", pairedAt: now, lastSeenAt: now, tokenHash: hash(token) };
        this.devices.push(device); this.saveDevices(); this.cancelPairing();
        return this.reply(res, 200, { deviceId: device.id, token });
      }
      const authorization = req.headers.authorization;
      const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
      const device = token.length >= 32 && token.length <= 128 ? this.devices.find(d => same(d.tokenHash, hash(token))) : undefined;
      if (!device) return this.reply(res, 401, { error: "Pair this iPhone from Mac Settings." });
      if (now - device.lastSeenAt > 30_000) { device.lastSeenAt = now; this.saveDevices(); this.changed(this.state()); }
      const url = new URL(req.url ?? "/", "https://phone.invalid");
      if (req.method === "GET" && url.pathname === "/v1/quiz") {
        const quizId = url.searchParams.get("id");
        if (quizId && !/^phone_[a-f0-9]{64}$/.test(quizId)) return this.reply(res, 400, { error: "Invalid review ID." });
        return this.reply(res, 200, { quiz: this.work.store.phoneQuiz(quizId ?? undefined) });
      }
      if (req.method === "POST" && req.url === "/v1/push-token") {
        const input = await this.body(req) as { token?: unknown; runningQuizId?: unknown };
        if (!input || typeof input.token !== "string" || !/^[a-f0-9]{64,512}$/.test(input.token) || input.token.length % 2) return this.reply(res, 400, { error: "Invalid iPhone delivery token." });
        device.pushToken = input.token;
        if (typeof input.runningQuizId === "string" && input.runningQuizId === this.work.store.phoneQuiz()?.id) device.deliveredQuizId = input.runningQuizId;
        this.saveDevices(); this.changed(this.state()); void this.quizReady();
        return this.reply(res, 200, { configured: this.push.configured });
      }
      if (req.method === "POST" && req.url === "/v1/answers") {
        const input = await this.body(req) as { answers?: unknown };
        if (!input || !Array.isArray(input.answers) || !input.answers.length || input.answers.length > 20) return this.reply(res, 400, { error: "Submit 1–20 saved answers." });
        // Every receipt is durable before acknowledging it. Partial batch failures are explicit.
        const receipts: PhoneAnswerReceipt[] = [], rejected: { attemptId: string; error: string }[] = [];
        for (const answer of input.answers) {
          try { receipts.push(this.work.store.phoneAnswer(answer as PhoneAnswer, device.id)); }
          catch (error) { rejected.push({ attemptId: typeof answer?.attemptId === "string" ? answer.attemptId : "", error: (error as Error).message }); }
        }
        this.work.publish();
        return this.reply(res, 200, { receipts, rejected });
      }
      this.reply(res, 404, { error: "Unknown phone route." });
    } catch { this.reply(res, 400, { error: "The phone request could not be read. Try again." }); }
  }
  async close(): Promise<void> {
    this.cancelPairing(); await this.starting?.catch(() => {});
    const server = this.server; this.server = undefined;
    if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  }
}

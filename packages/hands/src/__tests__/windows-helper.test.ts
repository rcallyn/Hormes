// The Windows hormes-hands helper (apps/windows/Hands) over its real stdio protocol.
// Skipped off win32 and when the helper is not built (`pnpm build:hands`). Never clicks or types into an app,
// and never sends owner_approval (it would put up a Windows Hello prompt).
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const bin = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "build", "hands", "hormes-hands.exe");
const skip = process.platform !== "win32" ? "Windows only" : !existsSync(bin) ? "helper not built (pnpm build:hands)" : false;

interface Reply {
  id: string | null;
  ok: boolean;
  result?: Record<string, any>;
  error?: { code: string; message: string };
}

describe("windows hands helper", { skip }, () => {
  let child: ChildProcessWithoutNullStreams;
  let buf = "";
  const waiting = new Map<string, (r: Reply) => void>();
  const anonymous: Reply[] = [];
  let seq = 0;

  before(() => {
    child = spawn(bin, [], { stdio: ["pipe", "pipe", "pipe"] });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buf += chunk;
      let at: number;
      while ((at = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, at);
        buf = buf.slice(at + 1);
        const r = JSON.parse(line) as Reply;
        const w = r.id === null ? undefined : waiting.get(r.id);
        if (w) w(r);
        else anonymous.push(r);
      }
    });
  });

  after(async () => {
    const exited = new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)));
    child.stdin.end(); // EOF: a clean exit
    assert.equal(await exited, 0);
  });

  function call(op: string, params: Record<string, unknown> = {}): Promise<Reply> {
    const id = `t${++seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${op} did not answer`)), 15_000);
      waiting.set(id, (r) => {
        clearTimeout(timer);
        waiting.delete(id);
        resolve(r);
      });
      child.stdin.write(`${JSON.stringify({ id, op, ...params })}\n`);
    });
  }

  async function ok(op: string, params: Record<string, unknown> = {}): Promise<Record<string, any>> {
    const r = await call(op, params);
    assert.equal(r.ok, true, `${op}: ${r.error?.code} ${r.error?.message}`);
    return r.result ?? {};
  }

  test("hello", async () => {
    const r = await ok("hello");
    assert.equal(r.version, "2.0.0");
    assert.equal(r.pid, child.pid);
    assert.equal(r.permissions.accessibility, true);
    assert.equal(r.permissions.screenRecording, true);
  });

  test("displays: a main display at the origin, scale 1", async () => {
    const { displays } = await ok("displays");
    assert.ok(displays.length >= 1);
    const main = displays.find((d: any) => d.main);
    assert.ok(main, "one display is main");
    assert.equal(main.x, 0);
    assert.equal(main.y, 0);
    for (const d of displays) {
      assert.equal(d.scale, 1);
      assert.ok(d.w > 0 && d.h > 0);
    }
  });

  test("cursor and move round-trip", async () => {
    const start = await ok("cursor");
    try {
      const to = { x: start.x === 100 ? 120 : 100, y: 100 };
      await ok("move", { ...to, ownDriver: true });
      const now = await ok("cursor");
      assert.deepEqual({ x: now.x, y: now.y }, to);
    } finally {
      await call("move", { x: start.x, y: start.y, ownDriver: true });
    }
  });

  test("frontmost", async () => {
    const r = await call("frontmost");
    if (!r.ok) return assert.equal(r.error?.code, "not_found"); // nothing is in front (a locked or empty desktop)
    assert.equal(typeof r.result?.app, "string");
    assert.ok(r.result!.pid > 0);
  });

  test("windows", async () => {
    const { windows } = await ok("windows");
    assert.ok(Array.isArray(windows));
    for (const w of windows) {
      assert.equal(typeof w.title, "string");
      assert.ok(w.pid > 0);
      assert.ok(w.w > 0 && w.h > 0);
    }
  });

  test("screenshot: a valid PNG within the limits", async () => {
    const r = await ok("screenshot", { display: "main", maxLongEdge: 800, maxPixels: 400_000, showCursor: false });
    const png = Buffer.from(r.pngBase64, "base64");
    assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.equal(png.readUInt32BE(16), r.width);
    assert.equal(png.readUInt32BE(20), r.height);
    assert.ok(Math.max(r.width, r.height) <= 800);
    assert.ok(r.width * r.height <= 400_000);
    assert.ok(Math.abs(r.scale - r.width / r.points.w) < 1e-9);
    assert.ok(r.frameId >= 1);
    assert.equal(typeof r.config, "string");
  });

  test("zoom: a region of the main display", async () => {
    const r = await ok("zoom", { x: 0, y: 0, w: 200, h: 100, maxLongEdge: 100 });
    const png = Buffer.from(r.pngBase64, "base64");
    assert.equal(png.readUInt32BE(16), r.width);
    assert.ok(r.width <= 100 && r.height <= 100);
    assert.deepEqual(r.points, { x: 0, y: 0, w: 200, h: 100 });
  });

  test("ax_tree summary of the foreground window, then element_at", async () => {
    const r = await call("ax_tree", { summary: true, maxMs: 2000 });
    if (r.ok) {
      assert.equal(typeof r.result?.app, "string");
      assert.ok(r.result!.count >= 1);
      assert.equal(r.result!.nodes, undefined);
      assert.equal(typeof r.result!.truncated, "boolean");
    } else assert.equal(r.error?.code, "not_found");
    const { displays } = await ok("displays");
    const main = displays.find((d: any) => d.main);
    const e = await call("element_at", { x: main.w / 2, y: main.h / 2 });
    if (e.ok) assert.equal(typeof e.result?.role, "string");
    else assert.equal(e.error?.code, "not_found");
  });

  test("user_idle", async () => {
    const r = await ok("user_idle");
    for (const k of ["keyMs", "clickMs", "scrollMs", "moveMs", "foreignMs"]) {
      assert.equal(typeof r[k], "number", k);
      assert.ok(r[k] >= 0, k);
    }
  });

  test("wait, permissions and unsupported ops", async () => {
    await ok("wait", { ms: 5 });
    assert.deepEqual(await ok("permissions"), {});
    const b = await call("browser_url");
    assert.equal(b.ok, false);
    assert.equal(b.error?.code, "bad_request");
    assert.match(b.error!.message, /not supported on Windows/);
  });

  test("malformed requests answer bad_request and the helper carries on", async () => {
    anonymous.length = 0;
    child.stdin.write("this is not json\n");
    const unknown = await call("no_such_op");
    assert.equal(unknown.ok, false);
    assert.equal(unknown.error?.code, "bad_request");
    const missing = await call("move", { x: 1 });
    assert.equal(missing.error?.code, "bad_request");
    const wrongType = await call("click", { x: "a", y: 1 });
    assert.equal(wrongType.error?.code, "bad_request");
    // Combos are parsed before anything is posted.
    assert.equal((await call("key", { combo: "bogus+x" })).error?.code, "bad_request");
    assert.equal((await call("key", { combo: "ctrl+nosuchkey" })).error?.code, "bad_request");
    assert.equal(anonymous.length, 1);
    assert.equal(anonymous[0]!.id, null);
    assert.equal(anonymous[0]!.error?.code, "bad_request");
    await ok("hello");
  });

  test("--permissions prints the four grants and exits", async () => {
    const out = await new Promise<string>((resolve, reject) => {
      const p = spawn(bin, ["--permissions"]);
      let s = "";
      p.stdout.on("data", (d) => (s += d));
      p.on("error", reject);
      p.on("exit", () => resolve(s));
    });
    assert.deepEqual(JSON.parse(out), { accessibility: true, screenRecording: true, inputMonitoring: true, fullDiskAccess: true });
  });
});

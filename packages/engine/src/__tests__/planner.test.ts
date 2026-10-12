import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eventsBetween, expandRecurring, isPlannerCommand, type PlannerEvent, type PlannerTodo } from "@hormes/protocol";
import { LocalPlannerStore, Planner, envValue, findStits, type PlannerStore } from "../planner/index.ts";

function dir(): string {
  return mkdtempSync(join(tmpdir(), "hormes-planner-"));
}

/** stits, in memory: what the real store does to its tables, without a database. */
function fakeStits(seed: { todos?: PlannerTodo[]; events?: PlannerEvent[] } = {}): PlannerStore & { todos: PlannerTodo[]; events: PlannerEvent[]; reachable: boolean } {
  const local = new LocalPlannerStore(join(dir(), "fake-stits.json"));
  const store = {
    kind: "stits" as const,
    reachable: true,
    get todos() { return (local as unknown as { data: { todos: PlannerTodo[] } }).data.todos; },
    get events() { return (local as unknown as { data: { events: PlannerEvent[] } }).data.events; },
    async list() { if (!store.reachable) throw new Error("connect ETIMEDOUT"); return local.list(); },
    addTodo: local.addTodo.bind(local), updateTodo: local.updateTodo.bind(local), deleteTodo: local.deleteTodo.bind(local),
    addEvent: local.addEvent.bind(local), updateEvent: local.updateEvent.bind(local), deleteEvent: local.deleteEvent.bind(local),
    close: async () => undefined,
  };
  for (const t of seed.todos ?? []) void local.addTodo(t, t.id);
  for (const e of seed.events ?? []) void local.addEvent(e, e.id);
  return store;
}

const NOW = new Date("2026-10-12T09:00:00").getTime();

test("local planner: add, tick, untick, edit, delete; a deleted todo takes its scheduled events with it", async () => {
  const d = dir();
  const p = new Planner({ stateDir: d, now: () => NOW, stits: null });
  await p.start();
  const added = await p.run({ op: "todo.add", todo: { title: "  Call Tazeem ", dueDate: "2026-10-12", priority: "high", category: "career" } });
  assert.ok(added.ok && added.id);
  const id = added.id!;
  assert.equal(p.state().todos[0]?.title, "Call Tazeem");
  await p.run({ op: "todo.update", id, patch: { done: true } });
  assert.equal(p.state().todos[0]?.completedAt, new Date(NOW).toISOString(), "ticking stamps completedAt");
  await p.run({ op: "todo.update", id, patch: { done: false, priority: null } });
  assert.equal(p.state().todos[0]?.completedAt, undefined, "unticking clears it");
  assert.equal(p.state().todos[0]?.priority, undefined, "null clears a field");
  await p.run({ op: "event.add", event: { title: "Call Tazeem", date: "2026-10-12", time: "17:00", todoId: id } });
  assert.equal(p.state().events.length, 1);
  await p.run({ op: "todo.delete", id });
  assert.deepEqual([p.state().todos.length, p.state().events.length], [0, 0]);
  // Survives a restart: it is a file.
  await p.run({ op: "todo.add", todo: { title: "Groceries" } });
  const again = new Planner({ stateDir: d, now: () => NOW, stits: null });
  await again.start();
  assert.equal(again.state().todos[0]?.title, "Groceries");
  assert.equal(again.state().source, "local");
  rmSync(d, { recursive: true, force: true });
});

test("a bad command is refused with the reason, and nothing changes", async () => {
  const p = new Planner({ stateDir: dir(), now: () => NOW, stits: null });
  await p.start();
  assert.match(await p.tool("add_event", { title: "Lunch", date: "2026-13-40" }), /date must be YYYY-MM-DD/);
  assert.match(await p.tool("add_todo", { title: "x", category: "chores" }), /category must be one of/);
  assert.match(await p.tool("complete_todo", { id: "nope" }), /no todo nope; list first/);
  assert.equal(isPlannerCommand({ op: "todo.add", todo: { title: "" } }), false);
  assert.equal(isPlannerCommand({ op: "event.add", event: { title: "x", date: "2026-10-12", time: "25:00" } }), false);
  assert.equal(isPlannerCommand({ op: "sync.set", enabled: true }), true);
  assert.equal(p.state().todos.length, 0);
});

test("switching to stits copies this PC's items once, then reads and writes go to stits; switching back shows the PC's own", async () => {
  const d = dir();
  const stits = fakeStits({ todos: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", title: "From stits", done: false }] });
  const mk = (): Planner => new Planner({ stateDir: d, now: () => NOW, stits: { url: "postgres://x", origin: "test" }, makeStits: () => stits });
  const p = mk();
  await p.start();
  await p.run({ op: "todo.add", todo: { title: "Made on the PC" } });
  assert.equal(p.state().source, "local");
  assert.ok((await p.run({ op: "sync.set", enabled: true })).ok);
  assert.equal(p.state().source, "stits");
  assert.deepEqual(p.state().todos.map((t) => t.title).sort(), ["From stits", "Made on the PC"]);
  // Writes land in stits.
  await p.run({ op: "todo.add", todo: { title: "Made while synced" } });
  assert.ok(stits.todos.some((t) => t.title === "Made while synced"));
  // Off: the PC's own list, without what was made in stits.
  await p.run({ op: "sync.set", enabled: false });
  assert.deepEqual(p.state().todos.map((t) => t.title), ["Made on the PC"]);
  // On again: nothing copied twice.
  await p.run({ op: "sync.set", enabled: true });
  assert.equal(stits.todos.filter((t) => t.title === "Made on the PC").length, 1);
  // The choice persists.
  const after = mk();
  await after.start();
  assert.equal(after.state().stitsSync, true);
  await after.stop();
  await p.stop();
});

test("an unreachable stits is not switched to, and a synced planner that loses it says so and keeps what it had", async () => {
  const stits = fakeStits();
  stits.reachable = false;
  const p = new Planner({ stateDir: dir(), now: () => NOW, stits: { url: "postgres://x", origin: "test" }, makeStits: () => stits });
  await p.start();
  const r = await p.run({ op: "sync.set", enabled: true });
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /could not reach stits/);
  assert.equal(p.state().source, "local");
  stits.reachable = true;
  await p.run({ op: "todo.add", todo: { title: "Keep me" } });
  await p.run({ op: "sync.set", enabled: true });
  stits.reachable = false;
  await p.run({ op: "refresh" });
  assert.match(p.state().error ?? "", /stits: connect ETIMEDOUT/);
  assert.deepEqual(p.state().todos.map((t) => t.title), ["Keep me"], "the last good read stays on screen");
  await p.stop();
});

test("without a stits, sync cannot be switched on and says where it looks", async () => {
  const p = new Planner({ stateDir: dir(), now: () => NOW, stits: null });
  await p.start();
  const r = await p.run({ op: "sync.set", enabled: true });
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /STITS_DATABASE_URL/);
  assert.equal(p.state().stitsAvailable, false);
});

test("stits is found from STITS_DATABASE_URL or the checkout's .env.local, and the URL is never in the state", async () => {
  assert.equal(envValue('X=1\nexport DATABASE_URL="postgres://u:p@h:6543/db"\n', "DATABASE_URL"), "postgres://u:p@h:6543/db");
  assert.deepEqual(findStits({ STITS_DATABASE_URL: "postgres://a" }, "/nowhere"), { url: "postgres://a", origin: "STITS_DATABASE_URL" });
  assert.equal(findStits({}, join(dir(), "no-home")), undefined);
  const p = new Planner({ stateDir: dir(), now: () => NOW, stits: { url: "postgres://secret@host/db", origin: "C:/x/.env.local" }, makeStits: () => fakeStits() });
  await p.start();
  assert.doesNotMatch(JSON.stringify(p.state()), /secret/);
  assert.equal(p.state().stitsOrigin, "C:/x/.env.local");
});

test("recurring events expand like stits: weekly classes, an exception, the until date", () => {
  const cls: PlannerEvent = { id: "c", title: "ECON 101", date: "2026-09-07", time: "10:00", endTime: "11:15", category: "school", recurrence: { freq: "weekly", interval: 1, until: "2026-12-07", exceptions: ["2026-10-12"] } };
  const days = expandRecurring([cls], "2026-10-01", "2026-10-31").map((e) => e.date);
  assert.deepEqual(days, ["2026-10-05", "2026-10-19", "2026-10-26"]);
  assert.equal(expandRecurring([cls], "2026-12-08", "2026-12-31").length, 0);
  const between = eventsBetween([cls, { id: "t", title: "Trip", date: "2026-10-03", endDate: "2026-10-06", time: "" }], "2026-10-05", "2026-10-05");
  assert.deepEqual(between.map((e) => e.title), ["Trip", "ECON 101"], "a multi-day event covers the days it spans; all-day first");
});

test("the brain's tool lists a week, adds and completes; read_calendar answers from the planner", async () => {
  const p = new Planner({ stateDir: dir(), now: () => NOW, stits: null });
  await p.start();
  const added = JSON.parse(await p.tool("add_event", { title: "Dentist", date: "2026-10-13", time: "15:00" })) as { ok: boolean };
  assert.ok(added.ok);
  const todo = JSON.parse(await p.tool("add_todo", { title: "Remind Tazeem", dueDate: "2026-10-12" })) as { id: string };
  assert.ok(JSON.parse(await p.tool("complete_todo", { id: todo.id })).ok);
  const listed = JSON.parse(await p.tool("list", {})) as { today: string; events: PlannerEvent[]; todos: PlannerTodo[] };
  assert.equal(listed.today, "2026-10-12");
  assert.deepEqual(listed.events.map((e) => e.title), ["Dentist"]);
  assert.equal(listed.todos.length, 0, "done todos are left out unless asked");
  const cal = p.readCalendar({ startDate: "2026-10-13", days: 1 });
  assert.equal(cal.ok, true);
  assert.equal(cal.events[0]?.title, "Dentist");
  assert.equal(cal.events[0]?.allDay, false);
  assert.equal(new Date(cal.events[0]!.startsAt).getHours(), 15);
});

test("the local file is plain JSON a person can read", async () => {
  const d = dir();
  const p = new Planner({ stateDir: d, now: () => NOW, stits: null });
  await p.start();
  await p.run({ op: "todo.add", todo: { title: "Readable" } });
  assert.match(readFileSync(join(d, "planner.json"), "utf8"), /"title": "Readable"/);
});

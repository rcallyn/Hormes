import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { WorkCommand } from "@hormes/protocol";
import { WorkStore } from "../work/store.ts";

const at = Date.UTC(2026, 9, 11, 14);
const calendarSources = [{ id: "school", title: "Calendar", account: "School" }, { id: "personal", title: "Calendar", account: "Personal" }];
const event = { id: "course_event", title: "Biology lecture", startsAt: at, endsAt: at + 3_600_000, calendar: "Calendar", sourceCalendarId: "school", demo: false };
function fixture(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(join(tmpdir(), "hormes-calendar-selection-"));
  let now = at;
  const store = new WorkStore(dir, () => now);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const send = (command: Omit<WorkCommand, "requestId">) => store.command({ ...command, requestId: randomUUID() });
  return { dir, store, send, advance: (ms: number) => { now += ms; } };
}

test("calendar discovery requires explicit IDs and rejects events from excluded or unidentified calendars", t => {
  const { store, send, dir } = fixture(t);
  send({ action: "calendar", calendarSources, events: [event] });
  assert.deepEqual(store.state().selectedCalendarIds, []);
  assert.deepEqual(store.state().calendar, []);
  send({ action: "calendar.configure", selectedCalendarIds: ["school"] });
  const { sourceCalendarId: _source, ...unidentified } = event;
  const others = [{ ...event, id: "personal_event", sourceCalendarId: "personal" }, { ...unidentified, id: "unidentified" }];
  send({ action: "calendar", calendarSources, events: [event, ...others] });
  assert.deepEqual(store.state().calendar, [event], "same-title calendars must remain separated by identifier");
  assert.throws(() => send({ action: "calendar.configure", selectedCalendarIds: ["missing"] }), /available calendar/);
  store.close(); const reopened = new WorkStore(dir, () => at);
  try { assert.deepEqual(reopened.state().selectedCalendarIds, ["school"]); assert.deepEqual(reopened.state().calendarSources, calendarSources); } finally { reopened.close(); }
});

test("deselection cancels an outstanding offer and removes only that real calendar's cached events", t => {
  const { store, send } = fixture(t);
  send({ action: "demo", blockId: "class" }); send({ action: "pause" });
  const saved = store.state().sessions;
  send({ action: "calendar", calendarSources, events: [] });
  send({ action: "calendar.configure", selectedCalendarIds: ["school"], enabled: true });
  send({ action: "calendar", events: [event] });
  send({ action: "calendar.link", mode: "class", blockId: event.id, courseId: "biology", courseTitle: "Biology" });
  store.calendarTick(true, () => true); const offer = store.state().offer!; assert.ok(offer);
  send({ action: "calendar.configure", selectedCalendarIds: [] });
  assert.equal(store.state().offer, undefined);
  assert.equal(store.state().calendar.filter(e => !e.demo).length, 0);
  assert.equal(store.state().calendar.filter(e => e.demo).length, 9);
  assert.deepEqual(store.state().sessions, saved);
  assert.throws(() => send({ action: "offer.accept", offerId: offer.id }), /expired/);
});

test("explicit course link survives refresh and manual start without inheriting the Microeconomics exercise", t => {
  const { store, send } = fixture(t);
  send({ action: "calendar", events: [{ ...event, mode: "study", goalId: "injected" }] });
  assert.equal(store.state().calendar[0]!.mode, undefined);
  send({ action: "calendar.link", blockId: event.id, mode: "class", courseId: "biology", courseTitle: "Biology" });
  const goal = store.state().goals.find(g => g.courseId === "biology")!;
  assert.ok(goal);
  assert.equal(store.state().active, undefined, "linking must not start a session");
  send({ action: "calendar", events: [{ ...event, title: "A title cannot switch this to Microeconomics" }] });
  assert.equal(store.state().calendar[0]!.goalId, goal.id);
  send({ action: "start", mode: "class", blockId: event.id });
  assert.equal(store.state().active!.goalId, goal.id);
  assert.equal(store.state().active!.courseId, "biology");
  assert.equal(store.state().active!.sourceIds.includes("course_exchange"), false);
  assert.equal(store.state().sources.find(s => s.id === store.state().active!.lecture!.sourceId)!.courseId, "biology");
  send({ action: "calendar.link", blockId: event.id, mode: "study", goalId: goal.id });
  send({ action: "start", mode: "study", blockId: event.id });
  const study = store.state().active!;
  assert.equal(study.goalId, goal.id); assert.equal(study.courseId, "biology");
  assert.equal(study.exercise, undefined, "new course cannot be graded with the exchange-economy reference");
  assert.equal(study.sourceIds.includes("course_exchange"), false);
  send({ action: "lesson.prepare", sessionId: study.id });
  send({ action: "lesson.begin", sessionId: study.id });
  assert.equal(store.state().active!.pendingPlan, undefined, "voice and an empty board do not fabricate a checked problem");
  const result = store.voice(store.scope()!, "ungraded-number", "The price is one half.");
  assert.equal(result?.checked, undefined);
  assert.equal(store.state().evidence.length, 0);
});

test("a course without a checked exercise opens scoped ungraded voice and closes it on pause", async t => {
  const { world } = await import("./world.ts");
  const w = world(); t.after(() => w.engine.stop());
  await w.engine.start(); await w.engine.ready();
  const send = (command: Omit<WorkCommand, "requestId">) => w.engine.command({ type: "work.command", command: { ...command, requestId: randomUUID() } });
  await send({ action: "calendar", events: [event] });
  await send({ action: "calendar.link", blockId: event.id, mode: "study", courseId: "biology", courseTitle: "Biology" });
  await send({ action: "start", mode: "study", blockId: event.id });
  assert.equal(w.live.config, undefined);
  await send({ action: "lesson.begin" });
  assert.equal(w.live.currentState, "started");
  assert.match(w.live.config!.instructions!, /# Course discussion/);
  assert.doesNotMatch(w.live.config!.instructions!, /# Current learning tool/);
  assert.ok(w.live.instructions.some(text => text.includes("No reference-checked exercise")));
  w.live.emit("inputTranscript", "The price is one half.", 0, 700);
  w.live.nowMs = 3000;
  (w.engine as unknown as { tick(): void }).tick();
  assert.equal(w.engine.work.store.state().evidence.length, 0);
  assert.equal(w.engine.work.store.state().active!.pendingPlan, undefined);
  await send({ action: "pause" });
  assert.equal(w.live.currentState, "closed");
});

test("accepted recurring offers keep the chosen goal while preserving occurrence isolation", t => {
  const { store, send, advance } = fixture(t);
  send({ action: "calendar", events: [event] });
  send({ action: "calendar.link", mode: "class", blockId: event.id, courseId: "biology", courseTitle: "Biology" });
  send({ action: "start", mode: "class", blockId: event.id }); const first = store.state().active!;
  send({ action: "pause" }); advance(86_400_000);
  const next = { ...event, startsAt: event.startsAt + 86_400_000, endsAt: event.endsAt + 86_400_000 };
  send({ action: "calendar", events: [next] }); send({ action: "calendar.configure", enabled: true });
  store.calendarTick(true, () => true); send({ action: "offer.accept", offerId: store.state().offer!.id });
  const active = store.state().active!;
  assert.notEqual(active.id, first.id); assert.equal(active.goalId, first.goalId);
  assert.equal(active.courseId, "biology"); assert.equal(active.calendarStartsAt, next.startsAt);
});

test("invalid goal/course associations leave prior link intact and unlink revokes future offers", t => {
  const { store, send } = fixture(t);
  send({ action: "start", mode: "meeting" }); const meetingGoal = store.state().active!.goalId;
  send({ action: "pause" }); send({ action: "calendar", events: [event] });
  send({ action: "calendar.link", mode: "study", blockId: event.id, courseId: "biology", courseTitle: "Biology" });
  const linked = store.state().calendar[0]!;
  for (const extra of [{ goalId: "missing" }, { goalId: meetingGoal }, { goalId: linked.goalId!, courseId: "physics" }, { courseId: "unnamed" }]) {
    assert.throws(() => send({ action: "calendar.link", mode: "study", blockId: event.id, ...extra }));
    assert.deepEqual(store.state().calendar[0], linked);
  }
  send({ action: "calendar.configure", enabled: true }); store.calendarTick(true, () => true); assert.ok(store.state().offer);
  send({ action: "calendar.link", mode: "study", blockId: event.id, enabled: false });
  assert.equal(store.state().offer, undefined); assert.equal(store.state().calendar[0]!.goalId, undefined);
  send({ action: "calendar", events: [event] }); assert.equal(store.state().calendar[0]!.mode, undefined);
});

test("saved legacy mode-only links remain usable after the association upgrade", t => {
  const { dir, store, send } = fixture(t);
  send({ action: "calendar", events: [event] }); send({ action: "calendar.link", mode: "study", blockId: event.id });
  store.close();
  const db = new DatabaseSync(join(dir, "work", "work.sqlite"));
  const meta = JSON.parse(String(db.prepare("SELECT value FROM records WHERE kind='meta' AND id='state'").get()!.value));
  meta.links[event.id] = "study";
  db.prepare("UPDATE records SET value=? WHERE kind='meta' AND id='state'").run(JSON.stringify(meta)); db.close();
  send({ action: "calendar", events: [event] });
  assert.equal(store.state().calendar[0]!.goalId, "goal_learning");
  send({ action: "start", mode: "study", blockId: event.id }); assert.equal(store.state().active!.goalId, "goal_learning");
});

test("manual class and next-class reject unknown, nonlearning and conflicting course goals before changing work", t => {
  const { store, send } = fixture(t);
  send({ action: "start", mode: "meeting" }); const meetingGoal = store.state().active!.goalId;
  send({ action: "start", mode: "class", courseId: "biology", courseTitle: "Biology" });
  const biologyGoal = store.state().active!.goalId;
  const before = store.state();
  for (const action of ["start", "class.next"] as const) {
    for (const extra of [{ goalId: meetingGoal }, { goalId: "missing" }, { goalId: biologyGoal, courseId: "physics", courseTitle: "Physics" }]) {
      assert.throws(() => send({ action, mode: "class", ...extra }), /compatible|different course/);
      assert.deepEqual(store.state(), before, `${action} must preserve active work and metadata on invalid goal`);
    }
  }
});

test("manual study honors an explicit learning goal and rejects incompatible goals", t => {
  const { store, send } = fixture(t);
  send({ action: "start", mode: "meeting" }); const meetingGoal = store.state().active!.goalId;
  send({ action: "start", mode: "class", courseId: "biology", courseTitle: "Biology" }); const biologyGoal = store.state().active!.goalId;
  send({ action: "start", mode: "study", goalId: biologyGoal });
  assert.equal(store.state().active!.goalId, biologyGoal);
  assert.equal(store.state().active!.courseId, "biology");
  assert.equal(store.state().active!.exercise, undefined);
  const before = store.state();
  assert.throws(() => send({ action: "start", mode: "study", goalId: meetingGoal }), /compatible/);
  assert.throws(() => send({ action: "start", mode: "study", goalId: "missing" }), /compatible/);
  assert.deepEqual(store.state(), before);
});

test("accept rechecks current occurrence end and ingestion freshness before recording acceptance", t => {
  const { store, send, advance } = fixture(t);
  send({ action: "calendar", events: [event] });
  send({ action: "calendar.link", mode: "study", blockId: event.id });
  send({ action: "calendar.configure", enabled: true });
  store.calendarTick(true, () => true);
  const first = store.state().offer!;
  advance(1_000);
  send({ action: "calendar", events: [{ ...event, endsAt: at + 2_000 }] });
  advance(2_000);
  assert.throws(() => send({ action: "offer.accept", offerId: first.id }), /expired/);
  assert.equal(store.state().active, undefined);
  assert.equal(store.state().sessions.length, 0);
  assert.equal(store.state().offer?.id, first.id, "a failed acceptance does not become an accepted receipt");
  send({ action: "calendar", events: [{ ...event, id: "later", startsAt: at + 3_000 }] });
  send({ action: "calendar.link", mode: "study", blockId: "later" });
  store.calendarTick(true, () => true);
  const second = store.state().offer!;
  advance(120_001);
  assert.throws(() => send({ action: "offer.accept", offerId: second.id }), /expired/);
  assert.equal(store.state().active, undefined);
});

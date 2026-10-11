import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { WorkStore, exchangeAnswer, numeric } from "../work/store.ts";
import { WorkCoordinator } from "../work/coordinator.ts";
import { classifyToolScope } from "@hormes/core";
import type { WorkCommand, WorkReply } from "@hormes/protocol";
import { ProactiveSuggestions, suggestionBudget } from "../proactive.ts";

function fixture(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(join(tmpdir(), "hormes-work-"));
  let clock = Date.UTC(2026, 9, 10, 10);
  const store = new WorkStore(dir, () => clock);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const send = (command: Omit<WorkCommand, "requestId">) => store.command({ ...command, requestId: randomUUID() });
  return { dir, store, send, advance: (ms: number) => { clock += ms; } };
}
const scene = JSON.stringify({ elements: [{ id: "student", type: "text", text: "p = py/px", x: 10, y: 20 }], appState: { scrollX: 1 }, files: {} });
const plan = { summary: "Budget", operations: [{ type: "create_node", tempId: "budget", text: "Income = x + py", shape: "rectangle", x: 40, y: 60 }] };
const event = { id: "class_event", title: "Microeconomics practice", startsAt: Date.UTC(2026, 9, 10, 10), endsAt: Date.UTC(2026, 9, 10, 11), calendar: "Test calendar", demo: false };

test("legacy hypothetical day displays newly added blocks without rewriting saved work or real events", (t) => {
  const { store, send, dir, advance } = fixture(t);
  send({ action: "calendar", events: [event] });
  send({ action: "demo", blockId: "class" });
  const before = store.state(), coding = before.calendar.find(e => e.id === "demo_coding")!;
  store.close();
  const db = new DatabaseSync(join(dir, "work", "work.sqlite"));
  try {
    const row = db.prepare("SELECT value FROM records WHERE kind='meta' AND id='state'").get()!;
    const legacy = JSON.parse(String(row.value));
    legacy.calendar = legacy.calendar.filter((e: { id: string }) => e.id !== "demo_coding");
    db.prepare("UPDATE records SET value=? WHERE kind='meta' AND id='state'").run(JSON.stringify(legacy));
    const activity = db.prepare("SELECT COUNT(*) AS n FROM activity").get()!.n;
    advance(DAY_FOR_TEST * 3);
    const after = store.state();
    assert.deepEqual(after.calendar.find(e => e.id === "demo_coding"), coding, "EvoSim uses the saved hypothetical day, not today's clock");
    assert.deepEqual(after.calendar, before.calendar);
    assert.deepEqual(after.active, before.active);
    assert.deepEqual(after.sessions, before.sessions);
    assert.equal(after.demoBlock, before.demoBlock);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM activity").get()!.n, activity, "rendering must not append activity");
    assert.deepEqual(JSON.parse(String(db.prepare("SELECT value FROM records WHERE kind='meta' AND id='state'").get()!.value)), legacy, "rendering must not rewrite stored calendar history");
  } finally { db.close(); }
});

test("reading a real-only calendar does not introduce a hypothetical day", (t) => {
  const { store, send } = fixture(t);
  send({ action: "calendar", events: [event] });
  assert.deepEqual(store.state().calendar, [event]);
});

test("class folders preserve dated session types and their notes across reopening", (t) => {
  const { store, send, dir, advance } = fixture(t);
  send({ action: "start", mode: "class" });
  const first = store.state().active!;
  send({ action: "question", text: "Why is p the ratio of these two prices?" });
  advance(DAY_FOR_TEST);
  send({ action: "start", mode: "study" });
  const second = store.state().active!;
  assert.equal(first.courseId, "microeconomics");
  assert.equal(second.courseId, first.courseId);
  store.close(); const reopened = new WorkStore(dir);
  try {
    const state = reopened.state();
    assert.equal(state.courses?.[0]?.title, "Intermediate Microeconomics");
    assert.deepEqual(state.sessions.map((s) => s.mode), ["study", "class"]);
    assert.ok(second.createdAt > first.createdAt);
    assert.equal(state.observations.find((o) => o.sessionId === first.id)?.text, "Why is p the ratio of these two prices?");
    assert.ok(state.sessions.every((s) => s.courseId === "microeconomics"));
  } finally { reopened.close(); }
});
const DAY_FOR_TEST = 86_400_000;

test("Console can inspect old class notes beyond the recent window without changing active work", (t) => {
  const { store, send } = fixture(t);
  send({ action: "start", mode: "class" }); const old = store.state().active!.id;
  send({ action: "question", text: "Saved class question" });
  send({ action: "start", mode: "study" }); const active = store.state().active!.id;
  for (let i = 0; i < 501; i++) send({ action: "question", text: `Later note ${i}` });
  assert.equal(store.state().observations.some(o => o.sessionId === old), false);
  send({ action: "inspect", sessionId: old });
  assert.equal(store.state().observations.find(o => o.sessionId === old)?.text, "Saved class question");
  assert.equal(store.state().active!.id, active);
  assert.equal(store.state().sessions.find(s => s.id === old)!.state, "paused");
  send({ action: "inspect" });
  assert.equal(store.state().observations.some(o => o.sessionId === old), false);
});

test("the initial handwritten problem isn't a hint; real spoken attempts are checked once with provenance", (t) => {
  const { store, send } = fixture(t);
  send({ action: "start", mode: "exam" });
  send({ action: "lesson.prepare" });
  const pending = store.state().active!.pendingPlan!;
  assert.equal(pending.purpose, "problem");
  assert.ok(JSON.parse(pending.json).operations.every((op: { type: string }) => op.type === "write"));
  send({ action: "scene.save", revision: 0, scene });
  send({ action: "board.applied", planId: pending.id, success: true });
  const scope = store.scope()!;
  store.recordSpeech(scope, "Take a look at the problem. What would you try first?");
  assert.equal(store.state().observations.some((o) => o.kind === "hint"), false);
  const checked = store.voice(scope, "mic_1", "The price is two")!;
  assert.match(checked.checked!, /Correct/);
  assert.equal(store.state().evidence[0]!.assistance, "independent");
  const answer = store.state().observations.find((o) => o.kind === "answer")!;
  assert.equal(answer.input, "voice"); assert.equal(answer.utteranceId, "mic_1"); assert.equal(answer.text, "The price is two");
  store.voice(scope, "mic_1", "The price is two");
  assert.equal(store.state().evidence.length, 1);
  store.voice(scope, "mic_2", "Is the price three?");
  assert.equal(store.state().evidence.length, 1, "ambiguous reasoning cannot manufacture evidence");
  send({ action: "start", mode: "study" });
  assert.throws(() => store.voice(scope, "late", "The price is two"), /expired/);
});

test("a spoken stumble allows one tutor step and acknowledged help stays assisted across restart", (t) => {
  const { store, send } = fixture(t);
  send({ action: "start", mode: "exam" }); const scope = store.scope()!;
  store.voice(scope, "stuck", "I'm stuck");
  store.model(scope, "board", { summary: "One hint", operations: [{ type: "write", tempId: "hint", text: "Income = x + p y", x: 60, y: 340 }] });
  send({ action: "board.applied", planId: store.state().active!.pendingPlan!.id, success: true });
  store.close();
  store.voice(scope, "attempt", "The price is two");
  assert.equal(store.state().evidence[0]!.assistance, "assisted");
});

test("board rejects TeX escapes and corrupted math without leaving a pending plan", (t) => {
  const { store, send } = fixture(t);
  send({ action: "start", mode: "study" });
  const scope = store.scope()!;
  for (const text of ["p \\times 5", "p \times 5", "x\u0000y"]) {
    assert.throws(() => store.model(scope, "board", { ...plan, operations: [{ ...plan.operations[0], text }] }), /plain Unicode math/);
    assert.equal(store.state().active!.pendingPlan, undefined);
  }
  store.model(scope, "board", { ...plan, operations: [{ ...plan.operations[0], text: "A's budget\nxₐ + p yₐ = 2 + p × 1" }] });
  assert.match(store.state().active!.pendingPlan!.json, /× 1/);
});

test("calendar requires both opt-in and an explicit mode association, not title inference", (t) => {
  const { store, send } = fixture(t); let claims = 0;
  const tick = (quiet = true) => store.calendarTick(quiet, () => { claims++; return true; });
  send({ action: "calendar", events: [{ ...event, mode: "study", goalId: "injected" }] });
  assert.equal(store.state().calendar[0]!.mode, undefined);
  send({ action: "calendar.link", blockId: event.id, mode: "study" });
  tick(); assert.equal(claims, 0);
  send({ action: "calendar.configure", enabled: true });
  tick(false); assert.equal(claims, 0);
  tick(); const offer = store.state().offer!;
  assert.equal(claims, 1); assert.equal(store.state().active, undefined);
  send({ action: "offer.accept", offerId: offer.id });
  assert.equal(store.state().active!.calendarId, event.id);
  assert.equal(store.state().active!.mode, "study");
  assert.equal(store.state().offer, undefined);
});

test("dismissal survives restart and never reoffers the same block", (t) => {
  const { store, send } = fixture(t); let claims = 0;
  send({ action: "calendar", events: [event] });
  send({ action: "calendar.link", blockId: event.id, mode: "study" });
  send({ action: "calendar.configure", enabled: true });
  store.calendarTick(true, () => { claims++; return true; });
  send({ action: "offer.dismiss", offerId: store.state().offer!.id });
  store.close();
  store.calendarTick(true, () => { claims++; return true; });
  assert.equal(claims, 1); assert.equal(store.state().offer, undefined);
  assert.equal(store.state().calendarEnabled, true);
});

test("accepting a study block restores its existing editable workspace", (t) => {
  const { store, send } = fixture(t);
  send({ action: "start", mode: "study" }); const saved = store.state().active!.id;
  send({ action: "scene.save", revision: 0, scene }); send({ action: "pause" });
  send({ action: "calendar", events: [event] }); send({ action: "calendar.link", blockId: event.id, mode: "study" }); send({ action: "calendar.configure", enabled: true });
  store.calendarTick(true, () => true); send({ action: "offer.accept", offerId: store.state().offer!.id });
  assert.equal(store.state().active!.id, saved); assert.equal(store.state().active!.scene, scene);
});

for (const mode of ["meeting", "travel"] as const) {
  for (const occurrence of ["different event", "recurring occurrence"] as const) {
    test(`accepting a ${mode} ${occurrence} cannot reuse another session's sources or output`, (t) => {
      const { store, send } = fixture(t);
      const firstEvent = { ...event, id: `${mode}-event`, title: `First ${mode}` };
      send({ action: "calendar", events: [firstEvent] });
      send({ action: "start", mode, blockId: firstEvent.id });
      const scope = store.scope()!;
      if (mode === "meeting") {
        send({ action: "recap", text: "Previous investor requested a confidential pricing report." });
        const meeting = store.state().active!.meeting!;
        store.model(scope, "meeting", { stage: "follow-up", subject: "Previous investor", body: "We will prepare the confidential pricing report.", requests: ["Prepare pricing report"], sourceIds: [meeting.sourceId], revision: meeting.revision, attachmentIds: [] });
      } else {
        send({ action: "travel", travel: { origin: "Albany", destination: "Boston", date: "2026-10-12", departAfter: "17:00", arriveBefore: "23:00", preference: "Price" } });
        const source = store.receipt(scope, "web_fetch", { url: "https://example.com/previous-trip" }, "Previous Boston route costs 12");
        store.model(scope, "artifact", { text: "Previous Boston itinerary", sourceIds: [source] });
      }
      const first = store.state().active!;
      send({ action: "pause" });
      const nextEvent = { ...firstEvent, title: `Next ${mode}`, ...(occurrence === "different event" ? { id: `${mode}-next` } : { startsAt: firstEvent.startsAt + 1000 }) };
      send({ action: "calendar", events: [nextEvent] });
      send({ action: "calendar.link", blockId: nextEvent.id, mode });
      send({ action: "calendar.configure", enabled: true });
      store.calendarTick(true, () => true);
      send({ action: "offer.accept", offerId: store.state().offer!.id });
      const current = store.state().active!;
      assert.notEqual(current.id, first.id);
      assert.equal(current.calendarId, nextEvent.id);
      assert.equal(current.calendarStartsAt, nextEvent.startsAt);
      assert.equal(current.title, nextEvent.title);
      assert.equal(current.artifact, undefined);
      assert.deepEqual(current.artifactSourceIds, []);
      assert.doesNotMatch(store.context(store.scope()!), /confidential pricing report|Previous Boston/);
      if (mode === "meeting") {
        assert.notEqual(current.meeting!.sourceId, first.meeting!.sourceId);
        assert.equal(current.meeting!.revision, 0);
        assert.equal(current.meeting!.followUp, undefined);
      } else assert.equal(current.travel!.date, "");
      const saved = store.state(first.id).active!;
      assert.equal(saved.calendarId, firstEvent.id);
      assert.equal(saved.calendarStartsAt, firstEvent.startsAt);
      assert.equal(saved.state, "paused");
      if (mode === "meeting") assert.equal(saved.meeting!.followUp!.id, first.meeting!.followUp!.id);
      else assert.equal(saved.artifact, first.artifact);
    });
  }

  test(`accepting the same ${mode} occurrence resumes its saved work after restart`, (t) => {
    const { store, send, dir } = fixture(t);
    const linked = { ...event, id: `${mode}-event`, title: `Saved ${mode}` };
    send({ action: "calendar", events: [linked] });
    send({ action: "start", mode, blockId: linked.id });
    if (mode === "meeting") send({ action: "recap", text: "Resume this meeting's saved discussion." });
    else send({ action: "travel", travel: { origin: "Albany", destination: "Boston", date: "2026-10-12", departAfter: "17:00", arriveBefore: "23:00", preference: "Price" } });
    const first = store.state().active!;
    send({ action: "pause" }); send({ action: "calendar.configure", enabled: true });
    store.close();
    const reopened = new WorkStore(dir, () => event.startsAt);
    try {
      reopened.calendarTick(true, () => true);
      reopened.command({ action: "offer.accept", offerId: reopened.state().offer!.id, requestId: randomUUID() });
      const current = reopened.state().active!;
      assert.equal(current.id, first.id);
      assert.equal(current.calendarStartsAt, linked.startsAt);
      assert.equal(current.title, linked.title);
      if (mode === "meeting") assert.deepEqual(current.meeting, first.meeting);
      else assert.deepEqual(current.travel, first.travel);
    } finally { reopened.close(); }
  });
}

test("changing travel constraints requires new sources and invalidates the old recommendation", (t) => {
  const { store, send } = fixture(t);
  send({ action: "start", mode: "travel" }); const scope = store.scope()!;
  const oldSource = store.receipt(scope, "web_fetch", { url: "https://example.com/route" }, "Old date");
  store.model(scope, "artifact", { text: "Old itinerary", sourceIds: [oldSource] });
  store.recordSpeech(scope, "Old route costs 12");
  send({ action: "travel", travel: { origin: "Albany", destination: "NYC", date: "2026-10-12", departAfter: "17:00", arriveBefore: "23:00", preference: "Price" } });
  assert.equal(store.state().active!.artifact, undefined);
  assert.doesNotMatch(store.context(scope), /Old itinerary|Old route|Old date/);
  assert.throws(() => store.model(scope, "artifact", { text: "Recycled route", sourceIds: [oldSource] }), /Cite source IDs/);
  assert.ok(store.state().sources.some((s) => s.id === oldSource), "history remains durable");
});

test("travel rejects impossible dates, invalid clocks and empty same-day windows without discarding saved research", (t) => {
  const { store, send } = fixture(t);
  send({ action: "start", mode: "travel" });
  const travel = { origin: "Albany", destination: "NYC", date: "2026-10-12", departAfter: "17:00", arriveBefore: "23:00", preference: "Price" };
  send({ action: "travel", travel });
  const scope = store.scope()!;
  const source = store.receipt(scope, "web_fetch", { url: "https://example.com/valid-trip" }, "Saved valid route");
  store.model(scope, "artifact", { text: "Saved valid comparison", sourceIds: [source] });
  const saved = store.state().active!;
  for (const invalid of [
    { date: "2026-02-29" }, { date: "2026-02-30" }, { date: "2026-13-01" }, { date: "2026-00-10" },
    { date: "2026-04-31" }, { date: "2026-10-00" }, { date: "2026-1-12" },
    { departAfter: "24:00" }, { departAfter: "17:60" }, { arriveBefore: "99:99" },
    { departAfter: "23:00", arriveBefore: "17:00" }, { departAfter: "17:00", arriveBefore: "17:00" },
  ]) {
    assert.throws(() => send({ action: "travel", travel: { ...travel, ...invalid } }), /travel date|departure|arrival/i, JSON.stringify(invalid));
    assert.deepEqual(store.state().active, saved, "invalid travel input must preserve constraints and source-backed research");
  }
  for (const date of ["2028-02-29", "2026-12-31"]) {
    send({ action: "travel", travel: { ...travel, date, departAfter: "00:00", arriveBefore: "23:59" } });
    assert.equal(store.state().active!.travel!.date, date);
  }
});

test("calendar cancellation, stale ingestion, focus, lock and breaks remove offers", (t) => {
  const { store, send, advance } = fixture(t);
  send({ action: "calendar", events: [event] });
  send({ action: "calendar.link", blockId: event.id, mode: "study" });
  send({ action: "calendar.configure", enabled: true });
  store.calendarTick(true, () => true); const old = store.state().offer!.id;
  store.calendarTick(false, () => true);
  assert.equal(store.state().offer, undefined);
  assert.throws(() => send({ action: "offer.accept", offerId: old }), /expired/);
  const moved = { ...event, startsAt: event.startsAt + 60_000 };
  send({ action: "calendar", events: [moved] });
  store.calendarTick(true, () => true); assert.ok(store.state().offer);
  send({ action: "calendar", events: [] }); assert.equal(store.state().offer, undefined);
  send({ action: "calendar", events: [{ ...moved, startsAt: moved.startsAt + 60_000 }] });
  advance(120_001); store.calendarTick(true, () => true); assert.equal(store.state().offer, undefined);
  send({ action: "calendar", events: [event] });
  send({ action: "start", mode: "study" });
  store.calendarTick(true, () => { throw Error("active work must not spend attention"); });
  send({ action: "start", mode: "break" });
  store.calendarTick(true, () => { throw Error("break must stay quiet"); });
});

test("calendar and blocked-agent offers share three-per-day and cooldown limits", (t) => {
  const { store, send, advance } = fixture(t); let now = event.startsAt;
  const gate = new ProactiveSuggestions(suggestionBudget(undefined, now), () => {}, () => now);
  assert.equal(gate.claim("agent:first"), true);
  send({ action: "calendar", events: [event] }); send({ action: "calendar.link", blockId: event.id, mode: "study" }); send({ action: "calendar.configure", enabled: true });
  store.calendarTick(true, (key) => gate.claim(key)); assert.equal(store.state().offer, undefined);
  now += 31 * 60_000; advance(31 * 60_000); send({ action: "calendar", events: [event] });
  store.calendarTick(true, (key) => gate.claim(key)); assert.ok(store.state().offer);
  now += 31 * 60_000; assert.equal(gate.claim("agent:third"), true);
  now += 31 * 60_000; assert.equal(gate.claim("calendar:fourth"), false);
});

test("overlapping blocks make one passive offer and the demo clock never triggers anticipation", (t) => {
  const { store, send } = fixture(t);
  send({ action: "demo", blockId: "class" }); send({ action: "pause" }); send({ action: "calendar.configure", enabled: true });
  store.calendarTick(true, () => { throw Error("demo requires explicit advancement"); });
  const second = { ...event, id: "second" };
  send({ action: "calendar", events: [event, second] });
  for (const blockId of [event.id, second.id]) send({ action: "calendar.link", blockId, mode: "study" });
  let claims = 0;
  store.calendarTick(true, () => { claims++; return true; });
  store.calendarTick(true, () => { claims++; return true; });
  assert.equal(claims, 1); assert.equal(store.state().offer!.eventId, event.id);
  assert.ok(store.state().calendar.some((e) => e.demo), "real reads retain the labeled storyboard");
});

test("engine calendar offers cannot wake voice, act while locked, or force a workspace", async (t) => {
  const { world } = await import("./world.ts");
  const w = world(); t.after(() => w.engine.stop());
  await w.engine.start(); await w.engine.ready();
  const replies: WorkReply[] = [];
  w.engine.on("event", (e) => { if (e.type === "work.state") replies.push(e.reply); });
  const send = (command: Omit<WorkCommand, "requestId">) => w.engine.command({ type: "work.command", command: { ...command, requestId: randomUUID() } });
  const tick = () => (w.engine as unknown as { tick(): void }).tick();
  const calendar = { ...event, startsAt: w.clock.t, endsAt: w.clock.t + 3_600_000 };
  await send({ action: "calendar", events: [calendar] }); await send({ action: "calendar.link", blockId: calendar.id, mode: "study" }); await send({ action: "calendar.configure", enabled: true });
  w.clock.t += 31_000; tick();
  const offer = replies.at(-1)!.state.offer!; assert.ok(offer);
  assert.equal(replies.at(-1)!.state.active, undefined);
  assert.equal(w.live.config, undefined); assert.equal(w.brain.tasks.length, 0);
  w.engine.systemSignal({ kind: "screen.lock" }, w.clock.t);
  await send({ action: "offer.accept", offerId: offer.id });
  assert.equal(replies.at(-1)!.ok, false); tick();
  assert.equal(replies.at(-1)!.state.offer, undefined);
  assert.equal(replies.at(-1)!.state.active, undefined);
});

test("work survives reopening with editable board, attempts, questions, and pending next step", (t) => {
  const { store, send } = fixture(t);
  send({ action: "start", mode: "study" });
  const session = store.state().active!;
  send({ action: "scene.save", sessionId: session.id, revision: 0, scene });
  send({ action: "question", text: "Why does the price ratio go this way?" });
  send({ action: "submit", text: "2" });
  send({ action: "pause" }); store.close();
  assert.equal(store.state().active, undefined);
  send({ action: "resume", sessionId: session.id });
  assert.equal(store.state().active!.scene, scene);
  assert.equal(store.state().evidence[0]!.correct, false);
  assert.equal(store.state().observations.filter((o) => o.kind === "question").length, 1);
  assert.match(store.state().active!.next, /Revisit/);
  assert.throws(() => send({ action: "scene.save", revision: 0, scene }), /newer saved revision/);
});

test("work idempotency does not duplicate sessions or attempts and rejects reused request IDs", (t) => {
  const { store } = fixture(t);
  const start: WorkCommand = { action: "start", mode: "study", requestId: "start_once" };
  store.command(start); store.command(start);
  assert.equal(store.state().sessions.length, 1);
  const attempt: WorkCommand = { action: "submit", text: "1/2;5/4,5/2,7/4,7/2", requestId: "attempt_once" };
  store.command(attempt); store.command(attempt);
  assert.equal(store.state().evidence.length, 2);
  assert.ok(store.state().evidence.every((e) => e.correct));
  assert.throws(() => store.command({ ...attempt, text: "9" }), /already used/);
  assert.equal(store.state().goals[0]!.state, "in-progress");
});

test("independent practice cannot draw hints until requested; acknowledged tutor content marks later attempts assisted", (t) => {
  const { store, send } = fixture(t);
  send({ action: "start", mode: "exam" }); const scope = store.scope()!;
  assert.throws(() => store.model(scope, "board", plan), /Independent practice/);
  send({ action: "hint" }); store.model(scope, "board", plan);
  assert.equal(store.state().observations.some((o) => o.kind === "hint"), false, "queued is not displayed");
  const pending = store.state().active!.pendingPlan!;
  send({ action: "board.applied", planId: pending.id, success: true });
  send({ action: "submit", text: "2;3,1.5,3,1.5" });
  assert.ok(store.state().evidence.every((e) => e.assistance === "assisted"));
  send({ action: "demo", blockId: "grocery" });
  assert.throws(() => store.model(scope, "board", plan), /expired/);
  assert.throws(() => store.recordSpeech(scope, "late answer"), /expired/);
});

test("reference grading ignores model claims, malformed expressions and simulated time", (t) => {
  const { store, send } = fixture(t);
  assert.equal(numeric("1/0"), undefined); assert.equal(numeric("process.exit()"), undefined);
  send({ action: "demo", blockId: "exam" });
  store.recordSpeech(store.scope()!, "The answer is definitely 9");
  send({ action: "submit", text: "9" });
  assert.equal(store.state().evidence[0]!.correct, false);
  send({ action: "demo", blockId: "break" });
  assert.equal(store.state().quiet, true); assert.equal(store.scope(), undefined);
  assert.equal(store.state().goals[0]!.state, "in-progress");
});

test("mastery needs distinct parameter sets and a third independent solution at least a real day later", (t) => {
  const { store, send, advance } = fixture(t);
  for (let n = 0; n < 3; n++) {
    if (n === 2) advance(86_400_000);
    send({ action: "start", mode: "exam" });
    const solution = exchangeAnswer([4 + n, 1], [2, 2 + n]);
    send({ action: "submit", text: `${solution.price};${solution.allocation.join(",")}` });
    assert.equal(store.state().goals[0]!.state, n < 2 ? "in-progress" : "complete");
  }
});

test("successful hypothetical-day rehearsals remain visible but cannot complete a learning goal", (t) => {
  const { store, send, advance } = fixture(t);
  for (let n = 0; n < 3; n++) {
    if (n === 2) advance(86_400_000);
    send({ action: "demo", blockId: "exam" });
    const solution = exchangeAnswer([4 + n, 1], [2, 2 + n]);
    send({ action: "submit", text: `${solution.price};${solution.allocation.join(",")}` });
  }
  assert.equal(store.state().evidence.length, 6);
  assert.ok(store.state().evidence.every((e) => e.correct && e.limitations.includes("excluded from goal completion")));
  assert.equal(store.state().goals[0]!.state, "in-progress");
});

test("artifacts cite actual tool receipts and supplied sources, never invented source IDs", (t) => {
  const { store, send } = fixture(t);
  send({ action: "start", mode: "travel" }); const scope = store.scope()!;
  assert.throws(() => store.model(scope, "artifact", { text: "A cheap train", sourceIds: ["invented"] }), /Cite source IDs/);
  store.receipt(scope, "web_fetch", { url: "https://example.com/route" }, "A provider page with dates and fares");
  const source = store.state().sources.find((s) => s.kind === "web")!;
  store.model(scope, "artifact", { text: "Compare this route. Availability still needs review.", sourceIds: [source.id] });
  assert.deepEqual(store.state().active!.artifactSourceIds, [source.id]);
  assert.equal(store.state().goals[0]!.state, "in-progress");
  assert.throws(() => store.model(scope, "complete", {}), /Unknown work operation/);
});

test("work capability never widens a proactive review or permits arbitrary execution", () => {
  for (const mode of ["study", "exam", "meeting", "travel"] as const) {
    const scope = { sessionId: "session", mode };
    for (const tool of ["run_shell", "applescript", "agent_start", "self_edit", "write_file", "thread_start"]) assert.equal(classifyToolScope(tool, {}, undefined, scope).verdict, "refuse", `${mode}: ${tool}`);
    assert.equal(classifyToolScope("work", {}, undefined, scope).verdict, "run");
    assert.equal(classifyToolScope("work", {}, "agent", scope).verdict, "refuse");
    assert.equal(classifyToolScope("browser_navigate", {}, undefined, scope).verdict, mode === "travel" ? "run" : "refuse");
  }
});

test("coordinator cancels a late model turn without writing into the next session", async (t) => {
  const { dir } = fixture(t); const replies: WorkReply[] = [];
  let ready!: () => void;
  const entered = new Promise<void>((resolve) => { ready = resolve; });
  let finish!: () => void;
  const hold = new Promise<void>((resolve) => { finish = resolve; });
  const coordinator = new WorkCoordinator({ stateDir: dir, redact: (s) => s, emit: (r) => replies.push(r), lane: () => ({ runner: { setLane() {}, beginTurn() {} }, brain: {
    kind: "fake", start: async () => ({ ready: true, detail: "ready" }), cancel: async () => {}, stop: async () => {},
    handle: async (_task, sink) => { ready(); await hold; sink.commentary("late explanation"); return { status: "done", summary: "late summary" }; },
  } }) });
  await coordinator.command({ action: "start", mode: "study", requestId: "one" });
  const running = coordinator.command({ action: "ask", text: "Explain", requestId: "two" }); await entered;
  await coordinator.command({ action: "start", mode: "meeting", requestId: "three" }); finish(); await running;
  assert.equal(coordinator.store.state().active!.mode, "meeting");
  assert.equal(replies.some((r) => r.speech?.includes("late")), false);
  await coordinator.stop();
});

test("spoken feedback after a wrong answer cannot make a later answer independent", (t) => {
  const { store, send } = fixture(t);
  send({ action: "start", mode: "exam" });
  send({ action: "submit", text: "9" });
  store.recordSpeech(store.scope()!, "Try the corrected budget relationship.");
  send({ action: "submit", text: "2;3,1.5,3,1.5" });
  assert.ok(store.state().evidence.slice(-2).every((e) => e.assistance === "assisted"));
});

test("research context does not substitute a previous session's summary for freshly retrieved sources", (t) => {
  const { store, send } = fixture(t);
  send({ action: "start", mode: "travel" }); store.recordSpeech(store.scope()!, "An old result says a fare is $10");
  send({ action: "start", mode: "travel" });
  assert.doesNotMatch(store.context(store.scope()!), /old result/);
  const source = store.receipt(store.scope()!, "web_fetch", { url: "https://example.com" }, "Route details");
  assert.ok(source && store.context(store.scope()!).includes(source));
});

test("an explicit Sage request uses the existing voice delegator with the bound work capability", async (t) => {
  const { world, until } = await import("./world.ts");
  const w = world(); t.after(() => w.engine.stop());
  await w.engine.start(); await w.engine.ready();
  await w.engine.command({ type: "work.command", command: { action: "start", mode: "study", requestId: "voice_study" } });
  assert.equal(w.live.config, undefined, "starting a workspace must not open the mic");
  await w.engine.command({ type: "work.command", command: { action: "lesson.begin", requestId: "voice_lesson_begin" } });
  assert.equal(w.lives.at(-1)?.config?.interactionMode, "education", "course context requires an explicitly entered Sage voice session");
  await w.engine.command({ type: "work.command", command: { action: "ask", text: "Explain my budget relationship on the board", requestId: "voice_question" } });
  w.live.emit("delegation", "work_voice", "client", w.live.nowMs);
  await until(() => w.brain.tasks.length > 0, 3000);
  assert.equal(w.brain.tasks[0]?.work?.mode, "study");
  assert.equal(w.brain.tasks[0]?.interactionMode, "education");
  assert.ok(w.brain.tasks[0]?.workContext?.includes("course_exchange"));
  const denied = await w.engine.runner.run("run_shell", { command: "echo bypass" });
  assert.equal(denied.result.kind, "error");
  w.brain.resolve?.({ status: "done", summary: "Try the next step." });
  await w.engine.command({ type: "work.command", command: { action: "pause", requestId: "close_voice_study" } });
  assert.equal(w.engine.snapshot().phase, "asleep", "closing the workspace also closes its paid voice session");
});

test("a long lesson question remains scoped and cannot invoke desktop reflexes", async (t) => {
  const { world, until } = await import("./world.ts");
  const w = world(); t.after(() => w.engine.stop());
  await w.engine.start(); await w.engine.ready();
  const send = (command: Omit<WorkCommand, "requestId">) => w.engine.command({ type: "work.command", command: { ...command, requestId: randomUUID() } });
  await send({ action: "start", mode: "study" }); await send({ action: "lesson.begin" });
  w.clock.t += 40_000; w.live.nowMs = 40_000;
  w.live.emit("inputTranscript", "I'm stuck. Draw one small budget hint.", 40_000, 40_000);
  w.live.emit("delegation", "long_lesson", "client", 40_000);
  await until(() => w.brain.tasks.length > 0, 3000);
  assert.equal(w.brain.tasks[0]?.work?.mode, "study");
  assert.equal(w.brain.tasks[0]?.attachments?.length ?? 0, 0, "a board lesson does not capture unrelated screen content");
  assert.equal((w.engine as unknown as { matchReflex(text: string): unknown }).matchReflex("click Safari"), undefined);
  w.brain.resolve?.({ status: "done", summary: "Try the budget." });
});

test("explicit lesson start opens native voice; settled microphone fragments reach checks and switching ends it", async (t) => {
  const { world } = await import("./world.ts");
  const w = world(); t.after(() => w.engine.stop());
  await w.engine.start(); await w.engine.ready();
  const send = (command: Omit<WorkCommand, "requestId">) => w.engine.command({ type: "work.command", command: { ...command, requestId: randomUUID() } });
  await send({ action: "start", mode: "study" });
  await send({ action: "lesson.prepare" });
  assert.equal(w.live.config, undefined, "preparing a problem is silent and cannot wake the mic");
  const pending = w.engine.work.store.state().active!.pendingPlan!;
  await send({ action: "scene.save", revision: 0, scene });
  await send({ action: "board.applied", planId: pending.id, success: true });
  await send({ action: "lesson.begin" });
  assert.equal(w.live.currentState, "started");
  assert.match(w.live.config!.instructions!, /Current learning tool/);
  assert.ok(w.live.instructions.some((text) => text.includes("What would you try first?")));
  w.live.emit("inputTranscript", " the price is", 0, 400);
  w.live.emit("inputTranscript", " two", 400, 700);
  assert.equal(w.engine.work.store.state().evidence.length, 0, "partial transcripts cannot be submitted");
  w.live.nowMs = 3000;
  (w.engine as unknown as { tick(): void }).tick();
  assert.equal(w.engine.work.store.state().evidence.length, 1);
  assert.equal(w.engine.work.store.state().evidence[0]!.correct, false);
  assert.ok(w.live.instructions.some((text) => text.includes("Application check") && text.includes("does not satisfy")));
  (w.engine as unknown as { tick(): void }).tick();
  assert.equal(w.engine.work.store.state().evidence.length, 1);
  await send({ action: "start", mode: "exam" });
  assert.equal(w.live.currentState, "closed", "switching tools ends the explicit lesson mic");
  w.live.emit("inputTranscript", " the price is two", 4000, 4500);
  (w.engine as unknown as { tick(): void }).tick();
  assert.equal(w.engine.work.store.state().evidence.length, 1, "an old voice session cannot answer the new exercise");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import type { CalendarReadRequest, CalendarReadResult } from "@hormes/protocol";
import { CalendarReader } from "../calendar-reader.ts";
import { world } from "./world.ts";

const receipt = (id: string): CalendarReadResult => ({ id, ok: true, permission: "granted", timeZone: "America/New_York", startsAt: 1791691200000, endsAt: 1791777600000, readAt: 1791744000000, calendars: [{ id: "real", title: "School", account: "iCloud" }], events: [], truncated: false });

test("real Engine runner awaits native calendar receipt without opening or changing selected calendars", { skip: process.platform !== "darwin" && "EventKit is the Mac's; elsewhere read_calendar is the planner's (planner.test.ts)" }, async t => {
  const w = world(); t.after(() => w.engine.stop()); await w.engine.start(); await w.engine.ready();
  const before = w.engine.work.store.state().selectedCalendarIds;
  let requested: CalendarReadRequest | undefined;
  w.engine.on("event", event => { if (event.type === "calendar.read") requested = event.request; });
  const result = w.engine.runner.run("read_calendar", {});
  assert.ok(requested); assert.deepEqual(requested.calendarIds, []); assert.equal(requested.days, 1);
  await w.engine.command({ type: "calendar.result", result: receipt(requested.id) });
  const output = (await result).result; assert.equal(output.kind, "text");
  if (output.kind !== "text") throw new Error("Expected native receipt");
  const data = JSON.parse(output.text); assert.equal(data.source, "macOS EventKit fresh read"); assert.deepEqual(data.events, []);
  assert.equal(data.permission, "granted"); assert.equal(data.timeZone, "America/New_York"); assert.equal(data.readAt, 1791744000000);
  assert.deepEqual(w.engine.work.store.state().selectedCalendarIds, before);
});

test("calendar query correlates current requests, preserves selections and aborts or times out honestly", async () => {
  const sent: CalendarReadRequest[] = [], selected = ["chosen"];
  const reader = new CalendarReader(request => sent.push(request), () => selected, 10);
  const control = new AbortController(), cancelled = reader.read({ days: 2 }, control.signal);
  assert.deepEqual(sent[0]!.calendarIds, selected);
  reader.receive(receipt("unrelated")); control.abort(); await assert.rejects(cancelled, /cancelled/);
  reader.receive(receipt(sent[0]!.id));
  await assert.rejects(reader.read({ startDate: "2026-10-11", days: 1 }), /Mac app did not answer/);
  assert.deepEqual(selected, ["chosen"]); reader.close();
});

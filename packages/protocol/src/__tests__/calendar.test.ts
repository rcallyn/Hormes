import { test } from "node:test";
import assert from "node:assert/strict";
import { isCalendarReadRequest, isCalendarReadResult, isEngineCommand, type CalendarReadResult } from "../index.ts";
const request = { id: "query", days: 1, calendarIds: [] };
const result: CalendarReadResult = { id: "query", ok: true, permission: "granted", timeZone: "America/New_York", startsAt: 1000, endsAt: 2000, readAt: 3000, calendars: [{ id: "school", title: "Classes", account: "Local" }], events: [{ id: "class", title: "Microeconomics", startsAt: 1200, endsAt: 1400, calendar: "Classes", sourceCalendarId: "school", allDay: false }], truncated: false };
test("native calendar request accepts bounded real dates, rejects invalid or unbounded queries", () => {
  assert.equal(isCalendarReadRequest(request), true);
  assert.equal(isCalendarReadRequest({ ...request, startDate: "2028-02-29", days: 7 }), true);
  for (const patch of [{ days: 0 }, { days: 8 }, { days: 1.5 }, { startDate: "2026-02-30" }, { startDate: "tomorrow" }, { calendarIds: [""] }, { calendarIds: Array(201).fill("x") }]) assert.equal(isCalendarReadRequest({ ...request, ...patch }), false);
});
test("calendar.result payload is validated at engine command boundary", () => {
  assert.equal(isEngineCommand({ type: "calendar.result", result }), true);
  for (const patch of [{ readAt: undefined }, { readAt: NaN }, { startsAt: Infinity }, { endsAt: 0 }, { permission: "yes" }, { events: Array(201).fill(result.events[0]) }, { calendars: Array(201).fill(result.calendars[0]) }]) assert.equal(isEngineCommand({ type: "calendar.result", result: { ...result, ...patch } }), false);
  assert.equal(isEngineCommand({ type: "calendar.result" }), false);
});
test("calendar receipts cannot mix unavailable calendars or out-of-range event claims", () => {
  for (const patch of [{ sourceCalendarId: "other" }, { startsAt: NaN }, { startsAt: 2200, endsAt: 2400 }, { endsAt: 1100 }]) assert.equal(isCalendarReadResult({ ...result, events: [{ ...result.events[0], ...patch }] }), false);
  assert.equal(isCalendarReadResult({ ...result, events: [{ ...result.events[0], startsAt: 0, endsAt: 2500, allDay: true }] }), true);
});
test("failed calendar reads require an honest error and cannot supply usable event claims", () => {
  assert.equal(isCalendarReadResult({ ...result, ok: false, error: "Calendar read access unavailable", permission: "denied", events: [] }), true);
  assert.equal(isCalendarReadResult({ ...result, ok: false, error: "Denied" }), false);
  assert.equal(isCalendarReadResult({ ...result, ok: false, events: [] }), false);
});

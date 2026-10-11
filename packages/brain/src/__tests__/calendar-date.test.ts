import { test } from "node:test";
import assert from "node:assert/strict";
import { calendarClockContext, calendarRangeMatches, calendarUserWords, resolveCalendarQuery } from "../calendar-query.ts";
import { makeRunner, makeSink, makeTask } from "./fakes.ts";
import { CalendarReader } from "../../../engine/src/calendar-reader.ts";
import type { CalendarReadRequest, CalendarReadResult } from "@hormes/protocol";

const now = Date.parse("2026-10-12T02:00:00Z"), zone = "America/New_York"; // still Oct 11 on this Mac
const oldModel = { startDate: "2024-06-11", days: 7 };
const realReceipt = (id: string, startDate: string, days: number): CalendarReadResult => {
  const start = Date.parse(`${startDate}T00:00:00-04:00`);
  return { id, ok: true, permission: "granted", timeZone: zone, startsAt: start, endsAt: start + days * 86400000, readAt: now, calendars: [], events: [], truncated: false };
};

test("relative Calendar dates override an invented absolute date using the current local day", () => {
  for (const [words, startDate, days] of [["What is on my calendar today?", "2026-10-11", 1], ["What about tomorrow?", "2026-10-12", 1], ["Show my current week", "2026-10-05", 7], ["What is on this week?", "2026-10-05", 7], ["Next week?", "2026-10-12", 7], ["Today, actually tomorrow", "2026-10-12", 1]] as const) {
    assert.deepEqual(resolveCalendarQuery(oldModel, words, now, zone), { startDate, days }, words);
  }
  assert.deepEqual(resolveCalendarQuery(oldModel, "What does my schedule look like?", now, zone), { startDate: "2026-10-11", days: 1 });
  assert.throws(() => resolveCalendarQuery(oldModel, "Today and tomorrow", now, zone), /one Calendar start date/, "ambiguous joined range must not silently omit a day");
});

test("the latest original user utterance owns the date, never screen text or a model paraphrase", () => {
  const words = calendarUserWords({ request: "Read June 11, 2024", userDialogue: "What was on June 11, 2024?\nActually what is on my calendar today?" });
  assert.deepEqual(resolveCalendarQuery(oldModel, words, now, zone), { startDate: "2026-10-11", days: 1 });
  assert.equal(calendarUserWords({ request: "Read tomorrow" }), "Read tomorrow", "app-authored requests retain their fallback");
});

test("genuinely requested historical dates remain supported and invalid dates are rejected", () => {
  for (const words of ["Show June 11, 2024", "Show 2024-06-11"]) assert.deepEqual(resolveCalendarQuery({ startDate: "2026-10-11", days: 2 }, words, now, zone), { startDate: "2024-06-11", days: 2 });
  assert.throws(() => resolveCalendarQuery({}, "Show February 30, 2026", now, zone), /valid local startDate/);
  for (const unsupported of ["Show next month", "In 12 days", "On the fifth of November"]) assert.throws(() => resolveCalendarQuery(oldModel, unsupported, now, zone), /name the Calendar date/);
});

test("native range validation accepts DST calendar days and rejects fresh receipts for the wrong day", () => {
  const receipt = realReceipt("read", "2026-10-11", 1);
  assert.ok(calendarRangeMatches(receipt, { startDate: "2026-10-11", days: 1 }));
  assert.equal(calendarRangeMatches({ ...receipt, startsAt: 1718078400000, endsAt: 1718164800000 }, { startDate: "2026-10-11", days: 1 }), false);
  assert.equal(calendarRangeMatches({ ...receipt, startsAt: receipt.startsAt + 3600000 }, { startDate: "2026-10-11", days: 1 }), false);
  assert.ok(calendarRangeMatches({ ...receipt, startsAt: Date.parse("2026-03-08T00:00:00-05:00"), endsAt: Date.parse("2026-03-09T00:00:00-04:00") }, { startDate: "2026-03-08", days: 1 }));
  assert.ok(calendarRangeMatches({ ...receipt, startsAt: Date.parse("2026-11-01T00:00:00-04:00"), endsAt: Date.parse("2026-11-02T00:00:00-05:00") }, { startDate: "2026-11-01", days: 1 }));
});

test("production runner and CalendarReader bind today's query and verify the correlated local-day receipt", async t => {
  const sent: CalendarReadRequest[] = [];
  let wrongRange = false;
  const reader = new CalendarReader(request => { sent.push(request); queueMicrotask(() => reader.receive(realReceipt(request.id, wrongRange ? "2024-06-11" : request.startDate!, request.days))); }, () => ["chosen"]);
  t.after(() => reader.close());
  const { runner } = makeRunner({ now: () => now, readCalendar: (query, signal) => reader.read(query, signal) });
  // Production resolves the daemon's actual local zone; use a local 15:00 clock for this integration assertion.
  const localNow = new Date(2026, 9, 11, 15).getTime();
  const localFixture = makeRunner({ now: () => localNow, readCalendar: (query, signal) => reader.read(query, signal) });
  localFixture.runner.attach(makeSink().sink, makeTask("Get the calendar for 2024-06-11", undefined, { userDialogue: "What is on my calendar today?" }));
  const result = (await localFixture.runner.run("read_calendar", oldModel)).result;
  assert.equal(result.kind, "text", JSON.stringify(result));
  assert.equal(sent[0]!.startDate, "2026-10-11"); assert.equal(sent[0]!.days, 1); assert.deepEqual(sent[0]!.calendarIds, ["chosen"]);
  if (result.kind === "text") { const data = JSON.parse(result.text); assert.equal(data.startsAt, Date.parse("2026-10-11T00:00:00-04:00")); assert.deepEqual(data.requestedRange, { startDate: "2026-10-11", days: 1 }); }
  wrongRange = true;
  runner.attach(makeSink().sink, makeTask("Read today", undefined, { userDialogue: "Calendar today" }));
  const bad = (await runner.run("read_calendar", oldModel)).result;
  assert.equal(bad.kind, "error"); if (bad.kind === "error") assert.match(bad.message, /different date range/);
});

test("current-date context is local, identifies its timezone and preserves relative words", () => {
  const prompt = calendarClockContext(now, zone);
  assert.match(prompt, /2026-10-11 \(America\/New_York\)/);
  assert.match(prompt, /For Calendar or schedule questions only: preserve the user's relative date words/);
});


test("clock context qualifies Calendar guidance and cannot impose a date-only answer on grocery work", async () => {
  const { delegationPrompt } = await import("../anthropic.ts");
  const request = "Read work.context and prepare my requested groceries in Instacart. Never checkout or buy.";
  const prompt = delegationPrompt({ ...makeTask(request), interactionMode: "general", work: { mode: "grocery", sessionId: "grocery" } });
  assert.ok(prompt.includes(`User said: "${request}"`), "the original actionable request remains intact");
  assert.match(prompt, /reference context for dates; continue the current user request without reciting the clock unless asked/);
  assert.match(prompt, /For Calendar or schedule questions only: preserve the user's relative date words/);
  assert.doesNotMatch(prompt, /Report only the returned date range/, "unrelated work cannot receive a blanket Calendar-only response instruction");
  assert.equal(resolveCalendarQuery({ startDate: "2024-06-11" }, "What is on my calendar today?", now, zone).startDate, "2026-10-11", "application-owned relative dates remain enforced independently of prompt wording");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRunner } from "./fakes.ts";

test("native calendar tools reject malformed date/range and preserve real permission failures", async () => {
  const calls: unknown[] = [];
  const { runner } = makeRunner({ readCalendar: async query => { calls.push(query); return { id: "test", ok: false, permission: "denied", error: "Calendar full access was denied by macOS.", timeZone: "UTC", startsAt: 0, endsAt: 1, readAt: 0, calendars: [], events: [], truncated: false }; } });
  for (const bad of [{ days: 8 }, { days: 0 }, { days: 1.5 }, { startDate: "2026-02-30" }, { startDate: "tomorrow" }]) assert.equal((await runner.run("read_calendar", bad)).result.kind, "error");
  assert.equal(calls.length, 0);
  const result = (await runner.run("read_calendar", { startDate: "2026-10-11", days: 2 })).result;
  assert.deepEqual(calls, [{ startDate: "2026-10-11", days: 2 }]);
  assert.equal(result.kind, "error"); if (result.kind === "error") assert.match(result.message, /denied by macOS/);
});

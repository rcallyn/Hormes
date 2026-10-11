import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyToolScope } from "@hormes/core";
import { WorkCoordinator } from "../work/coordinator.ts";
import { makeRunner, makeTask, makeSink, FakeHands } from "../../../brain/src/__tests__/fakes.ts";

for (const mode of ["study", "grocery", "meeting", "class"] as const) test(`general schedule query after ${mode} keeps saved work and uses native Calendar`, async t => {
  const dir = mkdtempSync(join(tmpdir(), "hormes-work-calendar-"));
  const work = new WorkCoordinator({ stateDir: dir, lane: () => undefined, emit: () => {}, redact: x => x });
  t.after(async () => { await work.stop(); rmSync(dir, { recursive: true, force: true }); });
  work.store.command({ action: "start", requestId: "start", mode });
  if (mode === "grocery") work.store.command({ action: "grocery.import", requestId: "list", text: "Eggs" });
  const before = work.store.state();
  // Folding the native surface does not mutate WorkStore; no lesson binding is supplied.
  const task = work.enrich(makeTask("What is on my calendar today?", undefined, { userDialogue: "What is on my calendar today?" }));
  assert.equal(task.work?.mode, mode, "preserve original task scope instead of granting general execution");
  let reads = 0, hands = 0;
  class Hands extends FakeHands { override async request<T>(op: string): Promise<T> { hands++; return super.request<T>(op); } }
  const { runner } = makeRunner({ now: () => new Date(2026, 9, 11, 15).getTime(), work, readCalendar: async () => {
    reads++;
    return { id: "read", ok: true, permission: "granted", timeZone: "America/New_York", startsAt: Date.parse("2026-10-11T00:00:00-04:00"), endsAt: Date.parse("2026-10-12T00:00:00-04:00"), readAt: Date.parse("2026-10-11T15:00:00-04:00"), calendars: [{ id: "actual", title: "Personal", account: "Local" }], events: [{ id: "event", title: "Evening meeting", startsAt: Date.parse("2026-10-11T17:00:00-04:00"), endsAt: Date.parse("2026-10-11T18:00:00-04:00"), calendar: "Personal", sourceCalendarId: "actual", allDay: false }], truncated: false };
  } }, new Hands());
  runner.attach(makeSink().sink, task);
  const outcome = await runner.run("read_calendar", {});
  assert.equal(outcome.result.kind, "text", JSON.stringify(outcome.result));
  if (outcome.result.kind === "text") assert.match(outcome.result.text, /Evening meeting/);
  assert.equal(reads, 1); assert.equal(hands, 0, "native Calendar query does not infer Notes/frontmost UI or open apps");
  assert.deepEqual(work.store.state(), before, "no scene, transcript, plan, source, selected calendar or session state changes");
  for (const forbidden of ["open_app", "left_click", "run_shell", "web_fetch", "agent_start"]) {
    if (mode === "study" && forbidden === "web_fetch") continue; // existing read-only learning source capability
    assert.equal((await runner.run(forbidden, {})).result.kind, "error", forbidden);
  }
  assert.equal(hands, 0);
  assert.match(task.workInstructions!, /read_calendar/, "application guidance explicitly supports native schedule questions");
  if (mode === "class") {
    assert.doesNotMatch(task.workContext ?? "", /This is a class question/, "the saved class does not decide what the user is asking now");
    assert.doesNotMatch(task.workInstructions!, /give one brief spoken explanation/, "saved class context does not activate a lecture question interaction");
  }
});
test("native calendar read exception does not expand suggested-agent review", () => {
  assert.equal(classifyToolScope("read_calendar", {}, "agent-1", { sessionId: "grocery", mode: "grocery" }).verdict, "refuse");
});

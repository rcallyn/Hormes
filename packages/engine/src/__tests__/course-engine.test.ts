import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir, world } from "./world.ts";

type Nudger = { nudgeCourses(now: number): Promise<void> };
const notifies = (events: readonly { type: string }[]) => events.filter((e) => e.type === "notify") as unknown as { title: string; body?: string; automationId: string }[];

test("engine: with a course folder, homework due today reaches every client as a notification once; the courseNudges setting turns it off", async (t) => {
  const root = join(tempDir("hormes-course-engine-"), "Courses");
  mkdirSync(join(root, "CS 161 - Operating Systems", "Homework"), { recursive: true });
  writeFileSync(join(root, "CS 161 - Operating Systems", "Homework", "hw2.md"), "Homework 2: round robin scheduling");
  process.env["HORMES_COURSES_DIR"] = root;
  t.after(() => { delete process.env["HORMES_COURSES_DIR"]; });
  const w = world();
  t.after(() => w.engine.stop());
  const nine = new Date(); nine.setHours(9, 0, 0, 0);
  w.clock.t = nine.getTime();
  const today = `${nine.getFullYear()}-${String(nine.getMonth() + 1).padStart(2, "0")}-${String(nine.getDate()).padStart(2, "0")}`;
  await w.engine.planner.tool("add_todo", { title: "CS 161 HW2", dueDate: today });

  const engine = w.engine as unknown as Nudger;
  await engine.nudgeCourses(w.clock.t);
  const first = notifies(w.events);
  assert.ok(first.some((n) => n.title === "CS 161 HW2 is due today" && /hw2\.md/.test(n.body ?? "")), JSON.stringify(first));
  assert.ok(first.some((n) => n.title === "Your school day"));
  assert.ok(first.every((n) => n.automationId === ""), "no automation row behind a course nudge");

  await engine.nudgeCourses(w.clock.t + 60_000);
  assert.equal(notifies(w.events).length, first.length, "each item once");

  await w.engine.command({ type: "set-settings", patch: { courseNudges: false } });
  await w.engine.planner.tool("add_todo", { title: "CS 161 HW3", dueDate: today });
  await engine.nudgeCourses(w.clock.t + 120_000);
  assert.equal(notifies(w.events).length, first.length, "off means off");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { CourseNudger, courseNamed, courseNudges, MAX_PER_DAY, type CourseInfo } from "../courses/index.ts";

const cs: CourseInfo = { id: "cs-161", title: "Operating Systems", code: "CS 161", aliases: ["CS 161 - Operating Systems"], dir: "/c/cs" };
const econ: CourseInfo = { id: "micro", title: "Intermediate Microeconomics", code: "ECON 201", aliases: ["Microeconomics", "micro"], dir: "/c/econ" };
const courses = [cs, econ];
const local = (s: string): number => new Date(s).getTime();

test("a course is named by code, title or alias, loosely", () => {
  assert.equal(courseNamed(courses, "CS161 lecture")?.id, "cs-161");
  assert.equal(courseNamed(courses, "Micro midterm")?.id, "micro");
  assert.equal(courseNamed(courses, "Dentist"), undefined);
});

test("a class starting within 15 minutes is nudged with the last lecture and what is due next", () => {
  const out = courseNudges({
    now: local("2026-10-12T09:50:00"), courses, seen: new Set(),
    agenda: { todos: [{ id: "t1", title: "CS 161 HW2", done: false, dueDate: "2026-10-14" }], events: [{ id: "e1", title: "CS 161 lecture", date: "2026-10-05", time: "10:00", recurrence: { freq: "weekly", interval: 1 } }, { id: "e2", title: "CS 161 lecture later", date: "2026-10-12", time: "14:00" }] },
    lastLecture: () => "lec05-paging.pptx",
  }).filter(n => !n.key.startsWith("brief:"));
  assert.equal(out.length, 1);
  assert.equal(out[0]!.title, "CS 161 lecture starts in 10 min");
  assert.match(out[0]!.body, /Last lecture: lec05-paging\.pptx\. Due next: CS 161 HW2 \(2026-10-14\)\. Say "prep me for class"/);
  assert.equal(out[0]!.course, "cs-161");
});

test("homework: due tomorrow from 5 pm, due today from 8 am, with the matching file; done and unrelated todos are not", () => {
  const agenda = { events: [], todos: [
    { id: "t1", title: "CS 161 HW2", done: false, dueDate: "2026-10-13" },
    { id: "t2", title: "ECON 201 problem set 4", done: false, dueDate: "2026-10-12" },
    { id: "t3", title: "CS 161 HW1", done: true, dueDate: "2026-10-13" },
    { id: "t4", title: "Buy milk", done: false, dueDate: "2026-10-13" },
    { id: "t5", title: "Essay draft", done: false, dueDate: "2026-10-13", category: "school" as const },
  ] };
  const homeworkFor = (todo: { title: string }) => todo.title.includes("HW2") ? { course: "cs-161", file: "CS 161/Homework/hw2.pdf", kind: "homework" as const, loc: "page 1", score: 3, text: "" } : undefined;
  const morning = courseNudges({ now: local("2026-10-12T09:00:00"), courses, agenda, seen: new Set(["brief:2026-10-12"]), homeworkFor });
  assert.deepEqual(morning.map(n => n.title), ["ECON 201 problem set 4 is due today"]);
  const evening = courseNudges({ now: local("2026-10-12T18:00:00"), courses, agenda, seen: new Set(["brief:2026-10-12"]), homeworkFor });
  assert.deepEqual(evening.map(n => n.title), ["CS 161 HW2 is due tomorrow", "ECON 201 problem set 4 is due today", "Essay draft is due tomorrow"]);
  assert.match(evening[0]!.body, /Hormes has hw2\.pdf from your CS 161 folder/);
});

test("an exam one to three days out is nudged from 9 am", () => {
  const agenda = { todos: [], events: [{ id: "x", title: "Micro midterm", date: "2026-10-14", time: "10:00" }] };
  assert.deepEqual(courseNudges({ now: local("2026-10-12T08:00:00"), courses, agenda, seen: new Set() }), []);
  const out = courseNudges({ now: local("2026-10-12T09:30:00"), courses, agenda, seen: new Set() });
  assert.equal(out[0]!.title, "Micro midterm in 2 days");
  assert.match(out[0]!.body, /study guide from your ECON 201 slides/);
});

test("the nudger says each item once and stops at the daily cap; a new day resets the cap, not the memory", () => {
  const files = new Map<string, string>();
  const todos = Array.from({ length: MAX_PER_DAY + 2 }, (_, i) => ({ id: `t${i}`, title: `CS 161 HW${i}`, done: false, dueDate: "2026-10-12" }));
  const make = () => new CourseNudger("/n.json", (p, t) => files.set(p, t), (p) => files.get(p));
  const input = (now: number) => ({ now, courses, agenda: { todos, events: [] } });
  assert.equal(make().take(input(local("2026-10-12T09:00:00"))).length, MAX_PER_DAY);
  assert.equal(make().take(input(local("2026-10-12T10:00:00"))).length, 0, "the cap persists across a restart");
  todos.forEach(t => { (t as { dueDate: string }).dueDate = "2026-10-13"; });
  const next = make().take(input(local("2026-10-13T09:00:00")));
  assert.equal(next.length, MAX_PER_DAY, "a new due date is a new item");
  assert.equal(make().take(input(local("2026-10-13T11:00:00"))).length, 0, "the cap holds the rest until tomorrow");
});

test("the morning brief lists today's classes and what is due by tomorrow, once, from 7 am; an empty day says nothing", () => {
  const agenda = { todos: [{ id: "t1", title: "CS 161 HW2", done: false, dueDate: "2026-10-13" }, { id: "t2", title: "Buy milk", done: false, dueDate: "2026-10-12" }], events: [{ id: "e1", title: "CS 161 lecture", date: "2026-10-12", time: "10:00" }, { id: "e2", title: "Dentist", date: "2026-10-12", time: "15:00" }] };
  assert.equal(courseNudges({ now: local("2026-10-12T06:30:00"), courses, agenda, seen: new Set() }).length, 0);
  const brief = courseNudges({ now: local("2026-10-12T07:05:00"), courses, agenda, seen: new Set() }).find(n => n.key === "brief:2026-10-12");
  assert.equal(brief?.body, "Classes: CS 161 lecture 10:00. Due: CS 161 HW2 (tomorrow).");
  assert.equal(courseNudges({ now: local("2026-10-12T07:05:00"), courses, agenda, seen: new Set(["brief:2026-10-12"]) }).length, 0);
  assert.equal(courseNudges({ now: local("2026-10-12T07:05:00"), courses, agenda: { todos: [], events: [] }, seen: new Set() }).length, 0);
});

test("new course downloads get one nudge for the set; unmatched or old ones none", () => {
  const now = local("2026-10-12T14:00:00");
  const one = courseNudges({ now, courses, agenda: { todos: [], events: [] }, seen: new Set(), downloads: [{ name: "cs161_hw3.pdf", modified: now - 3600_000, course: "cs-161" }, { name: "receipt.pdf", modified: now - 3600_000 }, { name: "old.pdf", modified: now - 5 * 86_400_000, course: "cs-161" }] });
  assert.equal(one.length, 1);
  assert.equal(one[0]!.title, "cs161_hw3.pdf looks like CS 161 material");
  assert.match(one[0]!.body, /file my downloads/);
});

test("after a class: notes from today's transcript while it is fresh, or what is next; once, within 30 minutes of the end", () => {
  const agenda = { todos: [], events: [{ id: "e1", title: "CS 161 lecture", date: "2026-10-12", time: "09:00", endTime: "10:15" }] };
  const run = (at: string, transcript?: string) => courseNudges({ now: local(at), courses, agenda, seen: new Set(["brief:2026-10-12"]), transcriptOn: () => transcript });
  assert.equal(run("2026-10-12T10:10:00").length, 0, "still in class");
  const after = run("2026-10-12T10:20:00", "2026-10-12 0900 CS 161 lecture.md");
  assert.equal(after[0]!.title, "CS 161 lecture is over");
  assert.match(after[0]!.body, /today's transcript \(2026-10-12 0900 CS 161 lecture\.md\)/);
  assert.match(run("2026-10-12T10:20:00")[0]!.body, /where was I/);
  assert.equal(run("2026-10-12T11:00:00").length, 0, "stale after 30 minutes");
});

test("the evening brief names tomorrow's classes and what is due tomorrow, once, from 9 pm", () => {
  const agenda = { todos: [{ id: "t1", title: "CS 161 HW2", done: false, dueDate: "2026-10-13" }], events: [{ id: "e1", title: "CS 161 lecture", date: "2026-10-13", time: "09:00" }] };
  assert.equal(courseNudges({ now: local("2026-10-12T20:30:00"), courses, agenda, seen: new Set(["brief:2026-10-12"]) }).filter(n => n.key.startsWith("evening:")).length, 0);
  const evening = courseNudges({ now: local("2026-10-12T21:05:00"), courses, agenda, seen: new Set(["brief:2026-10-12"]) }).find(n => n.key === "evening:2026-10-12");
  assert.equal(evening?.body, "Classes: CS 161 lecture 09:00. Due: CS 161 HW2. Say \"prep me for tomorrow\" for a recap.");
});

test("download nudges announce each file once: a later download names only itself", () => {
  const nudger = new CourseNudger("/dl.json", () => undefined, () => undefined);
  const now = local("2026-10-12T14:00:00");
  const a = { name: "cs161_hw3.pdf", modified: now - 3_600_000, course: "cs-161" }, b = { name: "cs161_lec7.pdf", modified: now - 60_000, course: "cs-161" };
  const first = nudger.take({ now, courses, agenda: { todos: [], events: [] }, downloads: [a] });
  assert.equal(first.length, 1);
  const second = nudger.take({ now: now + 60_000, courses, agenda: { todos: [], events: [] }, downloads: [a, b] });
  assert.equal(second.length, 1);
  assert.equal(second[0]!.title, "cs161_lec7.pdf looks like CS 161 material");
  assert.equal(nudger.take({ now: now + 120_000, courses, agenda: { todos: [], events: [] }, downloads: [b] }).length, 0, "an import that drops a file from the inbox repeats nothing");
});

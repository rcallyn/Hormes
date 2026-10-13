import { eventsBetween, type PlannerEvent, type PlannerTodo } from "@hormes/protocol";
import type { Agenda, CourseInfo, SearchHit } from "./library.ts";

/**
 * Course nudges: the passive reminders that save User the "what's next?" step. A class about to start, homework
 * due tomorrow evening or this morning, an exam in the next three days. Each is a notification only: it opens no
 * voice session, runs no tool and changes nothing; acting on it is User's next request. Each item is nudged once,
 * at most `MAX_PER_DAY` a day.
 */
export interface CourseNudge { readonly key: string; readonly title: string; readonly body: string; readonly course?: string }
export interface NudgeInput {
  readonly now: number;
  readonly courses: readonly CourseInfo[];
  readonly agenda: Agenda;
  readonly seen: ReadonlySet<string>;
  /** The best homework file for a todo, and the newest lecture of a course (the library's search). */
  readonly homeworkFor?: (todo: PlannerTodo, course: CourseInfo | undefined) => SearchHit | undefined;
  readonly lastLecture?: (course: CourseInfo) => string | undefined;
}
export const MAX_PER_DAY = 6;
const CLASS_LEAD_MS = 15 * 60_000;
const EXAM = /\b(midterm|final|exam|quiz|test)\b/i;

const pad = (n: number): string => String(n).padStart(2, "0");
const day = (ms: number): string => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const at = (date: string, time: string): number => new Date(`${date}T${time || "00:00"}:00`).getTime();
const short = (s: string, n = 60): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s).replace(/[\r\n]+/g, " ");

/** The course an agenda title names (title, code or alias), else undefined. */
export function courseNamed(courses: readonly CourseInfo[], title: string): CourseInfo | undefined {
  const t = title.toLowerCase(), squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  return courses.find(c => [c.code ?? "", c.title, ...c.aliases].some(n => n.length >= 3 && (t.includes(n.toLowerCase()) || (squash(n).length >= 4 && squash(title).includes(squash(n))))));
}

export function courseNudges(input: NudgeInput): CourseNudge[] {
  const { now, courses, agenda, seen } = input;
  const today = day(now), tomorrow = day(now + 86_400_000), hour = new Date(now).getHours();
  const out: CourseNudge[] = [];
  const add = (n: CourseNudge): void => { if (!seen.has(n.key) && !out.some(o => o.key === n.key)) out.push(n); };
  const schoolish = (e: { title: string; category?: string }): CourseInfo | undefined | false => courseNamed(courses, e.title) ?? (e.category === "school" ? undefined : false);
  const label = (c: CourseInfo | undefined, fallback: string): string => c ? (c.code ?? c.title) : fallback;
  const dueSoon = (c: CourseInfo | undefined): PlannerTodo | undefined => c ? agenda.todos.filter(t => !t.done && t.dueDate && t.dueDate >= today && courseNamed([c], t.title)).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))[0] : undefined;

  const events = eventsBetween(agenda.events, today, day(now + 3 * 86_400_000));

  // The morning brief: today's classes and what is due by tomorrow, once, from 7 am. Nothing when the day is empty.
  if (hour >= 7) {
    const classes = events.filter(e => e.date === today && e.time && !e.done && schoolish(e) !== false).map(e => `${short(e.title, 30)} ${e.time}`);
    const due = agenda.todos.filter(t => !t.done && (t.dueDate === today || t.dueDate === tomorrow) && (courseNamed(courses, t.title) || t.category === "school"))
      .map(t => `${short(t.title, 30)} (${t.dueDate === today ? "today" : "tomorrow"})`);
    if (classes.length || due.length) add({ key: `brief:${today}`, title: "Your school day", body: [classes.length && `Classes: ${classes.slice(0, 4).join(", ")}.`, due.length && `Due: ${due.slice(0, 4).join(", ")}.`].filter(Boolean).join(" ") });
  }
  for (const e of events as PlannerEvent[]) {
    const course = schoolish(e);
    if (course === false || e.done) continue;
    const start = at(e.date, e.time);
    if (EXAM.test(e.title)) {
      const days = Math.round((at(e.date, "00:00") - at(today, "00:00")) / 86_400_000);
      if (days >= 1 && days <= 3 && hour >= 9) add({ key: `exam:${e.id}:${today}`, title: `${short(e.title)} in ${days} day${days === 1 ? "" : "s"}`, body: `Ask Hormes for a study guide from your ${label(course, "course")} slides, or "quiz me" for practice questions.`, ...(course ? { course: course.id } : {}) });
      continue;
    }
    if (e.time && start > now && start - now <= CLASS_LEAD_MS) {
      const mins = Math.max(1, Math.round((start - now) / 60_000));
      const last = course ? input.lastLecture?.(course) : undefined, due = dueSoon(course);
      const parts = [last && `Last lecture: ${short(last, 50)}.`, due && `Due next: ${short(due.title, 40)}${due.dueDate ? ` (${due.dueDate})` : ""}.`, `Say "prep me for class" for a one-minute recap.`].filter(Boolean);
      add({ key: `class:${e.id}:${e.date}`, title: `${short(e.title)} starts in ${mins} min`, body: parts.join(" "), ...(course ? { course: course.id } : {}) });
    }
  }

  for (const t of agenda.todos) {
    if (t.done || !t.dueDate) continue;
    const course = courseNamed(courses, `${t.title} ${t.description ?? ""}`);
    if (!course && t.category !== "school") continue;
    const when = t.dueDate === tomorrow && hour >= 17 ? "tomorrow" : t.dueDate === today && hour >= 8 ? "today" : undefined;
    if (!when) continue;
    const file = input.homeworkFor?.(t, course);
    add({ key: `due:${t.id}:${t.dueDate}:${when}`, title: `${short(t.title)} is due ${when}`, body: file ? `Hormes has ${short(file.file.split("/").pop()!, 50)} from your ${label(course, "course")} folder. Say "help me with ${short(t.title, 30)}" to start.` : `Say "help me with ${short(t.title, 30)}" and Hormes will pull up the slides that cover it.`, ...(course ? { course: course.id } : {}) });
  }
  return out;
}

interface NudgeLog { day: string; count: number; seen: string[] }

/** The stateful half: the once-per-item memory and the daily cap, persisted beside the index. */
export class CourseNudger {
  private log: NudgeLog;
  constructor(private readonly path: string, private readonly save: (path: string, text: string) => void, read: (path: string) => string | undefined) {
    let parsed: Partial<NudgeLog> = {};
    try { parsed = JSON.parse(read(path) ?? "{}") as Partial<NudgeLog>; } catch { /* a corrupt log starts over; the keys only stop repeats */ }
    this.log = { day: typeof parsed.day === "string" ? parsed.day : "", count: Number.isInteger(parsed.count) ? parsed.count! : 0, seen: Array.isArray(parsed.seen) ? parsed.seen.filter((k): k is string => typeof k === "string").slice(-500) : [] };
  }

  /** The nudges due now, marked seen and counted; at most what is left of today's cap. */
  take(input: Omit<NudgeInput, "seen">): CourseNudge[] {
    const today = day(input.now);
    if (this.log.day !== today) { this.log.day = today; this.log.count = 0; }
    const room = MAX_PER_DAY - this.log.count;
    if (room <= 0) return [];
    const due = courseNudges({ ...input, seen: new Set(this.log.seen) }).slice(0, room);
    if (!due.length) return [];
    this.log.count += due.length;
    this.log.seen = [...this.log.seen, ...due.map(n => n.key)].slice(-500);
    try { this.save(this.path, JSON.stringify(this.log)); } catch { /* in memory still stops repeats this run */ }
    return due;
  }
}

import { constants, mkdirSync, openSync, writeSync, closeSync } from "node:fs";
import { basename, join } from "node:path";
import type { CourseInfo, MaterialKind } from "./library.ts";

/** What Hormes writes for User into a course: notes, study guides, practice exams. New Markdown files only. */
export const SAVE_FOLDERS: Partial<Record<MaterialKind, string>> = { notes: "Notes", exam: "Exams", homework: "Homework", lecture: "Notes", reading: "Notes" };
export const MAX_SAVE_CHARS = 200_000;

/** Write `<course>/<Folder>/<title>.md` (a `(2)` suffix instead of overwriting). Returns the course-relative path. */
export function saveCourseNote(course: CourseInfo, kind: MaterialKind, title: string, text: string): string {
  if (!text.trim()) throw new Error("save needs non-empty text.");
  if (text.length > MAX_SAVE_CHARS) throw new Error(`save takes at most ${MAX_SAVE_CHARS} characters.`);
  const folder = SAVE_FOLDERS[kind] ?? "Notes";
  const stem = title.replace(/[^\p{L}\p{N} ._()&,'-]+/gu, "-").replace(/^[.\s-]+|[.\s]+$/g, "").slice(0, 100) || "Notes";
  const dir = join(course.dir, folder);
  mkdirSync(dir, { recursive: true });
  for (let n = 1; n < 100; n++) {
    const name = `${n === 1 ? stem : `${stem} (${n})`}.md`;
    let fd: number;
    try { fd = openSync(join(dir, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o644); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "EEXIST") continue; throw e; }
    try { writeSync(fd, text.endsWith("\n") ? text : `${text}\n`); } finally { closeSync(fd); }
    return [basename(course.dir), folder, name].join("/");
  }
  throw new Error(`Too many files named ${stem} in ${course.title}.`);
}

import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";
import { extractUnits } from "./extract.ts";
import type { CourseInfo, MaterialFile, MaterialKind } from "./library.ts";
import { materialKind } from "./library.ts";

/**
 * The course inbox: files that landed in Downloads lately (slides and homework fetched from Canvas or an email)
 * and look like a course's, by name or by the course's code or title in their first page. Filing one copies it
 * into the course folder (a subfolder by kind); the download stays, and nothing is ever overwritten.
 */
export interface InboxItem { readonly name: string; readonly bytes: number; readonly modified: number; readonly course?: string; readonly kind: MaterialKind; readonly why?: string }

const INBOX_EXTENSIONS = new Set([".pdf", ".pptx", ".docx", ".ipynb", ".md", ".txt", ".tex", ".zip"]);
const RECENT_MS = 14 * 86_400_000;
const FOLDER: Partial<Record<MaterialKind, string>> = { lecture: "Lectures", homework: "Homework", exam: "Exams", reading: "Readings", notes: "Notes", solution: "Solutions", lab: "Labs", transcript: "Transcripts" };
const SECRET_NAME = /^(?:\.env.*|.*\.(?:pem|key|p12|pfx)|id_(?:rsa|ed25519|ecdsa|dsa).*|credentials.*|secrets?\..*)$/i;

export function defaultDownloadsDir(): string {
  return process.env["HORMES_DOWNLOADS_DIR"]?.trim() || join(homedir(), "Downloads");
}

const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");
/** The course a name or a text names: its code first (CS161 in "cs161_hw3.pdf"), then its title or an alias. */
export function courseIn(courses: readonly CourseInfo[], text: string): CourseInfo | undefined {
  const s = squash(text);
  const names = (c: CourseInfo) => [c.code ?? "", c.title, ...c.aliases].map(squash).filter(n => n.length >= 4);
  return courses.find(c => c.code && squash(c.code).length >= 4 && s.includes(squash(c.code))) ?? courses.find(c => names(c).some(n => s.includes(n)));
}

/** cache: what a file's first page named, by name, size and time, so a minute's scan does not read it again. */
export async function scanInbox(dir: string, courses: readonly CourseInfo[], filed: readonly MaterialFile[], now: number, cache: Map<string, string> = new Map()): Promise<InboxItem[]> {
  if (!existsSync(dir)) return [];
  const have = new Set(filed.map(f => `${basename(f.path).toLowerCase()}:${f.size}`));
  const out: InboxItem[] = [];
  let names: string[];
  try { names = readdirSync(dir); } catch { return []; }
  for (const name of names) {
    if (name.startsWith(".") || SECRET_NAME.test(name) || !INBOX_EXTENSIONS.has(extname(name).toLowerCase())) continue;
    let st;
    try { st = lstatSync(join(dir, name)); } catch { continue; }
    if (!st.isFile() || st.isSymbolicLink() || now - st.mtimeMs > RECENT_MS || st.size > 80 * 1024 * 1024) continue;
    if (have.has(`${name.toLowerCase()}:${st.size}`)) continue;
    let course = courseIn(courses, name), why = course ? "its name" : undefined;
    if (!course && extname(name).toLowerCase() !== ".zip" && st.size <= 20 * 1024 * 1024) {
      const key = `${name}:${st.size}:${Math.round(st.mtimeMs)}:${courses.map(c => c.id).join(",")}`;
      let id = cache.get(key);
      if (id === undefined) {
        try {
          const first = (await extractUnits(join(dir, name))).slice(0, 2).map(u => u.text).join("\n").slice(0, 4000);
          id = courseIn(courses, first)?.id ?? "";
        } catch { id = ""; }
        if (cache.size > 500) cache.clear();
        cache.set(key, id);
      }
      course = courses.find(c => c.id === id);
      if (course) why = "its first page";
    }
    out.push({ name, bytes: st.size, modified: st.mtimeMs, ...(course ? { course: course.id } : {}), kind: materialKind(name), ...(why ? { why } : {}) });
  }
  return out.sort((a, b) => b.modified - a.modified).slice(0, 40);
}

/** Copy one download into a course folder (by kind). Returns the course-relative path; never overwrites. */
export function fileDownload(dir: string, name: string, course: CourseInfo, kind?: MaterialKind): string {
  if (name !== basename(name) || name.startsWith(".") || SECRET_NAME.test(name)) throw new Error(`${JSON.stringify(name)} is not a file name in Downloads.`);
  const from = join(dir, name);
  const st = lstatSync(from);
  if (!st.isFile() || st.isSymbolicLink()) throw new Error(`${name} is not a regular file in Downloads.`);
  const sub = FOLDER[kind ?? materialKind(name)];
  const target = sub ? join(course.dir, sub) : course.dir;
  mkdirSync(target, { recursive: true });
  const ext = extname(name), stem = name.slice(0, name.length - ext.length);
  for (let n = 1; n < 100; n++) {
    const candidate = n === 1 ? name : `${stem} (${n})${ext}`;
    try {
      copyFileSync(from, join(target, candidate), constants.COPYFILE_EXCL);
      return [basename(course.dir), sub, candidate].filter(Boolean).join("/");
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
  }
  throw new Error(`Too many copies of ${name} already in ${course.title}.`);
}

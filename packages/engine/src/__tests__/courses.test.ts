import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync, deflateSync } from "node:zlib";
import { CourseLibrary, docxUnits, materialKind, pdfUnitsBuiltin, pptxUnits, unzip } from "../courses/index.ts";

/** A real zip (deflate entries, central directory), as Office writes them. */
function zip(entries: Record<string, string>): Buffer {
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const raw = Buffer.from(text), data = deflateRawSync(raw), n = Buffer.from(name);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, n, data); centrals.push(central, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const slide = (...paras: string[]) => `<p:sld><p:txBody>${paras.map(p => `<a:p><a:r><a:t>${p}</a:t></a:r></a:p>`).join("")}</p:txBody></p:sld>`;
function pdf(text: string): Buffer {
  const content = deflateSync(Buffer.from(`BT /F1 12 Tf 72 720 Td (${text}) Tj T* [(Second) -300 (line)] TJ ET`, "latin1"));
  return Buffer.concat([Buffer.from(`%PDF-1.4\n4 0 obj\n<< /Length ${content.length} /Filter /FlateDecode >>\nstream\n`, "latin1"), content, Buffer.from("\nendstream\nendobj\n%%EOF\n", "latin1")]);
}

function library(): { root: string; lib: CourseLibrary } {
  const base = mkdtempSync(join(tmpdir(), "hormes-courses-"));
  const root = join(base, "Courses");
  const cs = join(root, "CS 161 - Operating Systems"), econ = join(root, "Microeconomics");
  mkdirSync(join(cs, "Lectures"), { recursive: true }); mkdirSync(join(cs, "Homework"), { recursive: true }); mkdirSync(econ, { recursive: true });
  writeFileSync(join(cs, "Lectures", "lec03-scheduling.pptx"), zip({
    "ppt/slides/slide1.xml": slide("CPU Scheduling", "Round robin uses a time quantum"),
    "ppt/slides/slide2.xml": slide("Shortest job first", "minimizes average waiting time"),
    "ppt/notesSlides/notesSlide2.xml": slide("2", "SJF needs burst estimates &amp; can starve long jobs"),
  }));
  writeFileSync(join(cs, "Homework", "hw2.md"), "# Homework 2\n\n1. Compute the average waiting time under round robin with quantum 4 for the given processes.\n");
  writeFileSync(join(cs, ".env"), "SECRET=1");
  writeFileSync(join(econ, "course.json"), JSON.stringify({ title: "Intermediate Microeconomics", code: "ECON 201", aliases: ["micro"] }));
  writeFileSync(join(econ, "syllabus.docx"), zip({ "word/document.xml": `<w:document><w:body><w:p><w:r><w:t>Midterm on October 20</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Office hours </w:t></w:r><w:r><w:t>Tuesday</w:t></w:r></w:p></w:body></w:document>` }));
  writeFileSync(join(econ, "notes-week1.pdf"), pdf("Consumer surplus is the area under demand"));
  const lib = new CourseLibrary({ stateDir: join(base, "state"), root, now: () => Date.parse("2026-10-12T12:00:00"), agenda: () => ({
    todos: [
      { id: "t1", title: "CS 161 HW2", done: false, dueDate: "2026-10-14" },
      { id: "t2", title: "ECON 201 problem set", done: false, dueDate: "2026-10-16" },
      { id: "t3", title: "CS 161 HW1", done: true, dueDate: "2026-10-01" },
    ],
    events: [{ id: "e1", title: "Micro midterm", date: "2026-10-20", time: "10:00" }],
  }) });
  return { root, lib };
}

test("zip, pptx and docx: slides with speaker notes, paragraphs joined from runs", () => {
  const units = pptxUnits(zip({ "ppt/slides/slide10.xml": slide("Ten"), "ppt/slides/slide2.xml": slide("Two"), "ppt/notesSlides/notesSlide2.xml": slide("2", "note") }));
  assert.deepEqual(units, [{ loc: "slide 2", text: "Two\nSpeaker notes: note" }, { loc: "slide 10", text: "Ten" }]);
  assert.deepEqual(docxUnits(zip({ "word/document.xml": "<w:p><w:r><w:t>a</w:t></w:r><w:r><w:t>b</w:t></w:r></w:p><w:p><w:r><w:t>c</w:t></w:r></w:p>" })), [{ loc: "document", text: "ab\nc" }]);
  assert.equal(unzip(zip({ "x.txt": "hi", "y.txt": "no" }), n => n === "x.txt").size, 1);
  assert.throws(() => unzip(Buffer.from("not a zip at all, definitely not, and long enough"), () => true), /not a zip/);
});

test("the built-in PDF reader takes text operators from Flate content streams", () => {
  const [unit] = pdfUnitsBuiltin(pdf("Consumer surplus \\(CS\\) is area"));
  assert.match(unit!.text, /Consumer surplus \(CS\) is area\nSecond line/);
});

test("material kinds come from paths", () => {
  for (const [path, kind] of [["Homework/hw3.pdf", "homework"], ["lec05.pptx", "lecture"], ["Midterm review.pdf", "exam"], ["HW3 solutions.pdf", "solution"], ["syllabus.docx", "syllabus"], ["Lab 2/readme.md", "lab"], ["Readings/ch4.pdf", "reading"], ["handout/ch3.pdf", "lecture"], ["CS 161/Transcripts/2026-10-12 0900 lecture.md", "transcript"], ["misc.txt", "other"]] as const) assert.equal(materialKind(path), kind, path);
});

test("the library lists courses with materials and planner deadlines, and skips secrets and links", async () => {
  const { root, lib } = library();
  try { symlinkSync(join(root, "Microeconomics"), join(root, "CS 161 - Operating Systems", "linked"), "junction"); } catch { /* no link rights here */ }
  const out = JSON.parse(await lib.tool("list", {})) as { courses: { id: string; title: string; code?: string; files: number; byKind: Record<string, number>; due: { title: string }[]; nextEvents: { title: string }[] }[] };
  const cs = out.courses.find(c => c.code === "CS 161")!, econ = out.courses.find(c => c.code === "ECON 201")!;
  assert.equal(cs.title, "Operating Systems");
  assert.equal(cs.files, 2, "the .env and the linked folder are not read");
  assert.deepEqual(cs.byKind, { lecture: 1, homework: 1 });
  assert.deepEqual(cs.due.map(t => t.title), ["CS 161 HW2"], "done todos drop out");
  assert.equal(econ.title, "Intermediate Microeconomics");
  assert.deepEqual(econ.nextEvents.map(e => e.title), ["Micro midterm"], "an alias names the course");
});

test("search ranks passages with citations, filters by course and kind, and read pages through a file", async () => {
  const { lib } = library();
  const hits = (JSON.parse(await lib.tool("search", { query: "round robin waiting time" })) as { hits: { file: string; loc: string; kind: string }[] }).hits;
  assert.ok(hits.length >= 2);
  assert.ok(hits.some(h => h.file.endsWith("hw2.md")) && hits.some(h => h.loc === "slide 1"));
  const hw = (JSON.parse(await lib.tool("search", { query: "waiting time", kind: "homework" })) as { hits: { file: string }[] }).hits;
  assert.deepEqual(hw.map(h => h.file), ["CS 161 - Operating Systems/Homework/hw2.md"]);
  const micro = (JSON.parse(await lib.tool("search", { query: "midterm", course: "micro" })) as { hits: { course: string }[] }).hits;
  assert.ok(micro.length && micro.every(h => h.course === "microeconomics"));
  assert.match(await lib.tool("search", { query: "starve" }), /burst estimates & can starve/);
  assert.match(await lib.tool("search", { query: "surplus" }), /Consumer surplus/);
  assert.match(await lib.tool("search", { query: "x", course: "biology" }), /No course matches/);
  const read = JSON.parse(await lib.tool("read", { file: "lec03-scheduling.pptx", loc: "slide 2" })) as { text: string; units: number };
  assert.equal(read.units, 2);
  assert.match(read.text, /^\[slide 2\]\nShortest job first/);
  assert.match(await lib.tool("read", { file: "../../etc/passwd" }), /No indexed course file/);
  assert.match(await lib.tool("bogus", {}), /Unknown courses operation/);
});

test("the index is cached and rebuilt for a changed file", async () => {
  const { root, lib } = library();
  await lib.refresh(0);
  writeFileSync(join(root, "Microeconomics", "notes-week2.md"), "Price elasticity of demand");
  await lib.refresh(0);
  assert.equal(lib.search("elasticity").length, 1);
  const again = new CourseLibrary({ stateDir: join(root, "..", "state"), root });
  await again.refresh(0);
  assert.equal(again.search("elasticity").length, 1);
});

test("no course folder: list explains where to put classes", async () => {
  const lib = new CourseLibrary({ stateDir: mkdtempSync(join(tmpdir(), "hormes-courses-")), root: join(tmpdir(), "hormes-no-such-courses-dir") });
  assert.match(await lib.tool("list", {}), /make one folder per class/);
});

test("captured lectures and meetings are indexed as transcripts under their course, without writing into the folders", async () => {
  const base = mkdtempSync(join(tmpdir(), "hormes-courses-"));
  const root = join(base, "Courses");
  mkdirSync(join(root, "Microeconomics"), { recursive: true });
  const lib = new CourseLibrary({ stateDir: join(base, "state"), root, captured: () => [
    { course: "Microeconomics", title: "Monopoly lecture", at: Date.parse("2026-10-12T10:00:00"), text: "A monopolist sets marginal revenue equal to marginal cost." },
    { title: "Advisor meeting", at: Date.parse("2026-10-12T15:00:00"), text: "Thesis outline due Friday." },
  ] });
  const hit = lib.search("marginal revenue", { kind: "transcript" })[0]!;
  assert.equal(hit, undefined, "nothing before a refresh");
  await lib.refresh(0);
  const [lecture] = lib.search("marginal revenue", { kind: "transcript" });
  assert.equal(lecture!.course, "microeconomics");
  assert.equal(lecture!.file, "Microeconomics/Captured/2026-10-12 Monopoly lecture.md");
  const [meeting] = lib.search("thesis outline");
  assert.equal(meeting!.course, "captured");
  assert.match(await lib.tool("read", { file: meeting!.file }), /Thesis outline due Friday/);
  assert.deepEqual(readdirSync(join(root, "Microeconomics")), [], "the course folder is untouched");
});

test("the inbox finds recent course downloads by name or first page, and import copies one in without overwriting", async () => {
  const { root, lib } = library();
  const downloads = join(root, "..", "Downloads");
  mkdirSync(downloads, { recursive: true });
  writeFileSync(join(downloads, "cs161_hw3.md"), "Homework 3: deadlocks.");
  writeFileSync(join(downloads, "slides-week6.md"), "Intermediate Microeconomics, week 6: oligopoly.");
  writeFileSync(join(downloads, "receipt.txt"), "Thanks for your order.");
  writeFileSync(join(downloads, ".env"), "SECRET=1");
  const inboxLib = new CourseLibrary({ stateDir: join(root, "..", "state2"), root, downloads });
  const items = (JSON.parse(await inboxLib.tool("inbox", {})) as { items: { name: string; course?: string; why?: string }[] }).items;
  const by = Object.fromEntries(items.map(i => [i.name, i]));
  assert.equal(by["cs161_hw3.md"]?.course, "cs-161-operating-systems");
  assert.equal(by["cs161_hw3.md"]?.why, "its name");
  assert.equal(by["slides-week6.md"]?.course, "microeconomics");
  assert.equal(by["slides-week6.md"]?.why, "its first page");
  assert.equal(by["receipt.txt"]?.course, undefined);
  assert.equal(by[".env"], undefined);
  const filed = JSON.parse(await inboxLib.tool("import", { file: "cs161_hw3.md", course: "CS 161" })) as { filed: string };
  assert.equal(filed.filed, "CS 161 - Operating Systems/Homework/cs161_hw3.md");
  const again = JSON.parse(await inboxLib.tool("import", { file: "cs161_hw3.md", course: "CS 161" })) as { filed: string };
  assert.equal(again.filed, "CS 161 - Operating Systems/Homework/cs161_hw3 (2).md", "never overwrites");
  assert.match(await inboxLib.tool("import", { file: "../Courses/x.md", course: "CS 161" }), /not a file name in Downloads/);
  assert.match(await inboxLib.tool("import", { file: ".env", course: "CS 161" }), /not a file name/);
  const after = (JSON.parse(await inboxLib.tool("inbox", {})) as { items: { name: string }[] }).items.map(i => i.name);
  assert.ok(!after.includes("cs161_hw3.md"), "a filed download leaves the inbox");
  void lib;
});

test("save writes a new Markdown file into the course's folder for its kind, never overwriting, and it becomes searchable", async () => {
  const { lib } = library();
  const first = JSON.parse(await lib.tool("save", { course: "CS 161", kind: "exam", title: "Practice exam 2026-10-13", text: "1. Why does round robin need a quantum?" })) as { saved: string };
  assert.equal(first.saved, "CS 161 - Operating Systems/Exams/Practice exam 2026-10-13.md");
  const second = JSON.parse(await lib.tool("save", { course: "CS 161", kind: "exam", title: "Practice exam 2026-10-13", text: "Another" })) as { saved: string };
  assert.equal(second.saved, "CS 161 - Operating Systems/Exams/Practice exam 2026-10-13 (2).md");
  assert.equal((JSON.parse(await lib.tool("save", { course: "CS 161", title: "../../evil", text: "x" })) as { saved: string }).saved, "CS 161 - Operating Systems/Notes/evil.md", "a title cannot leave the course folder");
  assert.match(await lib.tool("save", { course: "Biology", title: "x", text: "y" }), /No course matches/);
  assert.match(await lib.tool("save", { course: "CS 161", title: "x", text: " " }), /save needs/);
  await lib.refresh(0);
  assert.equal(lib.search("quantum", { kind: "exam" })[0]?.file, "CS 161 - Operating Systems/Exams/Practice exam 2026-10-13.md");
});

test("hostile files: unbalanced PDF text operators parse in linear time; a zip bomb's shared or many entries stay within one archive budget", () => {
  const brackets = deflateSync(Buffer.from(`BT ${"[".repeat(400_000)} ${"(".repeat(400_000)} ET`, "latin1"));
  const evil = Buffer.concat([Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Length ${brackets.length} /Filter /FlateDecode >>\nstream\n`, "latin1"), brackets, Buffer.from("\nendstream\nendobj\n", "latin1")]);
  const t0 = Date.now();
  pdfUnitsBuiltin(evil);
  assert.ok(Date.now() - t0 < 2000, `unbalanced operators took ${Date.now() - t0} ms`);

  // One local header named by 300 directory entries: read once.
  const big = "<a:p><a:r><a:t>x</a:t></a:r></a:p>".repeat(400_000);
  const one = zip({ "ppt/slides/slide1.xml": big });
  const localLen = one.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  const central = one.subarray(localLen, one.length - 22);
  const entries = Array.from({ length: 300 }, (_, i) => {
    const name = Buffer.from(`ppt/slides/slide${i + 1}.xml`);
    const c = Buffer.from(central.subarray(0, 46)); c.writeUInt16LE(name.length, 28);
    return Buffer.concat([c, name]);
  });
  const cd = Buffer.concat(entries), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(300, 8); end.writeUInt16LE(300, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(localLen, 16);
  const shared = Buffer.concat([one.subarray(0, localLen), cd, end]);
  assert.equal(unzip(shared, () => true).size, 1, "a shared local header is inflated once");

  // Many distinct 14 MB entries: the archive's 64 MB budget stops them.
  const fat = "a".repeat(14 * 1024 * 1024);
  const many = zip(Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`ppt/slides/slide${i + 1}.xml`, fat])));
  const read = unzip(many, () => true);
  assert.ok([...read.values()].reduce((n, b) => n + b.length, 0) <= 64 * 1024 * 1024);
  assert.ok(read.size <= 5);
});

test("save and import refuse the root-level pseudo-courses; a save during a refresh is searchable at the next one", async () => {
  const base = mkdtempSync(join(tmpdir(), "hormes-courses-"));
  const root = join(base, "Courses");
  mkdirSync(join(root, "CS 161"), { recursive: true });
  writeFileSync(join(root, "loose-notes.md"), "Some notes at the root.");
  const lib = new CourseLibrary({ stateDir: join(base, "state"), root, captured: () => [{ title: "Advisor meeting", at: Date.now(), text: "Outline due Friday." }] });
  await lib.refresh(0);
  assert.match(await lib.tool("save", { course: "General", title: "x", text: "y" }), /not a class folder/);
  assert.match(await lib.tool("save", { course: "captured", title: "x", text: "y" }), /not a class folder/);
  assert.match(await lib.tool("import", { file: "a.pdf", course: "General" }), /not a class folder/);
  const scanning = lib.refresh(0);
  await lib.tool("save", { course: "CS 161", title: "Deadlock notes", text: "Coffman conditions: mutual exclusion, hold and wait." });
  await scanning;
  await lib.refresh(60_000);
  assert.equal(lib.search("coffman")[0]?.file, "CS 161/Notes/Deadlock notes.md", "a save marks the library dirty, so even a young index walks again");
  assert.deepEqual(readdirSync(root).sort(), ["CS 161", "loose-notes.md"], "no Notes or Lectures folder appears at the root");
});

test("course.json can mark a class for handwritten explanations, and list says so", async () => {
  const { root, lib } = library();
  writeFileSync(join(root, "Microeconomics", "course.json"), JSON.stringify({ title: "Intermediate Microeconomics", code: "ECON 201", handwriting: true }));
  const courses = (JSON.parse(await lib.tool("list", {})) as { courses: { code?: string; handwriting?: boolean }[] }).courses;
  assert.equal(courses.find(c => c.code === "ECON 201")?.handwriting, true);
  assert.equal(courses.find(c => c.code === "CS 161")?.handwriting, undefined);
});

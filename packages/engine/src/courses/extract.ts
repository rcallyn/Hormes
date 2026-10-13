import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { inflateRawSync, inflateSync } from "node:zlib";

/** One locatable piece of a document: a page, a slide, or the whole of a plain file. */
export interface TextUnit { readonly loc: string; readonly text: string }

export const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".tex", ".rst", ".org", ".csv", ".json", ".html", ".htm",
  ".py", ".ipynb", ".js", ".ts", ".java", ".c", ".h", ".cpp", ".hpp", ".cs", ".go", ".rs", ".rb", ".m", ".r", ".sql", ".scala", ".kt", ".swift", ".hs", ".ml", ".lisp", ".scm", ".asm", ".s", ".v", ".sv", ".vhd"]);
export const DOC_EXTENSIONS = new Set([".pdf", ".pptx", ".docx", ...TEXT_EXTENSIONS]);
/** The largest document read (lecture decks with images run to tens of MB; the text inside is small). */
export const MAX_FILE_BYTES = 80 * 1024 * 1024;
const MAX_ENTRY_BYTES = 16 * 1024 * 1024;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };
export function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => e[0] === "#"
    ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
    : ENTITIES[e.toLowerCase()] ?? m);
}
const tidy = (s: string): string => s.replace(/\r\n?/g, "\n").replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();

/** The entries of a zip archive (central directory only; no zip64, no encryption). Sizes are bounded against zip bombs. */
export function unzip(data: Buffer, want: (name: string) => boolean): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65_557); i--) if (data.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("not a zip archive");
  const count = data.readUInt16LE(eocd + 10);
  let p = data.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && p + 46 <= data.length; n++) {
    if (data.readUInt32LE(p) !== 0x02014b50) break;
    const method = data.readUInt16LE(p + 10), size = data.readUInt32LE(p + 20), full = data.readUInt32LE(p + 24);
    const nameLen = data.readUInt16LE(p + 28), extraLen = data.readUInt16LE(p + 30), commentLen = data.readUInt16LE(p + 32), local = data.readUInt32LE(p + 42);
    const name = data.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!want(name) || full > MAX_ENTRY_BYTES || local + 30 > data.length || data.readUInt32LE(local) !== 0x04034b50) continue;
    const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28);
    const raw = data.subarray(start, start + size);
    if (method === 0) out.set(name, Buffer.from(raw));
    else if (method === 8) out.set(name, inflateRawSync(raw, { maxOutputLength: MAX_ENTRY_BYTES }));
  }
  return out;
}

/** Office XML paragraphs: the runs of each `<x:p>` joined, one line per paragraph. */
function officeText(xml: string, ns: "a" | "w"): string {
  const paragraphs = xml.split(new RegExp(`</${ns}:p>`));
  const run = new RegExp(`<${ns}:t(?:\\s[^>]*)?>([^<]*)</${ns}:t>`, "g");
  return tidy(paragraphs.map(p => [...p.matchAll(run)].map(m => decodeXml(m[1]!)).join("")).filter(Boolean).join("\n"));
}

export function pptxUnits(data: Buffer): TextUnit[] {
  const entries = unzip(data, n => /^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/.test(n));
  const num = (n: string) => Number(/(\d+)\.xml$/.exec(n)![1]);
  const slides = [...entries.keys()].filter(n => n.startsWith("ppt/slides/")).sort((a, b) => num(a) - num(b));
  const units: TextUnit[] = [];
  for (const name of slides) {
    const n = num(name);
    const body = officeText(entries.get(name)!.toString("utf8"), "a");
    const notesXml = entries.get(`ppt/notesSlides/notesSlide${n}.xml`);
    // Speaker notes repeat the slide number as a lone digit; drop that.
    const notes = notesXml ? officeText(notesXml.toString("utf8"), "a").split("\n").filter(l => l.trim() !== String(n)).join("\n").trim() : "";
    const text = [body, notes && `Speaker notes: ${notes}`].filter(Boolean).join("\n");
    if (text) units.push({ loc: `slide ${n}`, text });
  }
  return units;
}

export function docxUnits(data: Buffer): TextUnit[] {
  const xml = unzip(data, n => n === "word/document.xml").get("word/document.xml");
  const text = xml ? officeText(xml.toString("utf8"), "w") : "";
  return text ? [{ loc: "document", text }] : [];
}

/** A PDF string literal's escapes, read as Latin-1 (the standard encodings' printable range agrees with it). */
function pdfLiteral(s: string): string {
  return s.replace(/\\(?:([nrtbf()\\])|([0-7]{1,3})|\r?\n)/g, (_m, c: string | undefined, o: string | undefined) =>
    c ? ({ n: "\n", r: "\n", t: " ", b: "", f: "", "(": "(", ")": ")", "\\": "\\" } as Record<string, string>)[c]! : o ? String.fromCharCode(parseInt(o, 8)) : "");
}

/** A fallback when pdftotext is missing: the text-showing operators of each Flate content stream. Fonts with
 * custom encodings (most PowerPoint exports) come out empty; the caller says so rather than guessing. */
export function pdfUnitsBuiltin(data: Buffer): TextUnit[] {
  const units: TextUnit[] = [];
  const src = data.toString("latin1");
  const re = /<<((?:(?!>>\s*stream)[\s\S]){0,2000})>>\s*stream\r?\n/g;
  let m: RegExpExecArray | null, part = 0;
  while ((m = re.exec(src))) {
    const start = m.index + m[0].length, end = src.indexOf("endstream", start);
    if (end < 0) break;
    re.lastIndex = end;
    if (/\/(?:Subtype\s*\/Image|Type\s*\/(?:XRef|ObjStm|Metadata)|Length1)/.test(m[1]!)) continue;
    let body: string;
    try { body = /FlateDecode/.test(m[1]!) ? inflateSync(data.subarray(start, end), { maxOutputLength: MAX_ENTRY_BYTES }).toString("latin1") : src.slice(start, end); }
    catch { continue; }
    if (!/\bBT\b/.test(body)) continue;
    const lines: string[] = [];
    for (const block of body.split(/\bET\b/)) {
      let line = "";
      for (const t of block.matchAll(/\((?:\\[\s\S]|[^\\)])*\)\s*(?:Tj|'|")|\[((?:\\[\s\S]|[^\]])*)\]\s*TJ|(T\*|Td|TD)/g)) {
        if (t[2]) { if (line) { lines.push(line); line = ""; } continue; }
        const raw = t[1] ?? t[0].replace(/\s*(?:Tj|'|")$/, "");
        for (const piece of raw.matchAll(/\(((?:\\[\s\S]|[^\\)])*)\)|(-?\d+(?:\.\d+)?)/g)) {
          if (piece[1] !== undefined) line += pdfLiteral(piece[1]);
          else if (Number(piece[2]) < -200) line += " ";
        }
      }
      if (line) lines.push(line);
    }
    const text = tidy(lines.join("\n").replace(/[^\x09\x0a\x20-\x7e\xa0-\xff]/g, ""));
    if (text.length > 20) units.push({ loc: `part ${++part}`, text });
  }
  return units;
}

let pdftotextMissing = false;
function pdftotext(path: string): Promise<string | undefined> {
  if (pdftotextMissing) return Promise.resolve(undefined);
  return new Promise(resolve => {
    execFile("pdftotext", ["-q", "-enc", "UTF-8", path, "-"], { maxBuffer: 64 * 1024 * 1024, timeout: 60_000, windowsHide: true }, (err, stdout) => {
      if (err && (err as NodeJS.ErrnoException).code === "ENOENT") pdftotextMissing = true;
      resolve(err ? undefined : stdout);
    });
  });
}

export async function pdfUnits(path: string, data: Buffer): Promise<TextUnit[]> {
  const out = await pdftotext(path);
  if (out !== undefined) return out.split("\f").map((t, i) => ({ loc: `page ${i + 1}`, text: tidy(t) })).filter(u => u.text);
  return pdfUnitsBuiltin(data);
}

function notebookUnits(data: Buffer): TextUnit[] {
  const nb = JSON.parse(data.toString("utf8")) as { cells?: { cell_type?: string; source?: string | string[] }[] };
  return (nb.cells ?? []).map((c, i) => ({ loc: `cell ${i + 1}`, text: tidy(Array.isArray(c.source) ? c.source.join("") : c.source ?? "") })).filter(u => u.text);
}

/** The text of one course file, by extension. Throws on a file it cannot read. */
export async function extractUnits(path: string): Promise<TextUnit[]> {
  const ext = extname(path).toLowerCase();
  const data = readFileSync(path);
  switch (ext) {
    case ".pdf": return pdfUnits(path, data);
    case ".pptx": return pptxUnits(data);
    case ".docx": return docxUnits(data);
    case ".ipynb": return notebookUnits(data);
    case ".html": case ".htm": {
      const text = tidy(decodeXml(data.toString("utf8").replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<\/(p|div|li|h\d|tr|br)>/gi, "\n").replace(/<[^>]+>/g, " ")));
      return text ? [{ loc: "document", text }] : [];
    }
    default: {
      const text = data.toString("utf8").replace(/\r\n/g, "\n").trim();
      return text ? [{ loc: "document", text }] : [];
    }
  }
}

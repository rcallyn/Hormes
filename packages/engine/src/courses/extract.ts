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
/** What one archive or one PDF may inflate to in all: a zip bomb's entries share it, not each their own 16 MB. */
export const MAX_INFLATED_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 4000;
const MAX_PDF_STREAMS = 20_000;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };
export function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] !== "#") return ENTITIES[e.toLowerCase()] ?? m;
    const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
}
const tidy = (s: string): string => s.replace(/\r\n?/g, "\n").replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();

/** The entries of a zip archive (central directory only; no zip64, no encryption). Each entry and the archive as a
 * whole are bounded against zip bombs, and two directory entries pointing at one local header are read once. */
export function unzip(data: Buffer, want: (name: string) => boolean): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65_557); i--) if (data.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("not a zip archive");
  const count = Math.min(data.readUInt16LE(eocd + 10), MAX_ENTRIES);
  let p = data.readUInt32LE(eocd + 16), total = 0;
  const seenLocal = new Set<number>();
  for (let n = 0; n < count && p + 46 <= data.length; n++) {
    if (data.readUInt32LE(p) !== 0x02014b50) break;
    const method = data.readUInt16LE(p + 10), size = data.readUInt32LE(p + 20), full = data.readUInt32LE(p + 24);
    const nameLen = data.readUInt16LE(p + 28), extraLen = data.readUInt16LE(p + 30), commentLen = data.readUInt16LE(p + 32), local = data.readUInt32LE(p + 42);
    const name = data.toString("utf8", p + 46, Math.min(data.length, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!want(name) || out.has(name) || seenLocal.has(local) || full > MAX_ENTRY_BYTES || local + 30 > data.length || data.readUInt32LE(local) !== 0x04034b50) continue;
    seenLocal.add(local);
    const room = MAX_INFLATED_BYTES - total;
    if (room <= 0) break;
    const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28);
    const raw = data.subarray(start, Math.min(data.length, start + size));
    let entry: Buffer;
    if (method === 0) entry = Buffer.from(raw.subarray(0, Math.min(raw.length, room, MAX_ENTRY_BYTES)));
    else if (method === 8) {
      try { entry = inflateRawSync(raw, { maxOutputLength: Math.min(room, MAX_ENTRY_BYTES) }); }
      catch { continue; }
    } else continue;
    total += entry.length;
    out.set(name, entry);
  }
  return out;
}

/** Office XML paragraphs: the runs of each `<x:p>` joined, one line per paragraph. */
function officeText(xml: string, ns: "a" | "w"): string {
  const paragraphs = xml.split(`</${ns}:p>`);
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

const ESCAPES: Record<string, string> = { n: "\n", r: "\n", t: " ", b: "", f: "", "(": "(", ")": ")", "\\": "\\" };

/** A PDF literal string from its `(`: nested parentheses and escapes, read as Latin-1 (the standard encodings'
 * printable range agrees with it). Linear; an unterminated string ends at the end of the stream. */
function readLiteral(s: string, open: number): [string, number] {
  let out = "", depth = 1, i = open + 1;
  while (i < s.length) {
    const c = s[i]!;
    if (c === "\\") {
      const next = s[i + 1] ?? "";
      if (next >= "0" && next <= "7") {
        let j = i + 1;
        while (j < s.length && j < i + 4 && s[j]! >= "0" && s[j]! <= "7") j++;
        out += String.fromCharCode(parseInt(s.slice(i + 1, j), 8) & 0xff);
        i = j;
        continue;
      }
      if (next === "\r" || next === "\n") { i += next === "\r" && s[i + 2] === "\n" ? 3 : 2; continue; }
      out += ESCAPES[next] ?? next;
      i += 2;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return [out, i + 1];
    out += c;
    i++;
  }
  return [out, i];
}

const isOpChar = (c: string): boolean => (c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || c === "'" || c === "\"" || c === "*";
const isNumChar = (c: string): boolean => (c >= "0" && c <= "9") || c === "-" || c === "." || c === "+";

/** The text-showing operators of one content stream (Tj, TJ, ', "), with T*, Td, TD and ET as line breaks. One pass
 * over the stream: hostile input (unbalanced brackets, huge arrays) costs linear time, never a regex backtrack. */
export function pdfTextLines(body: string): string[] {
  const lines: string[] = [];
  let line = "", operands: string[] = [], i = 0;
  const n = body.length;
  const flush = (): void => { if (line) { lines.push(line); line = ""; } };
  while (i < n) {
    const c = body[i]!;
    if (c === "(") { const [text, next] = readLiteral(body, i); operands.push(text); i = next; continue; }
    if (c === "[") {
      let j = i + 1, joined = "";
      while (j < n && body[j] !== "]") {
        const d = body[j]!;
        if (d === "(") { const [text, next] = readLiteral(body, j); joined += text; j = next; }
        else if (isNumChar(d)) { let k = j; while (k < n && isNumChar(body[k]!)) k++; if (Number(body.slice(j, k)) < -200) joined += " "; j = k; }
        else j++;
      }
      operands = [joined];
      i = j + 1;
      continue;
    }
    if (c === "%") { while (i < n && body[i] !== "\n" && body[i] !== "\r") i++; continue; }
    if (c === "/") { i++; while (i < n && isOpChar(body[i]!)) i++; continue; }
    if (isOpChar(c)) {
      let j = i;
      while (j < n && isOpChar(body[j]!)) j++;
      const op = body.slice(i, j);
      if (op === "Tj" || op === "TJ") line += operands.join("");
      else if (op === "'" || op === "\"") { flush(); line += operands.join(""); }
      else if (op === "T*" || op === "Td" || op === "TD" || op === "ET") flush();
      operands = [];
      i = j;
      continue;
    }
    i++;
  }
  flush();
  return lines;
}

/** A fallback when pdftotext is missing: the text-showing operators of each content stream. Fonts with custom
 * encodings (most PowerPoint exports) come out empty; the caller says so rather than guessing. What all streams
 * inflate to is bounded, and so is the number of streams read. */
export function pdfUnitsBuiltin(data: Buffer): TextUnit[] {
  const units: TextUnit[] = [];
  const src = data.toString("latin1");
  let from = 0, part = 0, inflated = 0;
  for (let streams = 0; streams < MAX_PDF_STREAMS && inflated < MAX_INFLATED_BYTES; streams++) {
    const kw = src.indexOf("stream", from);
    if (kw < 0) break;
    from = kw + 6;
    // "endstream" contains "stream"; only a keyword after a dictionary's ">>" starts one.
    if (kw >= 3 && src.slice(kw - 3, kw) === "end") continue;
    let start = kw + 6;
    if (src[start] === "\r") start++;
    if (src[start] === "\n") start++;
    else if (src[start - 1] !== "\r") continue;
    const dictEnd = src.lastIndexOf(">>", kw);
    if (dictEnd < 0 || kw - dictEnd > 64 || src.slice(dictEnd + 2, kw).trim()) continue;
    const dict = src.slice(Math.max(0, dictEnd - 2000), dictEnd);
    const end = src.indexOf("endstream", start);
    if (end < 0) break;
    from = end + 9;
    if (/\/(?:Subtype\s*\/Image|Type\s*\/(?:XRef|ObjStm|Metadata)|Length1)/.test(dict.slice(dict.lastIndexOf("<<")))) continue;
    let body: string;
    try {
      body = /FlateDecode/.test(dict.slice(dict.lastIndexOf("<<")))
        ? inflateSync(data.subarray(start, end), { maxOutputLength: Math.min(MAX_ENTRY_BYTES, MAX_INFLATED_BYTES - inflated) }).toString("latin1")
        : src.slice(start, end);
    } catch { continue; }
    inflated += body.length;
    if (!/\bBT\b/.test(body)) continue;
    const text = tidy(pdfTextLines(body).join("\n").replace(/[^\x09\x0a\x20-\x7e\xa0-\xff]/g, ""));
    if (text.length > 20) units.push({ loc: `part ${++part}`, text });
  }
  return units;
}

let pdftotextMissing = false;
/** False once a pdftotext call found no binary (PDFs then go through the built-in reader). */
export const pdftotextAvailable = (): boolean => !pdftotextMissing;
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

/** HTML as text: script and style blocks cut by index (no backtracking regex), then tags. */
function htmlText(html: string): string {
  let out = "", i = 0;
  const lower = html.toLowerCase();
  while (i < html.length) {
    const open = lower.indexOf("<", i);
    if (open < 0) { out += html.slice(i); break; }
    out += html.slice(i, open);
    const close = lower.indexOf(">", open);
    if (close < 0) break;
    const tag = lower.slice(open + 1, close).trim();
    if (tag.startsWith("script") || tag.startsWith("style")) {
      const name = tag.startsWith("script") ? "script" : "style";
      const end = lower.indexOf(`</${name}`, close);
      i = end < 0 ? html.length : lower.indexOf(">", end) + 1 || html.length;
      continue;
    }
    out += /^\/(p|div|li|h\d|tr)\b|^br\b/.test(tag) ? "\n" : " ";
    i = close + 1;
  }
  return tidy(decodeXml(out));
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
      const text = htmlText(data.toString("utf8"));
      return text ? [{ loc: "document", text }] : [];
    }
    default: {
      const text = data.toString("utf8").replace(/\r\n/g, "\n").trim();
      return text ? [{ loc: "document", text }] : [];
    }
  }
}

import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import type { WorkMeeting, WorkMeetingAttachment } from "@hormes/protocol";

export const VC_DEMO_RECIPIENT = "JacobY@transposeplatform.vc";
export const VC_DEMO_QUOTE = "This looks interesting. Send me the latest pitch deck after this, and let’s reconnect next week.";
const assets = fileURLToPath(new URL("../../../../docs/demo/vc/", import.meta.url));
const catalog = [
  { id: "vc_deck", sourceId: "demo_pitch", title: "Latest Hormes deck", name: "Hormes-deck-v1.pdf", kind: "deck", mimeType: "application/pdf" },
] as const;

/** Fixed demo assets are copied into durable session storage, never selected by a model path. */
export function demoMeetingAttachments(stateDir: string, sessionId: string): WorkMeetingAttachment[] {
  const root = join(stateDir, "work", "meeting-files", sessionId);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  return catalog.map(item => {
    const data = readFileSync(join(assets, item.name));
    const path = join(root, item.name);
    writeFileSync(path, data, { flag: "wx", mode: 0o600 });
    return { ...item, path, bytes: data.length, sha256: createHash("sha256").update(data).digest("hex"), version: "v1", demo: true };
  });
}

/** Revalidate actual bytes at proposal and review; missing, changed or symlinked files fail closed. */
export function checkedMeetingFile(stateDir: string, file: WorkMeetingAttachment): Buffer {
  const root = realpathSync(join(stateDir, "work", "meeting-files"));
  const rel = relative(root, realpathSync(file.path));
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`Attachment moved outside meeting storage: ${file.name}`);
  const fd = openSync(file.path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size !== file.bytes || stat.size > 10_000_000) throw new Error(`Attachment changed: ${file.name}`);
    const data = readFileSync(fd);
    if (createHash("sha256").update(data).digest("hex") !== file.sha256) throw new Error(`Attachment changed: ${file.name}`);
    return data;
  } finally { closeSync(fd); }
}

/** A local RFC822 draft with real MIME attachments. This module has no mail or network transport. */
export function exportMeetingDraft(stateDir: string, sessionId: string, meeting: WorkMeeting): string {
  const draft = meeting.followUp!;
  const boundary = `hormes_${draft.id}`;
  const b64 = (data: Buffer): string => data.toString("base64").match(/.{1,76}/g)?.join("\r\n") ?? "";
  const subject = `=?UTF-8?B?${Buffer.from(draft.subject).toString("base64")}?=`;
  const parts = [`X-Unsent: 1`, ...(draft.to ? [`To: ${draft.to}`] : []), `Subject: ${subject}`, "MIME-Version: 1.0", `Content-Type: multipart/mixed; boundary="${boundary}"`, "", `--${boundary}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", b64(Buffer.from(draft.body))];
  for (const id of draft.attachmentIds) {
    const file = meeting.attachments.find(f => f.id === id)!;
    const data = checkedMeetingFile(stateDir, file);
    parts.push(`--${boundary}`, `Content-Type: ${file.mimeType}; name="${file.name}"`, `Content-Disposition: attachment; filename="${file.name}"`, "Content-Transfer-Encoding: base64", "", b64(data));
  }
  parts.push(`--${boundary}--`, "");
  const path = join(stateDir, "work", "meeting-drafts", `${sessionId}-${draft.id}.eml`);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, parts.join("\r\n"), { mode: 0o600 });
  return path;
}

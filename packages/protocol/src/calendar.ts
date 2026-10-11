/** Explicit, fresh native calendar reads. These do not opt calendars into proactive observation. */
export interface CalendarReadRequest {
  readonly id: string;
  readonly startDate?: string;
  readonly days: number;
  /** Empty means all available calendars for this explicit query only. */
  readonly calendarIds: readonly string[];
}
export interface CalendarReadSource { readonly id: string; readonly title: string; readonly account: string }
export interface CalendarReadEvent {
  readonly id: string; readonly title: string; readonly startsAt: number; readonly endsAt: number;
  readonly calendar: string; readonly sourceCalendarId: string; readonly allDay: boolean;
}
export interface CalendarReadResult {
  readonly id: string; readonly ok: boolean; readonly error?: string;
  readonly permission?: "granted" | "denied" | "not-determined";
  readonly timeZone: string; readonly startsAt: number; readonly endsAt: number; readonly readAt: number;
  readonly calendars: readonly CalendarReadSource[]; readonly events: readonly CalendarReadEvent[];
  readonly truncated: boolean;
}
const record = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const text = (x: unknown, max = 2000): x is string => typeof x === "string" && x.length <= max;
const id = (x: unknown): x is string => text(x, 512) && x.length > 0;
const time = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && Math.abs(x) <= 8.64e15;
export function isCalendarReadRequest(x: unknown): x is CalendarReadRequest {
  if (!record(x) || !id(x["id"]) || !Number.isInteger(x["days"]) || (x["days"] as number) < 1 || (x["days"] as number) > 7) return false;
  if (x["startDate"] !== undefined) {
    if (typeof x["startDate"] !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x["startDate"])) return false;
    const date = new Date(x["startDate"] + "T00:00:00Z");
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== x["startDate"]) return false;
  }
  return Array.isArray(x["calendarIds"]) && x["calendarIds"].length <= 200 && x["calendarIds"].every(id);
}
export function isCalendarReadResult(x: unknown): x is CalendarReadResult {
  if (!record(x) || !id(x["id"]) || typeof x["ok"] !== "boolean" || !text(x["timeZone"], 100) || !time(x["startsAt"]) || !time(x["endsAt"]) || !time(x["readAt"]) || typeof x["truncated"] !== "boolean") return false;
  if (x["error"] !== undefined && !text(x["error"])) return false;
  if (x["permission"] !== undefined && !["granted", "denied", "not-determined"].includes(String(x["permission"]))) return false;
  if (!Array.isArray(x["calendars"]) || x["calendars"].length > 200 || !x["calendars"].every(c => record(c) && id(c["id"]) && text(c["title"]) && text(c["account"]))) return false;
  if (!Array.isArray(x["events"]) || x["events"].length > 200 || !x["events"].every(e => record(e) && id(e["id"]) && text(e["title"]) && text(e["calendar"]) && id(e["sourceCalendarId"]) && time(e["startsAt"]) && time(e["endsAt"]) && e["endsAt"] >= e["startsAt"] && typeof e["allDay"] === "boolean")) return false;
  if (!x["ok"]) return x["events"].length === 0 && typeof x["error"] === "string" && x["error"].length > 0;
  const start = x["startsAt"] as number, end = x["endsAt"] as number;
  const sourceIds = new Set(x["calendars"].map(c => c.id));
  return end > start && end - start <= 8 * 86400000 && x["events"].every(e => sourceIds.has(e.sourceCalendarId) && e.startsAt < end && e.endsAt >= start);
}

import type { CalendarReadResult } from "@hormes/protocol";

export interface CalendarQuery { startDate?: string; days: number }
export const localCalendarZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;
export function localCalendarDate(now: number, timeZone = localCalendarZone()): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (kind: string) => parts.find(p => p.type === kind)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function calendarClockContext(now = Date.now(), timeZone = localCalendarZone()): string {
  return `Current local date: ${localCalendarDate(now, timeZone)} (${timeZone}). This is reference context for dates; continue the current user request without reciting the clock unless asked. For Calendar or schedule questions only: preserve the user's relative date words when delegating; the application resolves them at Calendar read time. Answer those questions from the returned events and date range.`;
}
const validDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(`${s}T12:00:00Z`)) && new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s;
const shift = (day: string, count: number): string => {
  const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + count); return d.toISOString().slice(0, 10);
};
const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** The latest original utterance owns dates. Never take them from memory, screen
 * text, model-generated request paraphrases or a previous user turn. */
export function calendarUserWords(task?: { userDialogue?: string; request: string }): string | undefined {
  return task?.userDialogue?.split("\n").map(s => s.trim()).filter(Boolean).at(-1) ?? task?.request;
}

export function resolveCalendarQuery(args: Record<string, unknown>, words: string | undefined, now: number, timeZone = localCalendarZone()): CalendarQuery {
  const days = args["days"] ?? 1;
  const check = (query: CalendarQuery): CalendarQuery => {
    if (!Number.isInteger(query.days) || query.days < 1 || query.days > 7 || (query.startDate !== undefined && !validDate(query.startDate))) throw new Error("Use a valid local startDate YYYY-MM-DD (or omit for today) and days from 1 to 7.");
    return query;
  };
  if (!words?.trim()) return check({ ...(args["startDate"] === undefined ? {} : { startDate: args["startDate"] as string }), days: days as number });
  const today = localCalendarDate(now, timeZone), text = words.toLowerCase();
  const matches: Array<{ index: number; query: CalendarQuery }> = [];
  const add = (regex: RegExp, make: (m: RegExpMatchArray) => CalendarQuery): void => { for (const m of text.matchAll(regex)) matches.push({ index: m.index!, query: make(m) }); };
  add(/\b(today|tonight|tomorrow|yesterday)\b/g, m => ({ startDate: shift(today, m[1] === "tomorrow" ? 1 : m[1] === "yesterday" ? -1 : 0), days: 1 }));
  add(/\b(this|current|next|last) week\b/g, m => {
    const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
    return { startDate: shift(today, -((weekday + 6) % 7) + (m[1] === "next" ? 7 : m[1] === "last" ? -7 : 0)), days: 7 };
  });
  add(/\b(?:next|coming) ([1-7]) days\b/g, m => ({ startDate: today, days: Number(m[1]) }));
  add(/\b\d{4}-\d{2}-\d{2}\b/g, m => ({ startDate: m[0], days: days as number }));
  add(new RegExp(`\\b(${months.join("|")}) (\\d{1,2})(?:st|nd|rd|th)?(?:,? (\\d{4}))?\\b`, "g"), m => ({ startDate: `${m[3] ?? today.slice(0, 4)}-${String(months.indexOf(m[1]!) + 1).padStart(2, "0")}-${m[2]!.padStart(2, "0")}`, days: days as number }));
  add(new RegExp(`\\b(?:(next|this) )?(${weekdays.join("|")})\\b`, "g"), m => {
    const weekday = new Date(`${today}T12:00:00Z`).getUTCDay(), target = weekdays.indexOf(m[2]!);
    const delta = (target - weekday + 7) % 7;
    return { startDate: shift(today, delta === 0 && m[1] === "next" ? 7 : delta), days: 1 };
  });
  if (matches.length) {
    // A correction within the current utterance wins ("today—actually tomorrow").
    // Distinct joined date ranges need clarification, not a silent last-day read.
    if (matches.length > 1 && /\b(from|through|until|and|between)\b/.test(text)) throw new Error("Ask for one Calendar start date and a range of up to seven days.");
    return check(matches.sort((a, b) => a.index - b.index).at(-1)!.query);
  }
  // A plain schedule question defaults to today. An unrecognized temporal phrase
  // is not permission to silently turn a model's invented date into a user request.
  if (/\b(weeks?|months?|years?|weekend|day after|day before|\d+ days?|\d{1,2}[/]\d{1,2})\b/.test(text) || new RegExp(`\\b(${months.join("|")})\\b`).test(text)) throw new Error("Please name the Calendar date explicitly (YYYY-MM-DD or month and day), or say today, tomorrow or this week.");
  return { startDate: today, days: 1 };
}

/** Refuse a native receipt for another range; fresh timestamps alone are not proof
 * that the returned events answer the user's date question. */
export function calendarRangeMatches(result: CalendarReadResult, query: CalendarQuery): boolean {
  if (!query.startDate) return true;
  try {
    const midnight = (at: number) => new Intl.DateTimeFormat("en-GB", { timeZone: result.timeZone, hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(at) === "00:00:00";
    return localCalendarDate(result.startsAt, result.timeZone) === query.startDate && localCalendarDate(result.endsAt, result.timeZone) === shift(query.startDate, query.days) && midnight(result.startsAt) && midnight(result.endsAt);
  } catch { return false; }
}

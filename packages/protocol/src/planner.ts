/**
 * The planner: User's todos and calendar, as the Console's Home, Calendar, Todos and School pages show them and as
 * the brain reads and changes them (the `planner` tool, and `read_calendar` where there is no native calendar).
 *
 * Shapes follow stits (Documents/Repositories/stits), so one model serves both stores: the local one
 * (`~/.hormes/planner.json`) and stits' own Postgres when sync is on. Dates are local `YYYY-MM-DD`, times `HH:MM`.
 */

/** stits' categories (src/lib/categories.ts). */
export const PLANNER_CATEGORIES = ["rush", "career", "school", "house", "other", "lloyd"] as const;
export type PlannerCategory = (typeof PLANNER_CATEGORIES)[number];
export type PlannerPriority = "high" | "medium" | "low";

export interface PlannerSubtask { readonly id: string; readonly title: string; readonly done: boolean }

export interface PlannerTodo {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly done: boolean;
  readonly dueDate?: string;
  readonly category?: PlannerCategory;
  readonly priority?: PlannerPriority;
  readonly subtasks?: readonly PlannerSubtask[];
  /** ISO time it was ticked. */
  readonly completedAt?: string;
  /** Set when it mirrors a Canvas assignment (stits' Canvas sync). */
  readonly canvasId?: string;
}

export interface PlannerRecurrence {
  readonly freq: "daily" | "weekly" | "monthly";
  readonly interval: number;
  readonly until?: string;
  readonly exceptions?: readonly string[];
}

export interface PlannerEvent {
  readonly id: string;
  readonly title: string;
  /** Start date; the recurrence anchor. */
  readonly date: string;
  readonly endDate?: string;
  /** `HH:MM`, or "" for all day. */
  readonly time: string;
  readonly endTime?: string;
  readonly todoId?: string;
  readonly category?: PlannerCategory;
  readonly done?: boolean;
  readonly recurrence?: PlannerRecurrence;
  readonly canvasId?: string;
  /** Only on the per-day copies `expandRecurring` makes (`<id>::<date>`); never stored. */
  readonly recurringInstance?: boolean;
}

export type PlannerSource = "local" | "stits";

export interface PlannerState {
  /** Where the todos and events live right now. */
  readonly source: PlannerSource;
  /** Sync with stits is switched on (the source is stits once it connects). */
  readonly stitsSync: boolean;
  /** A stits database was found (STITS_DATABASE_URL, or the checkout's .env.local). Never the URL itself. */
  readonly stitsAvailable: boolean;
  /** Where the stits connection comes from, for Settings ("~/Documents/Repositories/stits/.env.local"). */
  readonly stitsOrigin?: string;
  /** The last sync or store error, until the next success. */
  readonly error?: string;
  /** Wall-clock ms of the last successful read from the source. */
  readonly syncedAt?: number;
  readonly todos: readonly PlannerTodo[];
  readonly events: readonly PlannerEvent[];
}

export type PlannerTodoInput = Omit<PlannerTodo, "id" | "done" | "completedAt"> & { readonly done?: boolean };
/** A change: absent leaves a field, null clears it. */
type Patch<T> = { readonly [K in keyof T]?: T[K] | null };
export type PlannerTodoPatch = Patch<Omit<PlannerTodo, "id" | "canvasId">>;
export type PlannerEventInput = Omit<PlannerEvent, "id" | "recurringInstance">;
export type PlannerEventPatch = Patch<Omit<PlannerEvent, "id" | "recurringInstance" | "canvasId" | "todoId">>;

export type PlannerCommand =
  | { readonly op: "refresh" }
  | { readonly op: "todo.add"; readonly todo: PlannerTodoInput }
  | { readonly op: "todo.update"; readonly id: string; readonly patch: PlannerTodoPatch }
  | { readonly op: "todo.delete"; readonly id: string }
  | { readonly op: "event.add"; readonly event: PlannerEventInput }
  | { readonly op: "event.update"; readonly id: string; readonly patch: PlannerEventPatch }
  | { readonly op: "event.delete"; readonly id: string }
  /** Switch sync with stits on or off. On: local items not yet in stits are copied there once. */
  | { readonly op: "sync.set"; readonly enabled: boolean };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;
const record = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const str = (x: unknown, max = 500): x is string => typeof x === "string" && x.length <= max;

export function isPlannerDate(x: unknown): x is string {
  if (typeof x !== "string" || !ISO_DATE.test(x)) return false;
  const d = new Date(`${x}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === x;
}
export function isPlannerTime(x: unknown): x is string {
  return typeof x === "string" && HH_MM.test(x);
}
export function isPlannerCategory(x: unknown): x is PlannerCategory {
  return typeof x === "string" && (PLANNER_CATEGORIES as readonly string[]).includes(x);
}

/**
 * What is wrong with a todo or event field set, or undefined when it is fine. `partial`: a patch (every field
 * optional, nullable clears). The same rules stits' API applies (src/lib/schemas.ts).
 */
export function plannerFieldsProblem(kind: "todo" | "event", x: unknown, partial: boolean): string | undefined {
  if (!record(x)) return `${kind} must be an object`;
  const has = (k: string): boolean => x[k] !== undefined && x[k] !== null;
  if (!partial || "title" in x) {
    if (!str(x["title"]) || (x["title"] as string).trim().length === 0) return "title must be 1-500 characters";
  }
  if (has("category") && !isPlannerCategory(x["category"])) return `category must be one of ${PLANNER_CATEGORIES.join(", ")}`;
  if (kind === "todo") {
    if (has("dueDate") && !isPlannerDate(x["dueDate"])) return "dueDate must be YYYY-MM-DD";
    if (has("priority") && !["high", "medium", "low"].includes(String(x["priority"]))) return "priority must be high, medium or low";
    if (has("description") && !str(x["description"], 10_000)) return "description is too long";
    if (has("done") && typeof x["done"] !== "boolean") return "done must be true or false";
    if (has("subtasks") && (!Array.isArray(x["subtasks"]) || !x["subtasks"].every((s) => record(s) && str(s["id"]) && str(s["title"]) && typeof s["done"] === "boolean"))) return "subtasks must be [{id,title,done}]";
    return undefined;
  }
  if ((!partial || "date" in x) && !isPlannerDate(x["date"])) return "date must be YYYY-MM-DD";
  if (has("endDate") && !isPlannerDate(x["endDate"])) return "endDate must be YYYY-MM-DD";
  if (has("time") && x["time"] !== "" && !isPlannerTime(x["time"])) return "time must be HH:MM (24 h) or empty for all day";
  if (has("endTime") && !isPlannerTime(x["endTime"])) return "endTime must be HH:MM (24 h)";
  if (has("recurrence")) {
    const r = x["recurrence"];
    if (!record(r) || !["daily", "weekly", "monthly"].includes(String(r["freq"])) || !Number.isInteger(r["interval"]) || (r["interval"] as number) < 1 || (r["interval"] as number) > 365) return "recurrence must be {freq: daily|weekly|monthly, interval: 1-365}";
    if (r["until"] !== undefined && !isPlannerDate(r["until"])) return "recurrence.until must be YYYY-MM-DD";
  }
  return undefined;
}

export function isPlannerCommand(x: unknown): x is PlannerCommand {
  if (!record(x) || typeof x["op"] !== "string") return false;
  switch (x["op"]) {
    case "refresh": return true;
    case "todo.add": return plannerFieldsProblem("todo", x["todo"], false) === undefined;
    case "todo.update": return str(x["id"]) && plannerFieldsProblem("todo", x["patch"], true) === undefined;
    case "event.add": return plannerFieldsProblem("event", x["event"], false) === undefined;
    case "event.update": return str(x["id"]) && plannerFieldsProblem("event", x["patch"], true) === undefined;
    case "todo.delete":
    case "event.delete": return str(x["id"]) && (x["id"] as string).length > 0;
    case "sync.set": return typeof x["enabled"] === "boolean";
    default: return false;
  }
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function advance(date: string, freq: PlannerRecurrence["freq"], step: number): string {
  if (freq === "daily") return shiftDate(date, step);
  if (freq === "weekly") return shiftDate(date, step * 7);
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1 + step, d));
  return next.toISOString().slice(0, 10);
}

/**
 * Recurring events as per-day copies within [rangeStart, rangeEnd] (inclusive); the rest pass through. Ported from
 * stits' expandRecurringEvents so both apps show the same occurrences.
 */
export function expandRecurring(events: readonly PlannerEvent[], rangeStart: string, rangeEnd: string): PlannerEvent[] {
  const out: PlannerEvent[] = [];
  for (const event of events) {
    if (!event.recurrence) {
      out.push(event);
      continue;
    }
    const { freq, interval, until, exceptions } = event.recurrence;
    const step = Math.max(1, interval || 1);
    const end = until && until < rangeEnd ? until : rangeEnd;
    const skip = exceptions && exceptions.length ? new Set(exceptions) : undefined;
    let cursor = event.date;
    if (freq !== "monthly" && rangeStart > cursor) {
      const per = freq === "daily" ? step : step * 7;
      const between = Math.floor((Date.parse(rangeStart) - Date.parse(cursor)) / 86_400_000);
      const jumps = Math.max(0, Math.floor(between / per));
      if (jumps > 0) cursor = advance(cursor, freq, step * jumps);
    }
    for (let guard = 0; cursor <= end && guard < 500; guard++) {
      if (cursor >= rangeStart && !skip?.has(cursor)) out.push({ ...event, id: `${event.id}::${cursor}`, date: cursor, recurringInstance: true });
      cursor = advance(cursor, freq, step);
    }
  }
  return out;
}

/** Events touching [from, to] (inclusive dates), recurrences expanded, sorted by date then time (all-day first). */
export function eventsBetween(events: readonly PlannerEvent[], from: string, to: string): PlannerEvent[] {
  return expandRecurring(events, from, to)
    .filter((e) => (e.endDate && !e.recurrence ? e.endDate : e.date) >= from && e.date <= to)
    .sort((a, b) => (a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date)));
}

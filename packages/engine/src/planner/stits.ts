import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import type { PlannerCategory, PlannerEvent, PlannerEventInput, PlannerEventPatch, PlannerPriority, PlannerRecurrence, PlannerSubtask, PlannerTodo, PlannerTodoInput, PlannerTodoPatch } from "@hormes/protocol";
import { baseEventId, completion, type PlannerStore } from "./store.ts";

/**
 * stits (Documents/Repositories/stits) as the planner's store: its own Postgres, read and written the way stits'
 * API routes do (src/app/api/todos, src/app/api/events), so stits sees Hormes's changes as if made in stits and the
 * other way round. Deleting a Canvas-synced item is remembered in canvas_dismissed exactly as stits does, so its next
 * Canvas sync does not put it back.
 */

/** Where the stits connection comes from: never the URL itself outside this module. */
export interface StitsConnection {
  readonly url: string;
  /** For Settings: "STITS_DATABASE_URL" or the .env.local path it was read from. */
  readonly origin: string;
}

/**
 * STITS_DATABASE_URL, else DATABASE_URL in the stits checkout's .env.local (STITS_DIR, else
 * ~/Documents/Repositories/stits, else ~/Documents/stits). Undefined when there is no stits to sync with.
 */
export function findStits(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): StitsConnection | undefined {
  const direct = env["STITS_DATABASE_URL"]?.trim();
  if (direct) return { url: direct, origin: "STITS_DATABASE_URL" };
  const dirs = [env["STITS_DIR"], join(home, "Documents", "Repositories", "stits"), join(home, "Documents", "stits")].filter((d): d is string => !!d);
  for (const dir of dirs) {
    for (const name of [".env.local", ".env"]) {
      const file = join(dir, name);
      if (!existsSync(file)) continue;
      const url = envValue(readFileSync(file, "utf8"), "DATABASE_URL");
      if (url) return { url, origin: file };
    }
  }
  return undefined;
}

/** KEY=value from a dotenv text: quotes stripped, `export ` allowed, comments ignored. */
export function envValue(text: string, key: string): string | undefined {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^export\s+/, "");
    if (!line.startsWith(`${key}=`)) continue;
    const value = line.slice(key.length + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    return value || undefined;
  }
  return undefined;
}

type TodoRow = {
  id: string; title: string; description: string | null; done: boolean; due_date: string | null;
  category: string | null; priority: string | null; subtasks: PlannerSubtask[] | null; completed_at: string | Date | null; canvas_id: string | null;
};
type EventRow = {
  id: string; title: string; date: string; end_date: string | null; time: string; end_time: string | null;
  todo_id: string | null; category: string | null; done: boolean | null; recurrence: PlannerRecurrence | null; canvas_id: string | null;
};

function rowToTodo(r: TodoRow): PlannerTodo {
  return {
    id: r.id, title: r.title, done: r.done,
    ...(r.description ? { description: r.description } : {}),
    ...(r.due_date ? { dueDate: r.due_date } : {}),
    ...(r.category ? { category: r.category as PlannerCategory } : {}),
    ...(r.priority ? { priority: r.priority as PlannerPriority } : {}),
    ...(r.subtasks ? { subtasks: r.subtasks } : {}),
    ...(r.completed_at ? { completedAt: r.completed_at instanceof Date ? r.completed_at.toISOString() : r.completed_at } : {}),
    ...(r.canvas_id ? { canvasId: r.canvas_id } : {}),
  };
}

function rowToEvent(r: EventRow): PlannerEvent {
  return {
    id: r.id, title: r.title, date: r.date, time: r.time ?? "",
    ...(r.end_date ? { endDate: r.end_date } : {}),
    ...(r.end_time ? { endTime: r.end_time } : {}),
    ...(r.todo_id ? { todoId: r.todo_id } : {}),
    ...(r.category ? { category: r.category as PlannerCategory } : {}),
    ...(r.done !== null ? { done: r.done } : {}),
    ...(r.recurrence ? { recurrence: r.recurrence } : {}),
    ...(r.canvas_id ? { canvasId: r.canvas_id } : {}),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuid(id: string, what: string): string {
  if (!UUID.test(id)) throw new Error(`invalid ${what} id ${id}`);
  return id;
}

/** Postgres `date` stays the plain "YYYY-MM-DD" string stits stores (postgres.js would make it a JS Date). */
const DATE_OID = 1082;

export class StitsPlannerStore implements PlannerStore {
  readonly kind = "stits" as const;
  private readonly sql: postgres.Sql;

  /** `sql`: an existing connection or transaction to work in instead (the rolled-back write check uses one). */
  constructor(connection: StitsConnection, private readonly now: () => number = Date.now, sql?: postgres.Sql) {
    this.sql = sql ?? postgres(connection.url, {
      max: 2,
      idle_timeout: 20,
      connect_timeout: 8,
      // stits points DATABASE_URL at Supabase's transaction pooler, which cannot carry prepared statements.
      prepare: false,
      onnotice: () => undefined,
      types: { date: { to: DATE_OID, from: [DATE_OID], serialize: (v: string) => v, parse: (v: string) => v } },
    });
  }

  async list(): Promise<{ todos: PlannerTodo[]; events: PlannerEvent[] }> {
    const [todos, events] = await Promise.all([
      this.sql<TodoRow[]>`select * from todos order by due_date nulls last, title`,
      this.sql<EventRow[]>`select * from schedule_events order by date, time`,
    ]);
    return { todos: todos.map(rowToTodo), events: events.map(rowToEvent) };
  }

  async addTodo(t: PlannerTodoInput, id?: string): Promise<PlannerTodo> {
    const sql = this.sql;
    const [row] = await sql<TodoRow[]>`
      insert into todos (id, title, description, done, due_date, category, priority, subtasks, canvas_id)
      values (${id ? uuid(id, "todo") : sql`gen_random_uuid()`}, ${t.title.trim()}, ${t.description ?? null}, ${t.done ?? false},
              ${t.dueDate ?? null}, ${t.category ?? null}, ${t.priority ?? null},
              ${t.subtasks ? sql.json(t.subtasks as unknown as postgres.JSONValue) : null}, ${t.canvasId ?? null})
      on conflict (id) do nothing
      returning *`;
    if (!row) {
      const [existing] = await sql<TodoRow[]>`select * from todos where id = ${id!}`;
      return rowToTodo(existing!);
    }
    return rowToTodo(row);
  }

  async updateTodo(id: string, raw: PlannerTodoPatch): Promise<void> {
    const sql = this.sql;
    const p = completion(raw, this.now);
    const fields: Record<string, unknown> = {};
    if (typeof p.title === "string") fields["title"] = p.title.trim();
    if ("description" in p) fields["description"] = p.description ?? null;
    if (typeof p.done === "boolean") fields["done"] = p.done;
    if ("dueDate" in p) fields["due_date"] = p.dueDate ?? null;
    if ("category" in p) fields["category"] = p.category ?? null;
    if ("priority" in p) fields["priority"] = p.priority ?? null;
    if ("subtasks" in p) fields["subtasks"] = p.subtasks ? sql.json(p.subtasks as unknown as postgres.JSONValue) : null;
    if ("completedAt" in p) fields["completed_at"] = p.completedAt ?? null;
    if (Object.keys(fields).length === 0) return;
    const result = await sql`update todos set ${sql(fields)} where id = ${uuid(id, "todo")}`;
    if (result.count === 0) throw new Error(`no todo ${id}`);
  }

  async deleteTodo(id: string): Promise<void> {
    await this.sql`
      with deleted as (delete from todos where id = ${uuid(id, "todo")} returning canvas_id)
      insert into canvas_dismissed (canvas_id, scope)
      select canvas_id, 'todo' from deleted where canvas_id is not null
      on conflict do nothing`;
  }

  async addEvent(e: PlannerEventInput, id?: string): Promise<PlannerEvent> {
    const sql = this.sql;
    const [row] = await sql<EventRow[]>`
      insert into schedule_events (id, title, date, end_date, time, end_time, todo_id, category, done, recurrence, canvas_id)
      values (${id ? uuid(id, "event") : sql`gen_random_uuid()`}, ${e.title.trim()}, ${e.date}, ${e.endDate ?? null}, ${e.time ?? ""},
              ${e.endTime ?? null}, ${e.todoId ?? null}, ${e.category ?? null}, ${e.done ?? null},
              ${e.recurrence ? sql.json(e.recurrence as unknown as postgres.JSONValue) : null}, ${e.canvasId ?? null})
      on conflict (id) do nothing
      returning *`;
    if (!row) {
      const [existing] = await sql<EventRow[]>`select * from schedule_events where id = ${id!}`;
      return rowToEvent(existing!);
    }
    return rowToEvent(row);
  }

  async updateEvent(id: string, p: PlannerEventPatch): Promise<void> {
    const sql = this.sql;
    const fields: Record<string, unknown> = {};
    if (typeof p.title === "string") fields["title"] = p.title.trim();
    if (typeof p.date === "string") fields["date"] = p.date;
    if ("endDate" in p) fields["end_date"] = p.endDate ?? null;
    if ("time" in p) fields["time"] = p.time ?? "";
    if ("endTime" in p) fields["end_time"] = p.endTime ?? null;
    if ("done" in p) fields["done"] = p.done ?? null;
    if ("category" in p) fields["category"] = p.category ?? null;
    if ("recurrence" in p) fields["recurrence"] = p.recurrence ? sql.json(p.recurrence as unknown as postgres.JSONValue) : null;
    if (Object.keys(fields).length === 0) return;
    const result = await sql`update schedule_events set ${sql(fields)} where id = ${uuid(baseEventId(id), "event")}`;
    if (result.count === 0) throw new Error(`no event ${id}`);
  }

  async deleteEvent(id: string): Promise<void> {
    await this.sql`
      with deleted as (delete from schedule_events where id = ${uuid(baseEventId(id), "event")} returning canvas_id, todo_id)
      insert into canvas_dismissed (canvas_id, scope)
      select canvas_id, 'event' from deleted where canvas_id is not null and todo_id is not null
      on conflict do nothing`;
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 2 });
  }
}

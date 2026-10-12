import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { PlannerEvent, PlannerEventInput, PlannerEventPatch, PlannerTodo, PlannerTodoInput, PlannerTodoPatch } from "@hormes/protocol";

/** Where the planner's todos and events live: a file here, or stits' Postgres. */
export interface PlannerStore {
  readonly kind: "local" | "stits";
  list(): Promise<{ todos: PlannerTodo[]; events: PlannerEvent[] }>;
  addTodo(input: PlannerTodoInput, id?: string): Promise<PlannerTodo>;
  updateTodo(id: string, patch: PlannerTodoPatch): Promise<void>;
  deleteTodo(id: string): Promise<void>;
  addEvent(input: PlannerEventInput, id?: string): Promise<PlannerEvent>;
  updateEvent(id: string, patch: PlannerEventPatch): Promise<void>;
  deleteEvent(id: string): Promise<void>;
  close(): Promise<void>;
}

/** A recurring occurrence's id (`<id>::<date>`) names its series: edits and deletes apply to the series, as in stits. */
export function baseEventId(id: string): string {
  return id.split("::")[0] ?? id;
}

/** Drop undefined and turn null into "absent": a patch's null clears the field. */
function apply<T extends object>(item: T, patch: object): T {
  const next: Record<string, unknown> = { ...(item as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (v === null) delete next[k];
    else next[k] = v;
  }
  return next as T;
}

/** Ticking a todo stamps completedAt unless the patch names one; unticking clears it (stits' client does the same). */
export function completion(patch: PlannerTodoPatch, now: () => number): PlannerTodoPatch {
  if (patch.done === undefined || "completedAt" in patch) return patch;
  return { ...patch, completedAt: patch.done ? new Date(now()).toISOString() : null };
}

interface LocalFile {
  version: 1;
  todos: PlannerTodo[];
  events: PlannerEvent[];
  /** Ids already copied into stits when sync was switched on, so a second switch-on does not copy them again. */
  pushedToStits?: string[];
}

/**
 * The planner on this machine: `~/.hormes/planner.json`, written whole and atomically (a temp file renamed over it)
 * on every change. Small by nature (a person's todos and calendar), so a file is enough.
 */
export class LocalPlannerStore implements PlannerStore {
  readonly kind = "local" as const;
  private data: LocalFile;

  constructor(private readonly path: string, private readonly now: () => number = Date.now) {
    this.data = this.read();
  }

  private read(): LocalFile {
    if (!existsSync(this.path)) return { version: 1, todos: [], events: [] };
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as Partial<LocalFile>;
      return { version: 1, todos: Array.isArray(parsed.todos) ? parsed.todos : [], events: Array.isArray(parsed.events) ? parsed.events : [], ...(Array.isArray(parsed.pushedToStits) ? { pushedToStits: parsed.pushedToStits } : {}) };
    } catch (e) {
      throw new Error(`planner file ${this.path} is unreadable (${(e as Error).message}); fix or move it aside`);
    }
  }

  private write(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.path);
  }

  async list(): Promise<{ todos: PlannerTodo[]; events: PlannerEvent[] }> {
    return { todos: [...this.data.todos], events: [...this.data.events] };
  }

  async addTodo(input: PlannerTodoInput, id: string = randomUUID()): Promise<PlannerTodo> {
    const todo: PlannerTodo = apply({ id, done: false } as PlannerTodo, { ...input, title: input.title.trim() });
    this.data.todos.push(todo);
    this.write();
    return todo;
  }

  async updateTodo(id: string, patch: PlannerTodoPatch): Promise<void> {
    const i = this.data.todos.findIndex((t) => t.id === id);
    if (i < 0) throw new Error(`no todo ${id}`);
    this.data.todos[i] = apply(this.data.todos[i]!, completion(patch, this.now));
    this.write();
  }

  async deleteTodo(id: string): Promise<void> {
    const before = this.data.todos.length;
    this.data.todos = this.data.todos.filter((t) => t.id !== id);
    if (this.data.todos.length === before) throw new Error(`no todo ${id}`);
    // Like stits' foreign key (on delete cascade): a todo's scheduled copies go with it.
    this.data.events = this.data.events.filter((e) => e.todoId !== id);
    this.write();
  }

  async addEvent(input: PlannerEventInput, id: string = randomUUID()): Promise<PlannerEvent> {
    const event: PlannerEvent = apply({ id, time: "" } as PlannerEvent, { ...input, title: input.title.trim() });
    this.data.events.push(event);
    this.write();
    return event;
  }

  async updateEvent(id: string, patch: PlannerEventPatch): Promise<void> {
    const real = baseEventId(id);
    const i = this.data.events.findIndex((e) => e.id === real);
    if (i < 0) throw new Error(`no event ${real}`);
    this.data.events[i] = apply(this.data.events[i]!, patch);
    this.write();
  }

  async deleteEvent(id: string): Promise<void> {
    const real = baseEventId(id);
    const before = this.data.events.length;
    this.data.events = this.data.events.filter((e) => e.id !== real);
    if (this.data.events.length === before) throw new Error(`no event ${real}`);
    this.write();
  }

  /** Local items not yet copied to stits. */
  unpushed(): { todos: PlannerTodo[]; events: PlannerEvent[] } {
    const done = new Set(this.data.pushedToStits ?? []);
    return { todos: this.data.todos.filter((t) => !done.has(t.id)), events: this.data.events.filter((e) => !done.has(e.id)) };
  }

  markPushed(ids: readonly string[]): void {
    this.data.pushedToStits = [...new Set([...(this.data.pushedToStits ?? []), ...ids])];
    this.write();
  }

  async close(): Promise<void> {}
}

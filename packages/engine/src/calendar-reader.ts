import { randomUUID } from "node:crypto";
import type { CalendarReadRequest, CalendarReadResult } from "@hormes/protocol";

/** Explicit queries are transient; they never replace proactive calendar choices. */
export class CalendarReader {
  private readonly pending = new Map<string, { finish(result?: CalendarReadResult, error?: Error): void }>();
  constructor(private readonly emit: (request: CalendarReadRequest) => void, private readonly selected: () => string[], private readonly timeoutMs = 20_000) {}
  read(query: { startDate?: string; days: number }, signal?: AbortSignal): Promise<CalendarReadResult> {
    if (signal?.aborted) return Promise.reject(new Error("Calendar read cancelled."));
    const request: CalendarReadRequest = { id: randomUUID(), ...query, calendarIds: [...this.selected()] };
    return new Promise((resolve, reject) => {
      const cancel = () => finish(undefined, new Error("Calendar read cancelled."));
      const timer = setTimeout(() => finish(undefined, new Error("The Hormes Mac app did not answer the Calendar request. Reopen the app and retry; no schedule was read.")), this.timeoutMs);
      const finish = (result?: CalendarReadResult, error?: Error) => {
        if (!this.pending.delete(request.id)) return;
        clearTimeout(timer); signal?.removeEventListener("abort", cancel);
        if (error) reject(error); else if (result) resolve(result);
      };
      this.pending.set(request.id, { finish }); signal?.addEventListener("abort", cancel, { once: true });
      try { this.emit(request); } catch (error) { finish(undefined, error instanceof Error ? error : new Error("Calendar request could not be delivered.")); }
    });
  }
  receive(result: CalendarReadResult): void { this.pending.get(result.id)?.finish(result); }
  close(): void { for (const item of [...this.pending.values()]) item.finish(undefined, new Error("Calendar read cancelled because Hormes stopped.")); }
}

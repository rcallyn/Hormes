import { newId } from "@hormes/core";
import type { AgentInfo, ProactiveSuggestion } from "@hormes/protocol";

export interface SuggestionBudget {
  day: string;
  count: number;
  lastAt: number;
  seen: Record<string, number>;
}
const MIN_STABLE_MS = 30_000;
const COOLDOWN_MS = 30 * 60_000;
const TTL_MS = 10 * 60_000;

/** The initial detector is deliberately narrow: a live agent waiting on permission.
 * No model, screenshots, new watchers, notifications, wake, or tools. A suggestion
 * only reaches the passive Console after a quiet interval. Budget survives restart.
 */
export class ProactiveSuggestions {
  private stable = new Map<string, number>();
  private pending: ProactiveSuggestion | undefined;
  constructor(readonly budget: SuggestionBudget, private readonly save: (budget: SuggestionBudget) => void, private readonly now: () => number = Date.now) {}

  /** Both passive detectors spend the same persisted attention budget. No tools or wake. */
  claim(key: string): boolean {
    const now = this.now(), day = new Date(now).toISOString().slice(0, 10);
    if (this.budget.day !== day) { this.budget.day = day; this.budget.count = 0; }
    if (this.budget.count >= 3 || (this.budget.lastAt !== 0 && now - this.budget.lastAt < COOLDOWN_MS) || now - (this.budget.seen[key] ?? 0) < 24 * 60 * 60_000) return false;
    this.budget.count++; this.budget.lastAt = now;
    Object.defineProperty(this.budget.seen, key, { value: now, enumerable: true, configurable: true, writable: true });
    this.budget.seen = Object.fromEntries(Object.entries(this.budget.seen).filter(([, at]) => now - at < 24 * 60 * 60_000).slice(-128));
    try { this.save(this.budget); return true; }
    catch { this.budget.count = 3; return false; }
  }

  update(agents: readonly AgentInfo[], enabled: boolean, quiet: boolean): boolean {
    const now = this.now();
    const before = this.pending?.id;
    const blocked = agents.filter((a) => a.status === "blocked" && /^[a-z0-9_.:-]{1,256}$/i.test(a.id));
    const ids = new Set(blocked.map((a) => a.id));
    for (const id of this.stable.keys()) if (!ids.has(id)) this.stable.delete(id);
    for (const id of ids) if (!this.stable.has(id)) this.stable.set(id, now);
    if (!enabled || (this.pending && (this.pending.expiresAt <= now || !ids.has(this.pending.agentId)))) this.pending = undefined;
    if (!enabled || !quiet || this.pending) return before !== this.pending?.id;
    const day = new Date(now).toISOString().slice(0, 10);
    if (this.budget.day !== day) { this.budget.day = day; this.budget.count = 0; }
    if (this.budget.count >= 3 || (this.budget.lastAt !== 0 && now - this.budget.lastAt < COOLDOWN_MS)) return before !== undefined;
    for (const agent of blocked) {
      if (now - this.stable.get(agent.id)! < MIN_STABLE_MS || now - (this.budget.seen[agent.id] ?? 0) < 24 * 60 * 60_000) continue;
      if (!this.claim(agent.id)) break;
      const name = agent.name.replace(/[\r\n\x00-\x1f]/g, " ").slice(0, 60);
      this.pending = { id: newId("suggestion"), agentId: agent.id, title: `${name} needs attention`, explanation: "This agent has been waiting on a permission request for at least 30 seconds. Review the request before deciding what to allow.", request: `Read the pending permission request for agent ${JSON.stringify(agent.id)} using agent_read and explain it. Do not approve permissions, send messages, resume agents or change files.`, at: now, expiresAt: now + TTL_MS };
      break;
    }
    return before !== this.pending?.id;
  }

  get suggestions(): readonly ProactiveSuggestion[] { return this.pending && this.pending.expiresAt > this.now() ? [this.pending] : []; }
  take(id: string, agents: readonly AgentInfo[]): ProactiveSuggestion | undefined {
    const suggestion = this.suggestions.find((s) => s.id === id);
    if (!suggestion || !agents.some((a) => a.id === suggestion.agentId && a.status === "blocked")) return undefined;
    this.pending = undefined;
    return suggestion;
  }
}

/** Corrupt state fails closed for today's budget rather than causing repeated interventions. */
export function suggestionBudget(value: unknown, now: number): SuggestionBudget {
  const day = new Date(now).toISOString().slice(0, 10);
  if (value === undefined) return { day, count: 0, lastAt: 0, seen: {} };
  const b = value as Partial<SuggestionBudget> | null;
  if (!b || typeof b.day !== "string" || !Number.isInteger(b.count) || b.count! < 0 || !Number.isFinite(b.lastAt) || !b.seen || typeof b.seen !== "object" || Array.isArray(b.seen) || Object.keys(b.seen).length > 128 || Object.values(b.seen).some((at) => !Number.isFinite(at))) return { day, count: 3, lastAt: now, seen: {} };
  return { day: b.day, count: Math.min(3, b.count!), lastAt: b.lastAt!, seen: { ...b.seen } };
}

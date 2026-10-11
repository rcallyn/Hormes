import type { WorkRecallAttempt } from "@hormes/protocol";

export interface RecallCard {
  id: string; deckId: string; front: string; back: string; answers: string[];
  options?: string[]; correctOption?: number; dueAt: number; streak: number; helped?: boolean;
}
// A transparent first schedule, not a claim of a universally optimal interval.
export const RECALL_INTERVALS = [5 * 60_000, 20 * 60_000, 86_400_000, 3 * 86_400_000, 7 * 86_400_000];
export function normalizeRecall(text: string): string {
  return text.toLowerCase().replace(/[.!?,:;]/g, "").replace(/^\s*(?:the answer is|my answer is|i think it is|it is|it's|the income is|income is|the price is|price is)\s+/, "").replace(/\s+/g, " ").trim();
}
export function recallResult(card: RecallCard, text: string): WorkRecallAttempt["result"] {
  if (/\b(?:i forgot|i forget|i (?:don'?t|do not) (?:know|remember)|cannot remember|can'?t remember)\b/i.test(text.replaceAll("’", "'"))) return "forgot";
  if (!card.answers.length) return "ungraded";
  return card.answers.some(answer => normalizeRecall(answer) === normalizeRecall(text)) ? "correct" : "incorrect";
}
export function recallInterval(card: RecallCard, result: WorkRecallAttempt["result"]): number {
  return result === "correct" && !card.helped ? RECALL_INTERVALS[Math.min(card.streak, RECALL_INTERVALS.length - 1)]! : result === "ungraded" ? 2 * 60_000 : 60_000;
}
export function isRecallControl(text: string): boolean {
  return /^(?:please )?(?:repeat(?: (?:that|the question))?|help(?: me)?|give me a hint|i(?:'m| am) stuck|pause|stop|skip(?: this| card)?|take a break|next(?: card| question)?|continue|resume)[.!?]*$/i.test(text.trim()) || /\?$/.test(text.trim()) || /^(?:what|why|how|can you|could you|would you)\b/i.test(text.trim());
}

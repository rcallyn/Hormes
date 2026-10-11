import type { WorkTaskMode } from "@hormes/protocol";
import type { GroceryNote } from "./groceries.ts";

export function taskLabel(text: string): string { return text.trim().replace(/^(?:(?:[-*•]|\d+[.)])\s+)?(?:\[.\]\s*|[☐☑✓✔]\s*)?/, "").trim(); }
export function taskLines(note: GroceryNote): { text: string; line: number; suggestedMode?: WorkTaskMode }[] {
  const result = note.text.split(/\r?\n/).flatMap((text, index) => {
    const trimmed = text.trim();
    if (!trimmed || (index === 0 && trimmed === note.title.trim()) || /^(?:(?:[-*•]|\d+[.)])\s+)?(?:\[[xX]\]|[☑✓✔])/.test(trimmed)) return [];
    if (text.length > 500) throw new Error("Task lines must be at most 500 characters.");
    const label = taskLabel(text);
    if (!label) return [];
    const suggestedMode: WorkTaskMode | undefined = /\b(grocer(?:y|ies)|shopping)\b/i.test(label) ? "grocery" : /\b(homework|study|exam|review|learn)\b/i.test(label) ? "study" : /\b(meeting|deck|investor|vc|follow.up)\b/i.test(label) ? "meeting" : /\b(code|coding|build|implement|evosim)\b/i.test(label) ? "coding" : undefined;
    return [{ text, line: index + 1, ...(suggestedMode ? { suggestedMode } : {}) }];
  });
  if (result.length > 80) throw new Error("Select a to-do note with at most 80 unfinished task lines.");
  return result;
}
export function wantsTaskImport(words: string): boolean {
  return /\b(read|import|load|open|show)\b/i.test(words) && /\b(to[ -]?do(?:s| list)?|task(?:s| list)|inbox)\b/i.test(words);
}
export function wantsTaskStart(words: string, text: string, taskId: string, ordinal: number): boolean {
  if (!/\b(start|resume|begin|do|work on)\b/i.test(words)) return false;
  const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const label = normalize(taskLabel(text)), utterance = normalize(words);
  return (label.length >= 3 && (` ${utterance} `).includes(` ${label} `)) || words.includes(taskId) || new RegExp(`\\btask\\s+${ordinal}\\b`, "i").test(words);
}

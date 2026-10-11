import { existsSync } from "node:fs";
import { join } from "node:path";

export const DEMO_BRIEFING = "Today you have microeconomics class, a VC meeting, and groceries.";
/** Explicit recording switch. Saved lessons and silent capture retain their own behavior. */
export function demoBriefingEnabled(stateDir: string): boolean {
  return existsSync(join(stateDir, "demo-briefing.enabled"));
}

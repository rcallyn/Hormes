import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Where User's own folders really are. On Windows, Desktop, Documents, Downloads and Pictures are often
 * redirected (OneDrive, another drive), so `~/Desktop` is a folder User never sees. Read once from the
 * registry's Shell Folders (already expanded paths) and cached; elsewhere, and when nothing is redirected,
 * there is nothing to say.
 */
const SHELL_FOLDERS = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders";
const NAMES: ReadonlyArray<readonly [string, string]> = [
  ["Desktop", "Desktop"],
  ["Personal", "Documents"],
  ["{374DE290-123F-4565-9164-39C4925E467B}", "Downloads"],
  ["My Pictures", "Pictures"],
];

let cached: string | undefined;

/** Parse `reg query` output into the folders that differ from `<home>\<Name>`. Pure, for the tests. */
export function redirectedFolders(regOutput: string, home: string): Array<{ name: string; path: string }> {
  const out: Array<{ name: string; path: string }> = [];
  for (const [value, name] of NAMES) {
    const line = regOutput.split(/\r?\n/).find((l) => l.trim().startsWith(`${value} `) || l.trim().startsWith(`${value}\t`));
    const path = line?.split(/\s+REG_(?:EXPAND_)?SZ\s+/)[1]?.trim();
    if (path && path.toLowerCase() !== join(home, name).toLowerCase()) out.push({ name, path });
  }
  return out;
}

/** One context line naming User's redirected folders, or "" (not Windows, nothing redirected, or unreadable). */
export function userFoldersContext(): string {
  if (cached !== undefined) return cached;
  cached = "";
  if (process.platform !== "win32") return cached;
  try {
    const reg = execFileSync("reg", ["query", SHELL_FOLDERS], { encoding: "utf8", windowsHide: true, timeout: 3000 });
    const folders = redirectedFolders(reg, homedir());
    if (folders.length) cached = `The user's folders are redirected; use these real paths, not the ones under the home folder: ${folders.map((f) => `${f.name} = ${f.path}`).join("; ")}.`;
  } catch {
    // No registry answer: say nothing rather than guess.
  }
  return cached;
}

import { existsSync, lstatSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, win32 } from "node:path";
import { REPO_ROOT, SHELL_SANDBOX_SECRET_PATTERN, shellWorkspaceReason } from "@hormes/core";

const WINDOWS = process.platform === "win32";

/** The Windows kernel boundary is apps/windows/Sandbox (an AppContainer launcher); no exe, no shell. */
function windowsSandboxExe(): string | undefined {
  const path = process.env["HORMES_WINDOWS_SANDBOX"] || join(REPO_ROOT, "build", "hormes-sandbox.exe");
  return existsSync(path) ? path : undefined;
}

function isolationAvailable(): boolean {
  return WINDOWS ? windowsSandboxExe() !== undefined : process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec");
}

const winKey = (path: string): string => win32.resolve(path).replace(/[\\/]+$/, "").toLowerCase();
const winInside = (path: string, root: string): boolean => path === root || path.startsWith(`${root}\\`);

function windowsSandbox(workspace: string, protectedRoots: readonly string[], secretRoots: readonly string[], writableFiles?: readonly string[]): { argv: string[]; env: NodeJS.ProcessEnv; dispose(): void } {
  const exe = windowsSandboxExe()!;
  const ws = winKey(workspace);
  const roots = [...protectedRoots, ...secretRoots, ...(process.env["HORMES_STATE_DIR"] ? [process.env["HORMES_STATE_DIR"]] : [])];
  for (const r of roots) {
    const root = winKey(existsSync(r) ? realpathSync.native(r) : r);
    if (winInside(ws, root) || winInside(root, ws)) throw new Error("run_shell cannot use a folder that is, holds, or sits inside a protected or secret folder as its workspace");
  }
  if (writableFiles) for (const path of writableFiles) {
    if (winKey(dirname(path)) !== ws) throw new Error("invalid verifier output path");
    try {
      const st = lstatSync(path);
      if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1 || winKey(realpathSync.native(path)) !== winKey(path)) throw new Error("invalid verifier output path");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const nodeDir = dirname(realpathSync.native(process.execPath));
  const systemRoot = process.env["SystemRoot"] ?? process.env["windir"] ?? "C:\\Windows";
  const system32 = join(systemRoot, "System32");
  const psDir = join(system32, "WindowsPowerShell", "v1.0");
  const installed = [systemRoot, process.env["ProgramFiles"] ?? "C:\\Program Files", process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)"].map(winKey);
  const readNode = !installed.some((root) => winInside(winKey(nodeDir), root));
  const scratch = realpathSync.native(mkdtempSync(join(tmpdir(), "hormes-shell-")));
  const argv = [exe, "--workspace", workspace, "--scratch", scratch];
  if (writableFiles !== undefined) {
    argv.push("--read-only");
    for (const path of writableFiles) argv.push("--write-file", path);
  }
  if (readNode) argv.push("--read", nodeDir);
  argv.push("--", join(psDir, "powershell.exe"), "-NoLogo", "-NoProfile", "-NonInteractive", "-Command");
  // PowerShell starts in C:\ whatever its process cwd, and Set-Location on a real path lists every ancestor, which
  // the container cannot do inside a profile. A PSDrive rooted at the workspace needs no ancestor. The caller appends
  // the command as the next argument, and -Command joins its arguments.
  argv.push(`New-PSDrive -Name hormes-ws -PSProvider FileSystem -Root '${workspace.replace(/'/g, "''")}' -Scope Global | Out-Null; Set-Location hormes-ws:\\; `);
  return {
    argv,
    env: {
      SystemRoot: systemRoot, windir: systemRoot, ComSpec: join(system32, "cmd.exe"), PATHEXT: ".COM;.EXE;.BAT;.CMD;.PS1",
      OS: "Windows_NT", PROCESSOR_ARCHITECTURE: process.env["PROCESSOR_ARCHITECTURE"] ?? "AMD64", NUMBER_OF_PROCESSORS: process.env["NUMBER_OF_PROCESSORS"] ?? "1",
      PATH: [nodeDir, system32, psDir].join(";"),
      USERPROFILE: scratch, HOME: scratch, TEMP: scratch, TMP: scratch, APPDATA: scratch, LOCALAPPDATA: scratch, LANG: "en_US.UTF-8",
    },
    dispose: () => rmSync(scratch, { recursive: true, force: true }),
  };
}

/** Seatbelt checks path names, not all aliases of an inode. Pre-existing hard links
 * could expose or overwrite an unrelated file through an allowed workspace name.
 * Reject them before execution. New links outside the scope are denied by Seatbelt.
 * Async metadata reads keep this bounded admission check off the voice event loop.
 */
export async function assertWorkspaceIntegrity(cwd: string, signal?: AbortSignal): Promise<void> {
  if (!isolationAvailable()) throw new Error("shell isolation is unavailable; no command was run");
  const root = realpathSync.native(cwd);
  const reason = shellWorkspaceReason(root, homedir());
  if (reason) throw new Error(reason);
  // An AppContainer cannot express Seatbelt's regex denies, so on Windows a workspace holding anything
  // the secret pattern names is refused outright instead of denied inside.
  const secretRe = WINDOWS ? new RegExp(SHELL_SANDBOX_SECRET_PATTERN) : undefined;
  const pending = [root]; let entries = 0;
  const deadline = Date.now() + 10_000;
  while (pending.length) {
    if (signal?.aborted) throw new Error("cancelled before shell execution");
    if (++entries > 50_000 || Date.now() > deadline) throw new Error("workspace integrity check exceeded its bound; use a smaller isolated project folder");
    const path = pending.pop()!;
    if (secretRe?.test(path.replace(/\\/g, "/"))) throw new Error(`workspace contains a secret-named entry (${path}); use a folder that holds no credentials`);
    const st = await lstat(path);
    if (st.isSymbolicLink()) continue;
    if (st.isFile() && st.nlink > 1) throw new Error(`workspace contains a hard-linked file (${path}); use a private copy with independent files`);
    if (st.isDirectory()) for (const name of await readdir(path)) pending.push(join(path, name));
  }
}

/** A kernel boundary, independent of the lexical policy and inherited by descendants.
 * No network, Mach/Apple Events, unrelated files, login profiles, or inherited secrets.
 * sandbox-exec is macOS-only and deprecated: an unavailable or rejected profile FAILS
 * the command. There is deliberately no fallback to an unrestricted shell.
 */
export function shellSandbox(cwd: string, protectedRoots: readonly string[] = [REPO_ROOT], secretRoots: readonly string[] = [], writableFiles?: readonly string[]): { argv: string[]; env: NodeJS.ProcessEnv; dispose(): void } {
  if (!isolationAvailable()) throw new Error("shell isolation is unavailable; no command was run");
  const workspace = realpathSync.native(cwd);
  const reason = shellWorkspaceReason(workspace, homedir());
  if (reason) throw new Error(reason);
  if (WINDOWS) return windowsSandbox(workspace, protectedRoots, secretRoots, writableFiles);
  // Validate fixed outputs before allocating scratch: rejected paths must not
  // leak directories. A dangling symlink is still a link, so existsSync alone
  // cannot validate this capability.
  if (writableFiles) for (const path of writableFiles) {
    if (dirname(path) !== workspace) throw new Error("invalid verifier output path");
    try {
      const st = lstatSync(path);
      if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1 || realpathSync.native(path) !== path) throw new Error("invalid verifier output path");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const nodeBinary = realpathSync.native(process.execPath);
  const scratch = realpathSync.native(mkdtempSync(join(tmpdir(), "hormes-shell-")));
  // JSON strings are also valid SBPL string literals. Never splice raw paths into code.
  const q = JSON.stringify;
  const read = ["/System", "/usr/bin", "/usr/sbin", "/usr/lib", "/usr/share", "/bin", "/sbin", "/Library/Apple", "/opt/homebrew/bin", "/opt/homebrew/opt", "/opt/homebrew/Cellar", "/opt/homebrew/lib", "/usr/local/bin", "/usr/local/lib", nodeBinary, workspace, scratch];
  const ancestors = new Set<string>();
  for (const root of read) for (let path = dirname(root); path !== "/"; path = dirname(path)) ancestors.add(path);
  const profile = [
    "(version 1)", "(deny default)", "(allow process-exec process-fork)", '(allow file-read* (literal "/"))',
    // POSIX uname also reads kern.hostname. Without it Node's node:os bootstrap
    // fails before --test runs; permit that read, not the rest of kern.*.
    '(allow sysctl-read (sysctl-name-regex #"^(hw[.]|kern[.](osrelease|ostype|osversion|version|argmax|hostname)$)"))',
    ...read.map((path) => `(allow file-read* (subpath ${q(path)}))`),
    ...[...ancestors].map((path) => `(allow file-read-metadata (literal ${q(path)}))`),
    `(allow file-write* (subpath ${q(scratch)}))`,
    ...(writableFiles === undefined ? [`(allow file-write* (subpath ${q(workspace)}))`] : writableFiles.map(path => `(allow file-write* (literal ${q(path)}))`)),
    '(allow file-read* file-write* (literal "/dev/null") (literal "/dev/zero") (literal "/dev/random") (literal "/dev/urandom"))',
    // Explicit denies beat workspace allows, including paths reached through symlinks.
    '(deny file-read* file-write* (subpath "/System/Volumes/Data"))',
    `(deny file-read* file-write* (regex #${q(SHELL_SANDBOX_SECRET_PATTERN)}))`,
    '(deny file-write* (regex #"(^|/)[.][gG][iI][tT](/|$)"))',
    ...protectedRoots.map((path) => `(deny file-write* (subpath ${q(existsSync(path) ? realpathSync.native(path) : path)}))`),
    ...secretRoots.map((path) => `(deny file-read* file-write* (subpath ${q(existsSync(path) ? realpathSync.native(path) : path)}))`),
    ...(process.env["HORMES_STATE_DIR"] ? [`(deny file-read* file-write* (subpath ${q(process.env["HORMES_STATE_DIR"]!)}))`] : []),
  ].join("\n");
  return {
    argv: ["/usr/bin/sandbox-exec", "-p", profile, "/bin/zsh", "-f", "-c"],
    env: { PATH: `${dirname(nodeBinary)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: scratch, TMPDIR: scratch, LANG: "en_US.UTF-8", OPENSSL_CONF: "/dev/null" },
    dispose: () => rmSync(scratch, { recursive: true, force: true }),
  };
}

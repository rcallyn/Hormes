import { createHash } from "node:crypto";
import { resolve } from "node:path";

/**
 * The address a socket path is served and dialled at.
 *
 * On macOS a socket path is a unix socket file and is used as is. Windows has no unix
 * sockets for Node's `net` (libuv maps a local path to a named pipe and wants one under
 * `\\.\pipe\`), so there the path names a pipe instead: `\\.\pipe\hormes-<16 hex>`, the
 * first 16 hex digits of the SHA-256 of the resolved, lower-cased path. Two state dirs get
 * two pipes, and the lock and log files beside `socketPath` stay real files.
 *
 * apps/windows (`Ipc.PipeName`) computes the same name: keep the two in step.
 */
export function ipcPath(socketPath: string, platform: NodeJS.Platform = process.platform): string {
  if (platform !== "win32") return socketPath;
  if (isPipePath(socketPath)) return socketPath;
  const digest = createHash("sha256").update(resolve(socketPath).toLowerCase(), "utf8").digest("hex").slice(0, 16);
  return `\\\\.\\pipe\\hormes-${digest}`;
}

/** A Windows named-pipe address (`\\.\pipe\…` or `\\?\pipe\…`). */
export function isPipePath(path: string): boolean {
  return /^\\\\[.?]\\pipe\\/i.test(path);
}

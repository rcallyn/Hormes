import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { SECRET_KEYS } from "@hormes/protocol";
import type { ClaudeSessionOptions, PermissionDecision } from "./session.ts";

/** Application-selected capability; never a model tool argument or a cwd heuristic. */
export interface CodingProfile { readonly kind: "evosim"; readonly root: string }
const PROTECTED = ["README.md", "package.json", "engine/baseline.mjs", "engine/physics.mjs", "test/engine.test.mjs", "benchmark.mjs"] as const;
const CANDIDATE = "engine/candidate.mjs";
interface Binding { version: 1; profile: CodingProfile; hashes: Record<string, string> }
const digest = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

function canonicalRoot(path: string): string {
  if (!isAbsolute(path) || !lstatSync(path).isDirectory()) throw new Error("The bounded coding root must be an existing absolute directory");
  return realpathSync(path);
}
export function sameCodingProfile(bound: CodingProfile | undefined, requested: CodingProfile, cwd: string | undefined): boolean {
  try { return !!bound && requested.kind === bound.kind && !!cwd && canonicalRoot(requested.root) === bound.root && canonicalRoot(cwd) === bound.root; } catch { return false; }
}
function checkedFile(root: string, name: string): string {
  const path = resolve(root, name);
  const rel = relative(root, path);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("Outside the bounded coding project");
  // Every path component must remain local. Hard links could turn a candidate write
  // into a write to a verifier or a file outside the project.
  let cursor = root;
  for (const part of rel.split("/")) {
    cursor = join(cursor, part);
    if (lstatSync(cursor).isSymbolicLink()) throw new Error("Linked files are not allowed in the bounded coding project");
  }
  const st = lstatSync(path);
  if (!st.isFile() || st.nlink !== 1 || realpathSync(path) !== path) throw new Error("The bounded coding target must be a regular, unlinked file");
  return path;
}
function capture(profile: CodingProfile, cwd: string): Binding {
  if (profile.kind !== "evosim") throw new Error("Unknown bounded coding profile");
  const root = canonicalRoot(profile.root);
  if (canonicalRoot(cwd) !== root) throw new Error("The session folder differs from its bound coding project");
  checkedFile(root, CANDIDATE);
  return { version: 1, profile: { kind: "evosim", root }, hashes: Object.fromEntries(PROTECTED.map(name => [name, digest(checkedFile(root, name))])) };
}
function validate(binding: Binding, cwd: string): void {
  if (binding.version !== 1 || binding.profile?.kind !== "evosim" || canonicalRoot(cwd) !== binding.profile.root) throw new Error("Invalid or mismatched stored coding profile");
  for (const name of PROTECTED) {
    if (typeof binding.hashes?.[name] !== "string" || digest(checkedFile(binding.profile.root, name)) !== binding.hashes[name]) throw new Error(`Trusted verifier changed: ${name}`);
  }
  checkedFile(binding.profile.root, CANDIDATE);
}

/** Kept in application state, outside the writable candidate/project. */
export class CodingProfileStore {
  private readonly memory = new Map<string, Binding>();
  constructor(private readonly directory?: string) {}
  private path(id: string): string | undefined {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new Error("Invalid Claude session ID for coding profile");
    return this.directory ? join(this.directory, `${id}.json`) : undefined;
  }
  private read(id: string): Binding | undefined {
    const path = this.path(id);
    if (path) {
      try { return JSON.parse(readFileSync(path, "utf8")) as Binding; }
      catch (error) {
        // A missing record means an ordinary session; inaccessible or corrupt
        // records must never silently remove a previously bound capability.
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return this.memory.get(id);
  }
  open(cwd: string, profile?: CodingProfile, sessionId?: string): BoundedCoding | undefined {
    const stored = sessionId ? this.read(sessionId) : undefined;
    if (!stored && !profile) return undefined;
    const binding = stored ?? capture(profile!, cwd);
    validate(binding, cwd);
    if (profile && (profile.kind !== binding.profile.kind || canonicalRoot(profile.root) !== binding.profile.root)) throw new Error("A session cannot change its bound coding project");
    return new BoundedCoding(binding, id => this.save(id, binding));
  }
  private save(id: string, binding: Binding): void {
    const existing = this.read(id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(binding)) throw new Error("A Claude session already has a different coding binding");
    const path = this.path(id);
    if (path && !existing) {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      const temporary = `${path}.${process.pid}.tmp`;
      writeFileSync(temporary, JSON.stringify(binding), { mode: 0o600, flag: "wx" });
      renameSync(temporary, path);
    }
    this.memory.set(id, binding);
  }
}

export class BoundedCoding {
  constructor(private readonly binding: Binding, private readonly save: (id: string) => void) {}
  get profile(): CodingProfile { return this.binding.profile; }
  bind(id: string): void { validate(this.binding, this.profile.root); this.save(id); }
  matches(profile: CodingProfile, cwd: string): boolean {
    try { return profile.kind === "evosim" && canonicalRoot(profile.root) === this.profile.root && canonicalRoot(cwd) === this.profile.root; } catch { return false; }
  }
  guard = (tool: string, input: Record<string, unknown>): PermissionDecision => {
    try {
      validate(this.binding, this.profile.root);
      if (!["Read", "Edit", "Write"].includes(tool)) throw new Error("Only project Read and candidate Edit/Write are available; Hormes runs verification separately");
      const raw = input["file_path"];
      if (typeof raw !== "string" || !raw.trim()) throw new Error("A concrete file path is required");
      const path = resolve(this.profile.root, raw);
      const name = relative(this.profile.root, path);
      if (tool === "Read" ? ![...PROTECTED, CANDIDATE].includes(name) : name !== CANDIDATE) throw new Error("Only engine/candidate.mjs may change; reads are limited to the supplied project files");
      checkedFile(this.profile.root, name);
      return { behavior: "allow", updatedInput: { ...input, file_path: path } };
    } catch (error) { return { behavior: "deny", message: `Bounded EvoSim: ${(error as Error).message}` }; }
  };
  options(env: Record<string, string | undefined>): Partial<ClaudeSessionOptions> {
    const clean = { ...env };
    for (const key of SECRET_KEYS) delete clean[key];
    return {
      tools: ["Read", "Edit", "Write"], allowedTools: [], disallowedTools: ["Bash", "Task", "Agent", "Skill", "ToolSearch", "WebFetch", "WebSearch"],
      permissionMode: "default", settingSources: [], mcpServers: {}, strictMcpConfig: true,
      env: clean, toolGuard: this.guard,
      systemPromptAppend: "This is a bounded EvoSim coding session. Read the supplied project files and edit only engine/candidate.mjs. Shell, network, delegation and other tools are unavailable. Return the candidate and explain its changes; Hormes independently runs the trusted tests and benchmark in its sandbox. Do not claim those checks passed without their actual returned receipts.",
    };
  }
}

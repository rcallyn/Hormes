import type { WorkCommand, WorkReply, WorkState } from "../../../packages/protocol/src/work.ts";
export type { WorkCommand, WorkReply, WorkState };

declare global {
  interface Window {
    webkit?: { messageHandlers: { hormes: { postMessage(message: unknown): void } } };
    hormes: { receive(reply: WorkReply): void; flush(): Promise<void> };
    EXCALIDRAW_ASSET_PATH: string;
  }
}
const listeners = new Set<(reply: WorkReply) => void>();
const pending = new Map<string, { resolve(reply: WorkReply): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
export function native(action: string, value?: unknown): void { window.webkit?.messageHandlers.hormes.postMessage({ native: action, value }); }
window.hormes = {
  flush: async () => {},
  receive(reply) {
    const request = pending.get(reply.requestId);
    if (request) { clearTimeout(request.timer); pending.delete(reply.requestId); reply.ok ? request.resolve(reply) : request.reject(new Error(reply.message ?? "Could not save work.")); }
    listeners.forEach((listener) => listener(reply));
  },
};
export function subscribe(listener: (reply: WorkReply) => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function command(input: Omit<WorkCommand, "requestId">): Promise<WorkReply> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    if (!window.webkit) { reject(new Error("Open this workspace in Hormes to connect to saved work.")); return; }
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error("The daemon did not confirm this action. Your workspace remains open.")); }, 15000);
    pending.set(requestId, { resolve, reject, timer });
    window.webkit.messageHandlers.hormes.postMessage({ command: { ...input, requestId } });
  });
}
/** One in-flight save. Revision changes only on the daemon's acknowledgment. */
export class BoardSaves {
  private draft?: string;
  private saved: string;
  private flight?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private sessionId: string, private revision: number, scene: string | undefined, private status: (text: string) => void) { this.saved = scene ?? ""; }
  change(scene: string): void {
    if (scene === this.saved && !this.flight) return;
    this.draft = scene; clearTimeout(this.timer);
    this.status("Saving"); this.timer = setTimeout(() => { void this.flush().catch((e: Error) => this.status(e.message)); }, 500);
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.flight) await this.flight;
    if (!this.draft || this.draft === this.saved) return;
    const scene = this.draft;
    this.flight = (async () => {
      const reply = await command({ action: "scene.save", sessionId: this.sessionId, revision: this.revision, scene });
      this.revision = reply.state.sessions.find((s) => s.id === this.sessionId)?.sceneRevision ?? this.revision + 1;
      this.saved = scene; if (this.draft === scene) this.draft = undefined;
      this.status("Saved in Console");
    })();
    try { await this.flight; } finally { this.flight = undefined; }
    if (this.draft && this.draft !== this.saved) await this.flush();
  }
  dispose(): void { clearTimeout(this.timer); }
}

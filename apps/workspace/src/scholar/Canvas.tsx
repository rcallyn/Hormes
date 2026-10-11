// Adapted from Taz33m/scholar's canvas-excalidraw and retained plan compiler.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Excalidraw, CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI, ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import type { WorkSession } from "../../../../packages/protocol/src/work.ts";
import { canvasPlanSchema } from "../../../../packages/engine/src/work/canvas-plan.ts";
import { applyCanvasPlanToExcalidrawScene, type ExcalidrawSceneState } from "./excalidraw-canvas-adapter";
import { BoardSaves, command } from "../bridge";
import { Icon } from "../icons";

let handwritingReady: Promise<void> | undefined;
function loadHandwriting(): Promise<void> {
  // Load before converting elements so their bounds use the actual handwriting
  // metrics, rather than clipped fallback text. All assets stay in the bundle.
  return handwritingReady ??= (async () => {
    const url = new URL("fonts/Virgil/Virgil-Regular.woff2", window.EXCALIDRAW_ASSET_PATH);
    const face = await new FontFace("Virgil", `url("${url.href}")`).load();
    document.fonts.add(face);
    await document.fonts.load("26px Virgil");
  })();
}
export function Canvas({ session, onStatus, children }: { session: WorkSession; onStatus(text: string): void; children?: ReactNode }) {
  const [initial] = useState<ExcalidrawSceneState>(() => {
    const restored = session.scene ? JSON.parse(session.scene) : { elements: [], files: {}, appState: {} };
    return { ...restored, appState: { ...restored.appState, viewBackgroundColor: "#ffffff", currentItemStrokeColor: "#1e1e1e", currentItemFontFamily: 1, currentItemRoughness: 1 } };
  });
  const scene = useRef(initial);
  const board = useRef<HTMLDivElement>(null);
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [tool, setTool] = useState<"selection" | "freedraw" | "eraser">("freedraw");
  const saves = useRef<BoardSaves | null>(null);
  if (!saves.current) saves.current = new BoardSaves(session.id, session.sceneRevision, session.scene, onStatus);
  const applied = useRef(new Set<string>());
  const preparing = useRef(false);
  const mounted = useRef(true);
  const writing = useRef<Promise<void> | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    window.hormes.flush = async () => { if (writing.current) await writing.current; await saves.current!.flush(); };
    return () => { mounted.current = false; saves.current?.dispose(); window.hormes.flush = async () => {}; };
  }, []);
  useEffect(() => {
    if (!api || preparing.current || (session.surface && session.surface.kind !== "whiteboard")) return;
    api.setActiveTool({ type: "freedraw" });
    if (!session.exercise) return;
    preparing.current = true;
    void command({ action: "lesson.prepare", sessionId: session.id }).catch((error: Error) => onStatus(error.message));
  }, [api, session.id, session.exercise?.id, session.surface?.kind, onStatus]);
  useEffect(() => {
    const plan = session.pendingPlan;
    if (!api || !plan || applied.current.has(plan.id)) return;
    applied.current.add(plan.id);
    const job = (async () => {
      try {
        await loadHandwriting();
        if (!mounted.current) return;
        const next = applyCanvasPlanToExcalidrawScene({ elements: scene.current.elements, plan: canvasPlanSchema.parse(JSON.parse(plan.json)) });
        if (next.result.skippedOperations.length) throw new Error("The tutor could not apply this drawing step. Please ask it to retry.");
        const oldIds = new Set(scene.current.elements.map((element) => element.id));
        const ink = next.elements.filter((element) => !oldIds.has(element.id) && element.type === "text" && element.text);
        const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
        scene.current = { ...scene.current, elements: next.elements.map((element) => ink.includes(element) && !reduce ? { ...element, opacity: 0 } : element) };
        api.updateScene({ elements: scene.current.elements as never, captureUpdate: CaptureUpdateAction.NEVER });
        // A new hint must not recenter the entire lesson or disturb student pan.
        if (plan.purpose === "problem") api.scrollToContent(next.elements as never, { fitToContent: true, animate: !reduce, maxZoom: 1 });
        // Reveal editable handwritten lines progressively. No snapshots or separate
        // canvas renderer: the final ink remains ordinary Scholar scene objects.
        if (!reduce) for (const element of ink) {
          const letters = Array.from(element.text!);
          const frames = Math.min(28, letters.length);
          for (let frame = 1; frame <= frames; frame++) {
            await new Promise((resolve) => requestAnimationFrame(resolve));
            if (!mounted.current) return;
            const text = letters.slice(0, Math.ceil(frame / frames * letters.length)).join("");
            scene.current = { ...scene.current, elements: scene.current.elements.map((current) => current.id === element.id ? { ...element, text, originalText: text } : current) };
            api.updateScene({ elements: scene.current.elements as never, captureUpdate: CaptureUpdateAction.NEVER });
          }
        }
        api.updateScene({ elements: scene.current.elements as never, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
        saves.current!.change(JSON.stringify(scene.current));
        await saves.current!.flush();
        await command({ action: "board.applied", sessionId: session.id, planId: plan.id, success: true });
      } catch (error) {
        onStatus((error as Error).message);
        await command({ action: "board.applied", sessionId: session.id, planId: plan.id, success: false }).catch(() => {});
      }
    })();
    writing.current = job;
    void job.finally(() => { if (writing.current === job) writing.current = undefined; });
  }, [api, session.pendingPlan?.id, session.id, onStatus]);
  return <div className="board" ref={board}><Excalidraw excalidrawAPI={setApi}
    initialData={initial as unknown as ExcalidrawInitialDataState}
    theme="dark" langCode="en" autoFocus={!session.surface || session.surface.kind === "whiteboard"}
    UIOptions={{ canvasActions: { changeViewBackgroundColor: false, clearCanvas: false, export: false, loadScene: false, saveAsImage: false, saveToActiveFile: false, toggleTheme: false }, tools: { image: false } }}
    onChange={(elements, appState, files) => {
      scene.current = { elements: [...elements] as never, files, appState: { viewBackgroundColor: "#ffffff", scrollX: appState.scrollX, scrollY: appState.scrollY, zoom: appState.zoom, currentItemStrokeColor: appState.currentItemStrokeColor, currentItemFontFamily: 1, currentItemRoughness: 1 } };
      if (appState.activeTool.type === "selection" || appState.activeTool.type === "freedraw" || appState.activeTool.type === "eraser") setTool(appState.activeTool.type);
      if (!writing.current) saves.current!.change(JSON.stringify(scene.current));
    }} />
    <div className="ink-controls" role="toolbar" aria-label="Whiteboard controls">
      {([ ["selection", "select", "Select and move ink"], ["freedraw", "pen", "Write by hand"], ["eraser", "eraser", "Erase ink"] ] as const).map(([type, icon, label]) =>
        <button key={type} className="icon-button" aria-label={label} aria-pressed={tool === type} onClick={() => {
          api?.setActiveTool({ type }); setTool(type);
          // These controls sit outside Excalidraw's own toolbar. Return focus
          // to this editor so shortcuts affect ink rather than the page text.
          board.current?.querySelector<HTMLElement>(".excalidraw")?.focus({ preventScroll: true });
        }}><Icon name={icon} /></button>)}
      {children}
    </div>
  </div>;
}

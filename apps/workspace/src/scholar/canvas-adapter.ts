import type { ExecuteCanvasPlanResult } from "./canvas-executor";
import type { CanvasNodeShape, CanvasPlan, CanvasScene } from "../../../../packages/engine/src/work/canvas-plan.ts";

export interface CanvasFixtureShape {
  id?: string;
  type?: "geo" | "text";
  text: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  color?: string;
  shape?: CanvasNodeShape;
  textBinding?: "helper" | "bound";
}

export interface CanvasFixture {
  clearExisting?: boolean;
  shapes: CanvasFixtureShape[];
}

export interface CanvasAdapter {
  isReady(): boolean;
  serializeScene(): CanvasScene;
  captureImage(): Promise<string>;
  applyPlan(plan: CanvasPlan): Promise<ExecuteCanvasPlanResult>;
  clearScene(): Promise<void>;
  seedFixture(fixture: CanvasFixture): Promise<void>;
  loadPersistedScene(): Promise<void>;
  removePersistedScene(): void;
  refresh(): void;
}

export const canvasRef = {
  current: null as CanvasAdapter | null,
};

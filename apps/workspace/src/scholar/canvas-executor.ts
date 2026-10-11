import type { CanvasOperation, CanvasPlan } from "../../../../packages/engine/src/work/canvas-plan.ts";
export interface ExecuteCanvasPlanResult {
  summary: string;
  operationCount: number;
  appliedOperationCount: number;
  changedShapeIds: string[];
  skippedOperations: CanvasSkippedOperation[];
  diagnostics?: CanvasExecutionDiagnostics;
}

export interface CanvasSkippedOperation {
  operationIndex: number;
  operationType: CanvasOperation["type"];
  reason: string;
  targetShapeRef?: string;
}

export interface CanvasCompiledOperationDebug {
  operationIndex: number;
  type: CanvasOperation["type"];
  targetShapeRefs: string[];
}

export interface CanvasExecutionDiagnostics {
  sceneSummary?: Record<string, unknown>;
  plan?: CanvasPlan;
  compiledOperations?: CanvasCompiledOperationDebug[];
  execution?: {
    operationCount: number;
    appliedOperationCount: number;
    changedShapeCount: number;
  };
}


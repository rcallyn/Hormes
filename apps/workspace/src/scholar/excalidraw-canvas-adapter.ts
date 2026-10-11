import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  exportToBlob,
} from "@excalidraw/excalidraw";

import type { CanvasAdapter, CanvasFixture } from "./canvas-adapter";
import {
  canvasSceneSchema,
  type CanvasColor,
  type CanvasOperation,
  type CanvasPlan,
  type CanvasScene,
} from "../../../../packages/engine/src/work/canvas-plan.ts";
import type {
  CanvasCompiledOperationDebug,
  CanvasExecutionDiagnostics,
  CanvasSkippedOperation,
  ExecuteCanvasPlanResult,
} from "./canvas-executor";

type ExcalidrawAppStateLike = Record<string, unknown>;
type BinaryFilesLike = Record<string, unknown>;
export type CaptureUpdateActionType =
  (typeof CaptureUpdateAction)[keyof typeof CaptureUpdateAction];

export interface ExcalidrawElementLike {
  id: string;
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  angle?: number;
  strokeColor?: string;
  backgroundColor?: string;
  fillStyle?: string;
  strokeStyle?: string;
  opacity?: number;
  points?: Array<[number, number] | { x: number; y: number }>;
  text?: string;
  fileId?: string;
  isDeleted?: boolean;
  locked?: boolean;
  containerId?: string | null;
  boundElements?: Array<{ id: string; type: string }>;
  customData?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ExcalidrawSceneState {
  elements: ExcalidrawElementLike[];
  appState: ExcalidrawAppStateLike;
  files: BinaryFilesLike;
}

interface PersistedAppState {
  scrollX?: number;
  scrollY?: number;
  viewBackgroundColor?: string;
  zoom?: unknown;
}

interface PersistedExcalidrawScene {
  version: 1;
  elements: ExcalidrawElementLike[];
  appState: PersistedAppState;
  files: BinaryFilesLike;
}

export interface CanvasExcalidrawApi {
  id?: string;
  updateScene: (scene: Record<string, unknown>) => void;
  updateLibrary?: (options: {
    libraryItems: unknown;
    merge?: boolean;
    defaultStatus?: "published" | "unpublished";
  }) => Promise<unknown>;
  toggleSidebar?: (options: {
    name: string | null;
    tab?: string;
    force?: boolean;
  }) => boolean;
  getAppState?: () => Record<string, unknown>;
  refresh?: () => void;
  scrollToContent?: (
    elements: readonly Record<string, unknown>[],
    options?: Record<string, unknown>,
  ) => void;
}

const EXCALIDRAW_PERSISTENCE_VERSION = 1;
const DEFAULT_GEO_WIDTH = 220;
const DEFAULT_GEO_HEIGHT = 110;

type HelperRole =
  | "annotation"
  | "connector-label"
  | "emphasis"
  | "node-label";

type SupportedLogicalType = "geo" | "text" | "arrow" | "image";

type ExcalidrawSceneSummary = {
  collapsedBoundTextCount: number;
  editableShapeCount: number;
  helperElementCount: number;
  hiddenUnsupportedElementCount: number;
  totalVisibleElementCount: number;
  visibleElementTypes: Record<string, number>;
};

interface CompiledCanvasOperation {
  operation: CanvasOperation;
  operationIndex: number;
}

interface CompiledCanvasPlan {
  operations: CompiledCanvasOperation[];
  scene: CanvasScene;
  sceneSummary: ExcalidrawSceneSummary;
  skippedOperations: CanvasSkippedOperation[];
}

const LOGICAL_COLOR_TO_STROKE: Record<string, string> = {
  black: "#0f172a",
  blue: "#2563eb",
  green: "#16a34a",
  grey: "#64748b",
  "light-blue": "#2563eb",
  "light-green": "#16a34a",
  "light-red": "#dc2626",
  "light-violet": "#7c3aed",
  orange: "#ea580c",
  red: "#dc2626",
  violet: "#7c3aed",
  white: "#ffffff",
  yellow: "#ca8a04",
};

const LOGICAL_COLOR_TO_BACKGROUND: Record<string, string> = {
  black: "#cbd5e1",
  blue: "#dbeafe",
  green: "#dcfce7",
  grey: "#e2e8f0",
  "light-blue": "#dbeafe",
  "light-green": "#dcfce7",
  "light-red": "#fee2e2",
  "light-violet": "#ede9fe",
  orange: "#ffedd5",
  red: "#fee2e2",
  violet: "#ede9fe",
  white: "#ffffff",
  yellow: "#fef3c7",
};

const STROKE_TO_LOGICAL_COLOR = new Map(
  Object.entries(LOGICAL_COLOR_TO_STROKE).map(([logicalColor, strokeColor]) => [
    strokeColor.toLowerCase(),
    logicalColor,
  ]),
);

const createCanvasElementId = (prefix: string) =>
  `canvas-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const normalizeArrayPoint = (
  point: [number, number] | { x: number; y: number },
) => {
  if (Array.isArray(point)) {
    return { x: point[0] ?? 0, y: point[1] ?? 0 };
  }
  return {
    x: typeof point.x === "number" ? point.x : 0,
    y: typeof point.y === "number" ? point.y : 0,
  };
};

const isCssColorString = (value: string) =>
  value.startsWith("#") ||
  value.startsWith("rgb(") ||
  value.startsWith("rgba(") ||
  value.startsWith("hsl(") ||
  value.startsWith("hsla(");

const mapColorToStroke = (color?: string) => {
  if (!color) {
    return LOGICAL_COLOR_TO_STROKE.black;
  }

  if (isCssColorString(color)) {
    return color;
  }

  switch (color) {
    case "black":
    case "blue":
    case "green":
    case "grey":
    case "light-blue":
    case "light-green":
    case "light-red":
    case "light-violet":
    case "orange":
    case "red":
    case "violet":
    case "white":
    case "yellow":
      return LOGICAL_COLOR_TO_STROKE[color];
    default:
      return color;
  }
};

const mapColorToBackground = (color?: string, transparent = false) => {
  if (transparent) {
    return "transparent";
  }

  if (!color) {
    return "#ffffff";
  }

  if (isCssColorString(color)) {
    return color;
  }

  switch (color) {
    case "black":
    case "blue":
    case "green":
    case "grey":
    case "light-blue":
    case "light-green":
    case "light-red":
    case "light-violet":
    case "orange":
    case "red":
    case "violet":
    case "white":
    case "yellow":
      return LOGICAL_COLOR_TO_BACKGROUND[color];
    default:
      return color;
  }
};

const mapGeoShape = (shape?: string) => {
  switch (shape) {
    case "ellipse":
      return "ellipse";
    case "diamond":
      return "diamond";
    default:
      return "rectangle";
  }
};

const blobToDataUrl = async (blob: Blob) => {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Failed to convert blob to data URL"));
    reader.readAsDataURL(blob);
  });
};

const cloneElement = (element: ExcalidrawElementLike): ExcalidrawElementLike => ({
  ...element,
  boundElements: Array.isArray(element.boundElements)
    ? element.boundElements.map((entry) => ({ ...entry }))
    : undefined,
  customData:
    element.customData && typeof element.customData === "object"
      ? { ...element.customData }
      : undefined,
  points: Array.isArray(element.points)
    ? element.points.map((point) =>
        Array.isArray(point) ? [point[0], point[1]] : { ...point },
      )
    : undefined,
});

const createElements = (skeletons: Array<Record<string, unknown>>) => {
  return convertToExcalidrawElements(skeletons.map((s) => ({ roughness: 1, fontFamily: 1, ...s })) as never, {
    regenerateIds: false,
  }) as unknown as ExcalidrawElementLike[];
};

const createTextElement = ({
  id,
  text,
  x,
  y,
  color,
  customData,
  fontSize,
}: {
  id: string;
  text: string;
  x: number;
  y: number;
  color?: CanvasColor | string;
  customData?: Record<string, unknown>;
  fontSize?: number;
}) => {
  return createElements([
    {
      id,
      type: "text",
      x,
      y,
      text,
      fontSize: fontSize ?? 20,
      strokeColor: mapColorToStroke(color),
      backgroundColor: "transparent",
      customData,
    },
  ])[0];
};

const createGeoElement = ({
  id,
  shape,
  x,
  y,
  w,
  h,
  color,
  transparent,
  dash,
  customData,
}: {
  id: string;
  shape: "rectangle" | "ellipse" | "diamond";
  x: number;
  y: number;
  w: number;
  h: number;
  color?: CanvasColor | string;
  transparent?: boolean;
  dash?: "solid" | "dashed" | "dotted";
  customData?: Record<string, unknown>;
}) => {
  return createElements([
    {
      id,
      type: shape,
      x,
      y,
      width: w,
      height: h,
      strokeColor: mapColorToStroke(color),
      backgroundColor: mapColorToBackground(color, transparent),
      fillStyle: "solid",
      strokeStyle: dash ?? "solid",
      strokeWidth: 2,
      customData,
    },
  ])[0];
};

const createArrowElement = ({
  id,
  start,
  end,
  color,
  customData,
}: {
  id: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
  color?: CanvasColor | string;
  customData?: Record<string, unknown>;
}) => {
  return createElements([
    {
      id,
      type: "arrow",
      x: start.x,
      y: start.y,
      points: [
        [0, 0],
        [end.x - start.x, end.y - start.y],
      ],
      strokeColor: mapColorToStroke(color),
      backgroundColor: "transparent",
      strokeWidth: 2,
      customData,
    },
  ])[0];
};

const getHelperRole = (element: ExcalidrawElementLike): HelperRole | null => {
  const role = element.customData?.role;
  if (
    role === "annotation" ||
    role === "connector-label" ||
    role === "emphasis" ||
    role === "node-label"
  ) {
    return role;
  }
  return null;
};

const getOwnerId = (element: ExcalidrawElementLike) => {
  const ownerId = element.customData?.ownerId;
  return typeof ownerId === "string" ? ownerId : null;
};

const getOperationTargetShapeRefs = (operation: CanvasOperation): string[] => {
  switch (operation.type) {
    case "annotate":
    case "emphasize":
    case "replace_text":
    case "move":
    case "delete":
      return [operation.targetShapeRef];
    case "connect":
      return [operation.fromShapeRef, operation.toShapeRef];
    case "create_node":
    case "write":
      return [];
  }
};

const getPrimaryTargetShapeRef = (operation: CanvasOperation) => {
  switch (operation.type) {
    case "annotate":
    case "emphasize":
    case "replace_text":
    case "move":
    case "delete":
      return operation.targetShapeRef;
    case "connect":
      return operation.fromShapeRef;
    case "create_node":
    case "write":
      return undefined;
  }
};

const getLogicalBounds = (element: ExcalidrawElementLike) => {
  if (element.type === "arrow" && Array.isArray(element.points) && element.points.length > 0) {
    const points = element.points.map(normalizeArrayPoint);
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return {
      x: element.x + minX,
      y: element.y + minY,
      w: Math.max(1, maxX - minX),
      h: Math.max(1, maxY - minY),
    };
  }

  return {
    x: element.x,
    y: element.y,
    w: Math.max(1, typeof element.width === "number" ? element.width : 1),
    h: Math.max(1, typeof element.height === "number" ? element.height : 1),
  };
};

const getShapeCenter = (element: ExcalidrawElementLike) => {
  const bounds = getLogicalBounds(element);
  return {
    x: bounds.x + bounds.w / 2,
    y: bounds.y + bounds.h / 2,
    bounds,
  };
};

// Connect outside a node's content rather than drawing through its centered text.
const connectorEdge = (element: ExcalidrawElementLike, toward: { x: number; y: number }) => {
  const center = getShapeCenter(element);
  const dx = toward.x - center.x, dy = toward.y - center.y;
  if (!dx && !dy) return { x: center.x, y: center.y };
  const rx = center.bounds.w / 2, ry = center.bounds.h / 2;
  const scale = element.type === "ellipse" ? 1 / Math.hypot(dx / rx, dy / ry)
    : element.type === "diamond" ? 1 / (Math.abs(dx) / rx + Math.abs(dy) / ry)
    : 1 / Math.max(Math.abs(dx) / rx, Math.abs(dy) / ry);
  const length = Math.hypot(dx, dy), gap = 8;
  return { x: center.x + dx * scale + dx / length * gap, y: center.y + dy * scale + dy / length * gap };
};

const findHelperElements = (
  elements: ExcalidrawElementLike[],
  ownerId: string,
  roles?: HelperRole[],
) => {
  return elements.filter((element) => {
    if (element.isDeleted) {
      return false;
    }

    const elementOwnerId = getOwnerId(element);
    if (elementOwnerId !== ownerId) {
      return false;
    }

    if (!roles || roles.length === 0) {
      return true;
    }

    const role = getHelperRole(element);
    return role !== null && roles.includes(role);
  });
};

const findBoundTextElement = (
  elementsById: Map<string, ExcalidrawElementLike>,
  owner: ExcalidrawElementLike,
) => {
  const fromBoundElements = owner.boundElements?.find((entry) => entry.type === "text");
  if (fromBoundElements) {
    return elementsById.get(fromBoundElements.id) ?? null;
  }

  for (const element of elementsById.values()) {
    if (element.type === "text" && element.containerId === owner.id) {
      return element;
    }
  }

  return null;
};

const getMergedLogicalText = ({
  element,
  elementsById,
  helperTextByOwnerId,
}: {
  element: ExcalidrawElementLike;
  elementsById: Map<string, ExcalidrawElementLike>;
  helperTextByOwnerId: Map<string, string>;
}) => {
  if (element.type === "text") {
    return typeof element.text === "string" && element.text.length > 0
      ? element.text
      : null;
  }

  const helperText = helperTextByOwnerId.get(element.id);
  if (helperText) {
    return helperText;
  }

  const boundText = findBoundTextElement(elementsById, element);
  if (boundText && typeof boundText.text === "string" && boundText.text.length > 0) {
    return boundText.text;
  }

  return null;
};

const getAnnotationPosition = (
  bounds: { x: number; y: number; w: number; h: number },
  placement: "above" | "below" | "left" | "right" | "center",
) => {
  const gap = 24;

  switch (placement) {
    case "above":
      return { x: Math.max(24, bounds.x), y: Math.max(24, bounds.y - gap - 20) };
    case "below":
      return { x: Math.max(24, bounds.x), y: Math.max(24, bounds.y + bounds.h + gap) };
    case "left":
      return { x: Math.max(24, bounds.x - 180 - gap), y: Math.max(24, bounds.y) };
    case "right":
      return { x: Math.max(24, bounds.x + bounds.w + gap), y: Math.max(24, bounds.y) };
    case "center":
    default:
      return {
        x: Math.max(24, bounds.x + bounds.w / 2 - 80),
        y: Math.max(24, bounds.y + bounds.h / 2 - 10),
      };
  }
};

const createNodeLabel = ({
  ownerId,
  text,
  x,
  y,
  w,
  h,
}: {
  ownerId: string;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}) => {
  const label = createTextElement({
    id: createCanvasElementId("node-label"),
    text,
    x,
    y,
    customData: {
      ownerId,
      role: "node-label",
    },
  });

  const labelWidth = typeof label.width === "number" ? label.width : 140;
  const labelHeight = typeof label.height === "number" ? label.height : 32;
  label.x = x + (w - labelWidth) / 2;
  label.y = y + (h - labelHeight) / 2;
  return label;
};

const createBoundNodeLabel = ({
  ownerId,
  text,
  x,
  y,
  w,
  h,
}: {
  ownerId: string;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}) => {
  const label = createTextElement({
    id: createCanvasElementId("bound-node-label"),
    text,
    x,
    y,
  });

  const labelWidth = typeof label.width === "number" ? label.width : 140;
  const labelHeight = typeof label.height === "number" ? label.height : 32;

  return {
    ...label,
    containerId: ownerId,
    x: x + (w - labelWidth) / 2,
    y: y + (h - labelHeight) / 2,
  };
};

const createConnectorLabel = ({
  ownerId,
  text,
  from,
  to,
}: {
  ownerId: string;
  text: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
}) => {
  const midpoint = {
    x: (from.x + to.x) / 2,
    y: (from.y + to.y) / 2,
  };
  const label = createTextElement({
    id: createCanvasElementId("connector-label"),
    text,
    x: midpoint.x,
    y: midpoint.y - 24,
    customData: {
      ownerId,
      role: "connector-label",
    },
  });

  const width = typeof label.width === "number" ? label.width : 140;
  label.x = midpoint.x - width / 2;
  return label;
};

const updateTextElement = ({
  element,
  text,
  x,
  y,
}: {
  element: ExcalidrawElementLike;
  text: string;
  x?: number;
  y?: number;
}) => {
  const next = createTextElement({
    id: element.id,
    text,
    x: typeof x === "number" ? x : element.x,
    y: typeof y === "number" ? y : element.y,
    color:
      typeof element.strokeColor === "string" ? element.strokeColor : undefined,
    customData: element.customData,
  });

  return {
    ...element,
    ...next,
    containerId:
      typeof element.containerId === "string"
        ? element.containerId
        : next.containerId ?? null,
    customData: element.customData,
  };
};

const getLogicalType = (
  element: ExcalidrawElementLike,
): SupportedLogicalType | null => {
  switch (element.type) {
    case "rectangle":
    case "ellipse":
    case "diamond":
      return "geo";
    case "text":
      return "text";
    case "arrow":
    case "line":
      return "arrow";
    case "image":
      return "image";
    default:
      return null;
  }
};

const isPlannerVisibleElement = (element: ExcalidrawElementLike) => {
  if (element.isDeleted) {
    return false;
  }

  const role = getHelperRole(element);
  if (role === "node-label" || role === "connector-label") {
    return false;
  }

  return getLogicalType(element) !== null;
};

const isCollapsedBoundTextElement = (
  element: ExcalidrawElementLike,
  elementsById: Map<string, ExcalidrawElementLike>,
) => {
  if (element.type !== "text" || typeof element.containerId !== "string") {
    return false;
  }

  const owner = elementsById.get(element.containerId);
  return Boolean(owner && owner.type !== "text" && getLogicalType(owner) !== null);
};

const shouldExposeElementInPlannerScene = (
  element: ExcalidrawElementLike,
  elementsById: Map<string, ExcalidrawElementLike>,
) => isPlannerVisibleElement(element) && !isCollapsedBoundTextElement(element, elementsById);

const buildExcalidrawSceneSummary = (
  elements: ExcalidrawElementLike[],
): ExcalidrawSceneSummary => {
  const visibleElements = elements.filter((element) => !element.isDeleted);
  const elementsById = new Map(visibleElements.map((element) => [element.id, element]));
  const visibleElementTypes = visibleElements.reduce<Record<string, number>>(
    (accumulator, element) => {
      accumulator[element.type] = (accumulator[element.type] ?? 0) + 1;
      return accumulator;
    },
    {},
  );

  const helperElementCount = visibleElements.filter(
    (element) => getHelperRole(element) !== null,
  ).length;
  const collapsedBoundTextCount = visibleElements.filter((element) =>
    isCollapsedBoundTextElement(element, elementsById),
  ).length;
  const editableShapeCount = visibleElements.filter((element) =>
    shouldExposeElementInPlannerScene(element, elementsById),
  ).length;

  return {
    collapsedBoundTextCount,
    editableShapeCount,
    helperElementCount,
    hiddenUnsupportedElementCount:
      visibleElements.length -
      editableShapeCount -
      helperElementCount -
      collapsedBoundTextCount,
    totalVisibleElementCount: visibleElements.length,
    visibleElementTypes,
  };
};

const canReplaceTextInSceneShape = (shape: CanvasScene["shapes"][number]) => {
  if (shape.type === "text") {
    return true;
  }

  if (shape.type === "geo" || shape.type === "arrow") {
    return typeof shape.text === "string" && shape.text.trim().length > 0;
  }

  return false;
};

const createSkippedOperation = ({
  operation,
  operationIndex,
  reason,
}: {
  operation: CanvasOperation;
  operationIndex: number;
  reason: string;
}): CanvasSkippedOperation => ({
  operationIndex,
  operationType: operation.type,
  reason,
  targetShapeRef: getPrimaryTargetShapeRef(operation),
});

const buildCompiledOperationDebug = (
  operations: CompiledCanvasOperation[],
): CanvasCompiledOperationDebug[] =>
  operations.map(({ operation, operationIndex }) => ({
    operationIndex,
    type: operation.type,
    targetShapeRefs: getOperationTargetShapeRefs(operation),
  }));

export const compileCanvasPlanForExcalidraw = ({
  elements,
  plan,
}: {
  elements: ExcalidrawElementLike[];
  plan: CanvasPlan;
}): CompiledCanvasPlan => {
  const scene = serializeExcalidrawScene(elements);
  const sceneSummary = buildExcalidrawSceneSummary(elements);
  const knownRefs = new Map(scene.shapes.map((shape) => [shape.id, shape]));
  const knownTempIds = new Set<string>();
  const operations: CompiledCanvasOperation[] = [];
  const skippedOperations: CanvasSkippedOperation[] = [];

  plan.operations.forEach((operation, operationIndex) => {
    if (operation.type === "create_node" || operation.type === "write") {
      if (knownTempIds.has(operation.tempId)) {
        skippedOperations.push(
          createSkippedOperation({
            operation,
            operationIndex,
            reason: `Duplicate temp id: ${operation.tempId}`,
          }),
        );
        return;
      }

      knownTempIds.add(operation.tempId);
      operations.push({ operation, operationIndex });
      return;
    }

    const missingRefs = getOperationTargetShapeRefs(operation).filter((shapeRef) => {
      return !knownRefs.has(shapeRef) && !knownTempIds.has(shapeRef);
    });
    if (missingRefs.length > 0) {
      skippedOperations.push(
        createSkippedOperation({
          operation,
          operationIndex,
          reason: `Unknown canvas shape reference: ${missingRefs.join(", ")}`,
        }),
      );
      return;
    }

    if (operation.type === "replace_text" && !knownTempIds.has(operation.targetShapeRef)) {
      const targetShape = knownRefs.get(operation.targetShapeRef);
      if (!targetShape || !canReplaceTextInSceneShape(targetShape)) {
        skippedOperations.push(
          createSkippedOperation({
            operation,
            operationIndex,
            reason: `Shape ${operation.targetShapeRef} does not expose replaceable text`,
          }),
        );
        return;
      }
    }

    operations.push({ operation, operationIndex });
  });

  return {
    operations,
    scene,
    sceneSummary,
    skippedOperations,
  };
};

const getPersistedAppState = (appState: ExcalidrawAppStateLike): PersistedAppState => ({
  scrollX: typeof appState.scrollX === "number" ? appState.scrollX : undefined,
  scrollY: typeof appState.scrollY === "number" ? appState.scrollY : undefined,
  viewBackgroundColor:
    typeof appState.viewBackgroundColor === "string"
      ? appState.viewBackgroundColor
      : "#ffffff",
  zoom: appState.zoom,
});

const mapStrokeToLogicalColor = (color?: string) => {
  if (!color) {
    return null;
  }

  const normalized = color.trim().toLowerCase();
  return STROKE_TO_LOGICAL_COLOR.get(normalized) ?? null;
};

const collectRelatedElements = ({
  elements,
  elementsById,
  owner,
}: {
  elements: ExcalidrawElementLike[];
  elementsById: Map<string, ExcalidrawElementLike>;
  owner: ExcalidrawElementLike;
}) => {
  const related = [...findHelperElements(elements, owner.id)];
  const boundText = findBoundTextElement(elementsById, owner);
  if (boundText && !related.some((element) => element.id === boundText.id)) {
    related.push(boundText);
  }
  return related;
};

export const serializeExcalidrawScene = (
  elements: ExcalidrawElementLike[],
): CanvasScene => {
  const visibleElements = elements.filter((element) => !element.isDeleted);
  const elementsById = new Map(visibleElements.map((element) => [element.id, element]));
  const helperTextByOwnerId = new Map<string, string>();

  visibleElements.forEach((element) => {
    const role = getHelperRole(element);
    const ownerId = getOwnerId(element);
    if (
      ownerId &&
      (role === "node-label" || role === "connector-label") &&
      typeof element.text === "string" &&
      element.text.length > 0
    ) {
      helperTextByOwnerId.set(ownerId, element.text);
    }
  });

  const shapes = visibleElements
    .filter((element) => shouldExposeElementInPlannerScene(element, elementsById))
    .flatMap((element) => {
      const logicalType = getLogicalType(element);
      if (!logicalType) {
        return [];
      }

      const bounds = getLogicalBounds(element);
      return [{
        id: element.id,
        type: logicalType,
        text: getMergedLogicalText({
          element,
          elementsById,
          helperTextByOwnerId,
        }),
        bounds,
        style: {
          color:
            typeof element.strokeColor === "string"
              ? mapStrokeToLogicalColor(element.strokeColor)
              : null,
          dash:
            typeof element.strokeStyle === "string" ? element.strokeStyle : null,
          fill:
            typeof element.backgroundColor === "string"
              ? element.backgroundColor === "transparent"
                ? "none"
                : "solid"
              : null,
        },
        isLocked: Boolean(element.locked),
      }];
    })
    .sort((left, right) => {
      if ((left.bounds?.y ?? 0) !== (right.bounds?.y ?? 0)) {
        return (left.bounds?.y ?? 0) - (right.bounds?.y ?? 0);
      }
      return (left.bounds?.x ?? 0) - (right.bounds?.x ?? 0);
    });

  return canvasSceneSchema.parse({
    shapes,
  });
};

export const captureExcalidrawSceneImage = async ({
  elements,
  appState,
  files,
}: ExcalidrawSceneState) => {
  const visibleElements = elements.filter((element) => !element.isDeleted);
  if (visibleElements.length === 0) {
    throw new Error("Canvas is empty");
  }

  const blob = await exportToBlob({
    elements: visibleElements as never,
    appState: {
      ...appState,
      exportBackground: true,
      exportWithDarkMode: false,
      viewBackgroundColor:
        typeof appState.viewBackgroundColor === "string"
          ? appState.viewBackgroundColor
          : "#ffffff",
    } as never,
    files: files as never,
    mimeType: "image/png",
    exportPadding: 12,
  });

  return blobToDataUrl(blob);
};

const resolveShapeRef = (
  elementsById: Map<string, ExcalidrawElementLike>,
  aliases: Map<string, string>,
  shapeRef: string,
) => {
  const resolvedId = aliases.get(shapeRef) ?? shapeRef;
  const element = elementsById.get(resolvedId);
  if (!element || element.isDeleted) {
    throw new Error(`Canvas shape not found: ${shapeRef}`);
  }
  return element;
};

const replaceElement = (
  elementsById: Map<string, ExcalidrawElementLike>,
  nextElements: ExcalidrawElementLike[],
  next: ExcalidrawElementLike,
) => {
  elementsById.set(next.id, next);
  const index = nextElements.findIndex((entry) => entry.id === next.id);
  if (index >= 0) {
    nextElements[index] = next;
  } else {
    nextElements.push(next);
  }
};

const removeElement = (
  elementsById: Map<string, ExcalidrawElementLike>,
  nextElements: ExcalidrawElementLike[],
  id: string,
) => {
  elementsById.delete(id);
  const index = nextElements.findIndex((entry) => entry.id === id);
  if (index >= 0) {
    nextElements.splice(index, 1);
  }
};

export const applyCanvasPlanToExcalidrawScene = ({
  elements,
  plan,
}: {
  elements: ExcalidrawElementLike[];
  plan: CanvasPlan;
}): {
  elements: ExcalidrawElementLike[];
  result: ExecuteCanvasPlanResult;
} => {
  const compiledPlan = compileCanvasPlanForExcalidraw({ elements, plan });
  const nextElements = elements.filter((element) => !element.isDeleted).map(cloneElement);
  const elementsById = new Map(nextElements.map((element) => [element.id, element]));
  const aliases = new Map<string, string>();
  const changedShapeIds = new Set<string>();
  const skippedOperations = [...compiledPlan.skippedOperations];

  for (const { operation, operationIndex } of compiledPlan.operations) {
    try {
      switch (operation.type) {
        case "write": {
          const ink = createTextElement({ id: createCanvasElementId("ink"), text: operation.text,
            x: operation.x, y: operation.y, color: operation.color ?? "black", fontSize: operation.fontSize ?? 26,
            customData: { author: "tutor", role: "handwriting" } });
          aliases.set(operation.tempId, ink.id);
          replaceElement(elementsById, nextElements, ink);
          changedShapeIds.add(ink.id);
          break;
        }
        case "annotate": {
          const target = resolveShapeRef(elementsById, aliases, operation.targetShapeRef);
          const position = getAnnotationPosition(
            getShapeCenter(target).bounds,
            operation.placement,
          );
          const label = createTextElement({
            id: createCanvasElementId("annotation"),
            text: operation.text,
            x: position.x,
            y: position.y,
            color: operation.color ?? "black",
            customData: {
              ownerId: target.id,
              role: "annotation",
            },
          });
          replaceElement(elementsById, nextElements, label);
          changedShapeIds.add(label.id);
          break;
        }
        case "emphasize": {
          const target = resolveShapeRef(elementsById, aliases, operation.targetShapeRef);
          const { bounds } = getShapeCenter(target);
          const region = operation.region
            ? {
                x: bounds.x + bounds.w * operation.region.x,
                y: bounds.y + bounds.h * operation.region.y,
                w: Math.max(16, bounds.w * operation.region.w),
                h: Math.max(16, bounds.h * operation.region.h),
              }
            : bounds;
          const shape =
            operation.style === "circle"
              ? "ellipse"
              : "rectangle";
          const emphasis = createGeoElement({
            id: createCanvasElementId("emphasis"),
            shape,
            x: region.x - (operation.style === "highlight" ? 0 : 20),
            y: region.y - (operation.style === "highlight" ? 0 : 20),
            w: region.w + (operation.style === "highlight" ? 0 : 40),
            h: region.h + (operation.style === "highlight" ? 0 : 40),
            color:
              operation.color ??
              (operation.style === "highlight" ? "yellow" : "orange"),
            transparent: operation.style !== "highlight",
            dash: operation.style === "highlight" ? "solid" : "dashed",
            customData: {
              ownerId: target.id,
              role: "emphasis",
            },
          });
          if (operation.style === "highlight") {
            emphasis.opacity = 45;
          }
          replaceElement(elementsById, nextElements, emphasis);
          changedShapeIds.add(emphasis.id);
          break;
        }
        case "connect": {
          const from = resolveShapeRef(elementsById, aliases, operation.fromShapeRef);
          const to = resolveShapeRef(elementsById, aliases, operation.toShapeRef);
          const fromCenter = getShapeCenter(from);
          const toCenter = getShapeCenter(to);
          const start = connectorEdge(from, toCenter);
          const end = connectorEdge(to, fromCenter);
          const arrow = createArrowElement({
            id: createCanvasElementId("arrow"),
            start,
            end,
            color: operation.color ?? "black",
          });
          replaceElement(elementsById, nextElements, arrow);
          changedShapeIds.add(arrow.id);

          if (operation.label) {
            const label = createConnectorLabel({
              ownerId: arrow.id,
              text: operation.label,
              from: start,
              to: end,
            });
            replaceElement(elementsById, nextElements, label);
            changedShapeIds.add(label.id);
          }
          break;
        }
        case "create_node": {
          if (aliases.has(operation.tempId)) {
            throw new Error(`Duplicate tempId in canvas plan: ${operation.tempId}`);
          }
          const elementId = createCanvasElementId("node");
          const geo = createGeoElement({
            id: elementId,
            shape: mapGeoShape(operation.shape),
            x: operation.x,
            y: operation.y,
            w: operation.w ?? DEFAULT_GEO_WIDTH,
            h: operation.h ?? DEFAULT_GEO_HEIGHT,
            color: operation.color ?? "blue",
            transparent: true,
            dash: "solid",
          });
          replaceElement(elementsById, nextElements, geo);
          changedShapeIds.add(geo.id);
          aliases.set(operation.tempId, geo.id);

          const label = createNodeLabel({
            ownerId: geo.id,
            text: operation.text,
            x: operation.x,
            y: operation.y,
            w: operation.w ?? DEFAULT_GEO_WIDTH,
            h: operation.h ?? DEFAULT_GEO_HEIGHT,
          });
          geo.width = Math.max(geo.width ?? 0, (label.width ?? 0) + 32);
          geo.height = Math.max(geo.height ?? 0, (label.height ?? 0) + 32);
          label.x = geo.x + (geo.width - (label.width ?? 0)) / 2;
          label.y = geo.y + (geo.height - (label.height ?? 0)) / 2;
          replaceElement(elementsById, nextElements, label);
          changedShapeIds.add(label.id);
          break;
        }
        case "replace_text": {
          const target = resolveShapeRef(elementsById, aliases, operation.targetShapeRef);
          if (target.type === "text") {
            const next = updateTextElement({
              element: target,
              text: operation.text,
            });
            replaceElement(elementsById, nextElements, next);
            changedShapeIds.add(next.id);
            break;
          }

          const helper =
            findHelperElements(nextElements, target.id, [
              "node-label",
              "connector-label",
            ])[0] ?? findBoundTextElement(elementsById, target);

          if (!helper) {
            throw new Error(
              `Shape ${operation.targetShapeRef} does not support text replacement`,
            );
          }

          const isBoundContainerText =
            helper.containerId === target.id ||
            Boolean(target.boundElements?.some((entry) => entry.id === helper.id));

          if (getHelperRole(helper) === "node-label" || isBoundContainerText) {
            const bounds = getShapeCenter(target).bounds;
            const next = updateTextElement({
              element: helper,
              text: operation.text,
            });
            const width = typeof next.width === "number" ? next.width : 140;
            const height = typeof next.height === "number" ? next.height : 32;
            next.x = bounds.x + (bounds.w - width) / 2;
            next.y = bounds.y + (bounds.h - height) / 2;
            replaceElement(elementsById, nextElements, next);
            changedShapeIds.add(next.id);
            break;
          }

          const next = updateTextElement({
            element: helper,
            text: operation.text,
          });
          replaceElement(elementsById, nextElements, next);
          changedShapeIds.add(next.id);
          break;
        }
        case "move": {
          const target = resolveShapeRef(elementsById, aliases, operation.targetShapeRef);
          const bounds = getShapeCenter(target).bounds;
          const dx = operation.x - bounds.x;
          const dy = operation.y - bounds.y;
          const ownedHelpers = collectRelatedElements({
            elements: nextElements,
            elementsById,
            owner: target,
          });
          const toMove = [target, ...ownedHelpers];

          for (const element of toMove) {
            const next = {
              ...element,
              x: element.x + dx,
              y: element.y + dy,
            };
            replaceElement(elementsById, nextElements, next);
            changedShapeIds.add(next.id);
          }
          break;
        }
        case "delete": {
          const target = resolveShapeRef(elementsById, aliases, operation.targetShapeRef);
          const ownedHelpers = collectRelatedElements({
            elements: nextElements,
            elementsById,
            owner: target,
          });
          [target, ...ownedHelpers].forEach((element) => {
            removeElement(elementsById, nextElements, element.id);
            changedShapeIds.delete(element.id);
          });
          break;
        }
      }
    } catch (error) {
      skippedOperations.push(
        createSkippedOperation({
          operation,
          operationIndex,
          reason:
            error instanceof Error ? error.message : "Unsupported canvas operation",
        }),
      );
    }
  }

  const finalAppliedOperationCount =
    plan.operations.length - skippedOperations.length;
  const summary =
    finalAppliedOperationCount > 0
      ? skippedOperations.length > 0
        ? `${plan.summary} Skipped ${skippedOperations.length} unsupported change${
            skippedOperations.length === 1 ? "" : "s"
          }.`
        : plan.summary
      : "No safe canvas changes could be applied.";
  const diagnostics: CanvasExecutionDiagnostics = {
    compiledOperations: buildCompiledOperationDebug(compiledPlan.operations),
    execution: {
      operationCount: plan.operations.length,
      appliedOperationCount: finalAppliedOperationCount,
      changedShapeCount: changedShapeIds.size,
    },
    plan,
    sceneSummary: compiledPlan.sceneSummary,
  };

  return {
    elements: nextElements,
    result: {
      changedShapeIds: Array.from(changedShapeIds),
      operationCount: plan.operations.length,
      appliedOperationCount: finalAppliedOperationCount,
      skippedOperations,
      summary,
      diagnostics,
    },
  };
};

export const buildExcalidrawElementsFromFixture = (fixture: CanvasFixture) => {
  const nextElements: ExcalidrawElementLike[] = [];

  fixture.shapes.forEach((shape) => {
    if (shape.type === "text") {
      nextElements.push(
        createTextElement({
          id: shape.id ?? createCanvasElementId("fixture-text"),
          text: shape.text,
          x: shape.x,
          y: shape.y,
          color: shape.color ?? "black",
        }),
      );
      return;
    }

    const geoId = shape.id ?? createCanvasElementId("fixture-geo");
    const geo = createGeoElement({
      id: geoId,
      shape: mapGeoShape(shape.shape),
      x: shape.x,
      y: shape.y,
      w: shape.w ?? DEFAULT_GEO_WIDTH,
      h: shape.h ?? DEFAULT_GEO_HEIGHT,
      color: shape.color ?? "blue",
      transparent: true,
      dash: "solid",
    });

    if (shape.textBinding === "bound") {
      const label = createBoundNodeLabel({
        ownerId: geoId,
        text: shape.text,
        x: shape.x,
        y: shape.y,
        w: shape.w ?? DEFAULT_GEO_WIDTH,
        h: shape.h ?? DEFAULT_GEO_HEIGHT,
      });
      geo.boundElements = [...(geo.boundElements ?? []), { id: label.id, type: "text" }];
      nextElements.push(geo, label);
      return;
    }

    nextElements.push(geo);
    nextElements.push(
      createNodeLabel({
        ownerId: geoId,
        text: shape.text,
        x: shape.x,
        y: shape.y,
        w: shape.w ?? DEFAULT_GEO_WIDTH,
        h: shape.h ?? DEFAULT_GEO_HEIGHT,
      }),
    );
  });

  return nextElements;
};

export const persistExcalidrawScene = ({
  persistenceKey,
  scene,
}: {
  persistenceKey: string;
  scene: ExcalidrawSceneState;
}) => {
  if (typeof window === "undefined") {
    return;
  }

  const payload: PersistedExcalidrawScene = {
    version: EXCALIDRAW_PERSISTENCE_VERSION,
    elements: scene.elements,
    appState: getPersistedAppState(scene.appState),
    files: scene.files,
  };

  window.localStorage.setItem(persistenceKey, JSON.stringify(payload));
};

export const readPersistedExcalidrawScene = (
  persistenceKey: string,
): PersistedExcalidrawScene | null => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(persistenceKey);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as PersistedExcalidrawScene;
    if (parsed.version !== EXCALIDRAW_PERSISTENCE_VERSION) {
      return null;
    }

    return {
      version: EXCALIDRAW_PERSISTENCE_VERSION,
      elements: Array.isArray(parsed.elements) ? parsed.elements : [],
      appState:
        parsed.appState && typeof parsed.appState === "object"
          ? parsed.appState
          : {},
      files:
        parsed.files && typeof parsed.files === "object"
          ? parsed.files
          : {},
    };
  } catch {
    return null;
  }
};

export const createExcalidrawCanvasAdapter = ({
  getApi,
  getScene,
  persistenceKey,
  setScene,
}: {
  getApi: () => CanvasExcalidrawApi | null;
  getScene: () => ExcalidrawSceneState;
  persistenceKey: string;
  setScene: (scene: ExcalidrawSceneState) => void;
}): CanvasAdapter => {
  const commitScene = (
    nextScene: ExcalidrawSceneState,
    captureUpdate: CaptureUpdateActionType,
  ) => {
    const api = getApi();
    if (!api) {
      throw new Error("Canvas is not available.");
    }

    setScene(nextScene);
    persistExcalidrawScene({
      persistenceKey,
      scene: nextScene,
    });
    api.updateScene({
      elements: nextScene.elements,
      appState: nextScene.appState,
      files: nextScene.files,
      captureUpdate,
    });
  };

  return {
    isReady: () => Boolean(getApi()),
    serializeScene: () => serializeExcalidrawScene(getScene().elements),
    captureImage: () => captureExcalidrawSceneImage(getScene()),
    applyPlan: async (plan) => {
      const scene = getScene();
      const next = applyCanvasPlanToExcalidrawScene({
        elements: scene.elements,
        plan,
      });
      commitScene(
        {
          ...scene,
          elements: next.elements,
        },
        CaptureUpdateAction.IMMEDIATELY,
      );
      return next.result;
    },
    clearScene: async () => {
      const scene = getScene();
      commitScene(
        {
          ...scene,
          elements: [],
          files: {},
        },
        CaptureUpdateAction.NEVER,
      );
    },
    seedFixture: async (fixture) => {
      const scene = getScene();
      const seededElements = buildExcalidrawElementsFromFixture(fixture);
      commitScene(
        {
          ...scene,
          elements:
            fixture.clearExisting === false
              ? [...scene.elements, ...seededElements]
              : seededElements,
          files: fixture.clearExisting === false ? scene.files : {},
        },
        CaptureUpdateAction.NEVER,
      );
    },
    loadPersistedScene: async () => {
      const persisted = readPersistedExcalidrawScene(persistenceKey);
      if (!persisted) {
        return;
      }

      commitScene(
        {
          ...getScene(),
          elements: persisted.elements,
          appState: {
            ...getScene().appState,
            ...persisted.appState,
          },
          files: persisted.files,
        },
        CaptureUpdateAction.NEVER,
      );
    },
    removePersistedScene: () => {
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(persistenceKey);
      }
    },
    refresh: () => {
      const api = getApi();
      if (!api) {
        return;
      }

      api.refresh?.();

      const visibleElements = getScene().elements.filter(
        (element) => !element.isDeleted,
      );
      if (visibleElements.length > 0) {
        api.scrollToContent?.(visibleElements as never, {
          animate: false,
          fitToViewport: false,
        });
      }
    },
  };
};

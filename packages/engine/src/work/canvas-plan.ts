import { z } from "zod";

export const CANVAS_COLOR_VALUES = [
  "black",
  "blue",
  "green",
  "grey",
  "light-blue",
  "light-green",
  "light-red",
  "light-violet",
  "orange",
  "red",
  "violet",
  "white",
  "yellow",
] as const;

export const CANVAS_NODE_SHAPE_VALUES = [
  "rectangle",
  "ellipse",
  "diamond",
] as const;

export const CANVAS_ANNOTATION_PLACEMENT_VALUES = [
  "above",
  "below",
  "left",
  "right",
  "center",
] as const;

export const CANVAS_EMPHASIS_STYLE_VALUES = [
  "circle",
  "highlight",
  "box",
] as const;

const canvasColorSchema = z.enum(CANVAS_COLOR_VALUES);
// The reused editor displays plain text, not TeX. Reject malformed model escapes
// before they become tabs or disappear inside an otherwise successful drawing.
const canvasTextSchema = z.string().min(1).refine(
  (text) => !/[\u0000-\u0009\u000b-\u001f\u007f]|\\[a-zA-Z]+/.test(text),
  "Use plain Unicode math (×, ÷, subscripts), not LaTeX or control characters. Newlines are allowed.",
);

const canvasBoundsSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().finite().nonnegative(),
  h: z.number().finite().nonnegative(),
});

const canvasNormalizedRegionSchema = z.object({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
  w: z.number().finite().positive().max(1),
  h: z.number().finite().positive().max(1),
});

const canvasSceneShapeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  text: z.string().nullable(),
  bounds: canvasBoundsSchema.nullable(),
  style: z
    .object({
      color: canvasColorSchema.nullable().optional(),
      dash: z.string().nullable().optional(),
      fill: z.string().nullable().optional(),
    })
    .optional(),
  isLocked: z.boolean(),
});

export const canvasSceneSchema = z.object({
  shapes: z.array(canvasSceneShapeSchema),
});

const annotateOperationSchema = z.object({
  type: z.literal("annotate"),
  targetShapeRef: z.string().min(1),
  text: canvasTextSchema,
  placement: z.enum(CANVAS_ANNOTATION_PLACEMENT_VALUES).default("below"),
  color: canvasColorSchema.optional(),
});

const emphasizeOperationSchema = z.object({
  type: z.literal("emphasize"),
  targetShapeRef: z.string().min(1),
  style: z.enum(CANVAS_EMPHASIS_STYLE_VALUES),
  color: canvasColorSchema.optional(),
  region: canvasNormalizedRegionSchema.optional(),
});

const connectOperationSchema = z.object({
  type: z.literal("connect"),
  fromShapeRef: z.string().min(1),
  toShapeRef: z.string().min(1),
  label: canvasTextSchema.optional(),
  color: canvasColorSchema.optional(),
});

const createNodeOperationSchema = z.object({
  type: z.literal("create_node"),
  tempId: z.string().min(1),
  text: canvasTextSchema,
  shape: z.enum(CANVAS_NODE_SHAPE_VALUES),
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().finite().positive().optional(),
  h: z.number().finite().positive().optional(),
  color: canvasColorSchema.optional(),
});

const replaceTextOperationSchema = z.object({
  type: z.literal("replace_text"),
  targetShapeRef: z.string().min(1),
  text: canvasTextSchema,
});

const moveOperationSchema = z.object({
  type: z.literal("move"),
  targetShapeRef: z.string().min(1),
  x: z.number().finite(),
  y: z.number().finite(),
});

const deleteOperationSchema = z.object({
  type: z.literal("delete"),
  targetShapeRef: z.string().min(1),
});

// Unboxed handwriting on Scholar's existing editable canvas.
const writeOperationSchema = z.object({
  type: z.literal("write"), tempId: z.string().min(1), text: canvasTextSchema,
  x: z.number().finite(), y: z.number().finite(), color: canvasColorSchema.optional(),
  fontSize: z.number().min(16).max(40).optional(),
});

export const canvasOperationSchema = z.discriminatedUnion("type", [
  annotateOperationSchema,
  emphasizeOperationSchema,
  connectOperationSchema,
  createNodeOperationSchema,
  replaceTextOperationSchema,
  moveOperationSchema,
  deleteOperationSchema,
  writeOperationSchema,
]);

export const canvasPlanSchema = z.object({
  summary: z.string().min(1),
  operations: z.array(canvasOperationSchema),
});

export type CanvasNodeShape = (typeof CANVAS_NODE_SHAPE_VALUES)[number];
export type CanvasColor = z.infer<typeof canvasColorSchema>;
export type CanvasScene = z.infer<typeof canvasSceneSchema>;
export type CanvasOperation = z.infer<typeof canvasOperationSchema>;
export type CanvasPlan = z.infer<typeof canvasPlanSchema>;

const toNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const normalizeCanvasPlan = (value: unknown): CanvasPlan => {
  const candidate =
    value && typeof value === "object"
      ? (value as { operations?: unknown; summary?: unknown })
      : {};

  const operations = Array.isArray(candidate.operations)
    ? candidate.operations.flatMap((operation) => {
        const parsed = canvasOperationSchema.safeParse(operation);
        return parsed.success ? [parsed.data] : [];
      })
    : [];

  return canvasPlanSchema.parse({
    summary:
      toNonEmptyString(candidate.summary) ??
      (operations.length > 0
        ? "Applied canvas updates."
        : "No safe canvas edits were planned."),
    operations,
  });
};

export const CANVAS_PLAN_RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    operations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: [
              "annotate",
              "emphasize",
              "connect",
              "create_node",
              "replace_text",
              "move",
              "delete",
              "write",
            ],
          },
          targetShapeRef: { type: "string" },
          text: { type: "string" },
          placement: {
            type: "string",
            enum: [...CANVAS_ANNOTATION_PLACEMENT_VALUES],
          },
          color: {
            type: "string",
            enum: [...CANVAS_COLOR_VALUES],
          },
          style: {
            type: "string",
            enum: [...CANVAS_EMPHASIS_STYLE_VALUES],
          },
          region: {
            type: "object",
            properties: {
              x: { type: "number" },
              y: { type: "number" },
              w: { type: "number" },
              h: { type: "number" },
            },
            required: ["x", "y", "w", "h"],
            additionalProperties: false,
          },
          fromShapeRef: { type: "string" },
          toShapeRef: { type: "string" },
          label: { type: "string" },
          tempId: { type: "string" },
          shape: {
            type: "string",
            enum: [...CANVAS_NODE_SHAPE_VALUES],
          },
          x: { type: "number" },
          y: { type: "number" },
          w: { type: "number" },
          h: { type: "number" },
          fontSize: { type: "number" },
        },
        required: ["type"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "operations"],
  additionalProperties: false,
} as const;

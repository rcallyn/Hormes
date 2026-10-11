# Hormes workspace

The local web surface embedded in the native notch panel. It has no API key,
network client, or web server in production. A typed WebKit bridge sends work
commands to the existing daemon. The engine owns durable state and tool policy.

## Build

From the repository root:

```sh
pnpm install
pnpm --filter @hormes/workspace typecheck
pnpm --filter @hormes/workspace build
pnpm build:mac
```

The last command packages `build/workspace` inside the signed app. Engine TypeScript
still runs directly through tsx. No engine compilation step was added.

## Reuse and dependencies

`src/scholar/excalidraw-canvas-adapter.ts`, `canvas-adapter.ts`, the execution
interfaces, and `packages/engine/src/work/canvas-plan.ts` were adapted from the
user's local `Taz33m/scholar` frontend. The native host component adapts Scholar's
`canvas-excalidraw.tsx`; it replaces browser-local persistence and library controls
with acknowledged saves to Hormes. The supplied Scholar checkout contains no
separate license file; this is an adaptation for the user's existing project.

Excalidraw 0.18 supplies selection, freehand drawing, text, shapes, arrows, undo,
zoom, and editable scene data. React and ReactDOM are required by that component.
Esbuild bundles the small host for offline WebKit use. These dependencies avoid
reimplementing a drawing editor. Excalidraw is MIT licensed; its license notice is
included with the bundled distribution. No tldraw, Next.js, Gemini, Supabase, or
Scholar backend was added.

The build redirects Excalidraw's font fallback to the bundled assets. The page's
content security policy blocks network connections. Links open externally only
on an explicit user click. Images and external embeds are not part of this P0 UI.

## State contract

Board edits queue one save at a time using the last acknowledged revision. Closing,
switching, or quitting waits for that queue. A stale revision fails instead of
overwriting newer work. A successful plan application is separately acknowledged;
a queued model plan is not itself evidence that anything appeared on the board.

The only browser-local state is transient editor state. SQLite is authoritative.
Explicit numeric answers from settled native microphone transcripts are checked by
the engine, with original words and utterance provenance retained. Ambiguous speech
and freehand work remain ungraded. The model cannot submit invented student answers.

Learning uses bundled Virgil handwriting, loaded before element measurement, with
progressive editable lines and freehand student pen strokes. The default surface has
only the board and icon controls. Problem-only plans do not count as hints. Actual
teaching does, and subsequent tutor updates preserve student pan and zoom.

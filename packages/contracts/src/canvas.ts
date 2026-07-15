import { Schema } from "effect";

import { NonNegativeInt, ThreadId, TrimmedNonEmptyString } from "./baseSchemas";

export const CanvasScene = Schema.Struct({
  type: Schema.optional(Schema.Literal("excalidraw")),
  version: Schema.optional(Schema.Number),
  source: Schema.optional(Schema.String),
  elements: Schema.Array(Schema.Record(Schema.String, Schema.Json)),
  appState: Schema.Record(Schema.String, Schema.Json),
  files: Schema.optional(Schema.Record(Schema.String, Schema.Json)),
});
export type CanvasScene = typeof CanvasScene.Type;

export const CanvasDrawingRef = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  threadId: ThreadId,
});
export type CanvasDrawingRef = typeof CanvasDrawingRef.Type;

const CanvasDrawingTarget = Schema.Struct({ threadId: ThreadId });

export const CanvasDrawingCreateInput = CanvasDrawingTarget;
export type CanvasDrawingCreateInput = typeof CanvasDrawingCreateInput.Type;

export const CanvasDrawingReadInput = CanvasDrawingTarget;
export type CanvasDrawingReadInput = typeof CanvasDrawingReadInput.Type;

export const CanvasDrawingSaveInput = Schema.Struct({
  ...CanvasDrawingTarget.fields,
  scene: CanvasScene,
  expectedRevision: TrimmedNonEmptyString,
});
export type CanvasDrawingSaveInput = typeof CanvasDrawingSaveInput.Type;

export const CanvasDrawingDeleteInput = CanvasDrawingTarget;
export type CanvasDrawingDeleteInput = typeof CanvasDrawingDeleteInput.Type;

export const CanvasDrawingChangedEvent = Schema.Struct({
  threadId: ThreadId,
  revision: TrimmedNonEmptyString,
});
export type CanvasDrawingChangedEvent = typeof CanvasDrawingChangedEvent.Type;

export const CanvasAgentCamera = Schema.Struct({
  x: Schema.Finite,
  y: Schema.Finite,
  width: Schema.Finite.check(Schema.isGreaterThan(0)),
  height: Schema.Finite.check(Schema.isGreaterThan(0)),
  durationMs: Schema.optional(NonNegativeInt),
});
export type CanvasAgentCamera = typeof CanvasAgentCamera.Type;

export const CanvasAgentPreviewEvent = Schema.Struct({
  threadId: ThreadId,
  streamId: TrimmedNonEmptyString,
  sequence: NonNegativeInt,
  phase: Schema.Literals(["start", "partial", "complete", "cancelled"]),
  baseRevision: TrimmedNonEmptyString,
  operations: Schema.Array(Schema.Record(Schema.String, Schema.Json)),
  camera: Schema.optional(CanvasAgentCamera),
});
export type CanvasAgentPreviewEvent = typeof CanvasAgentPreviewEvent.Type;

export interface CanvasDrawingSnapshot {
  readonly relativePath: string;
  readonly scene: CanvasScene;
  readonly revision: string;
}

export interface CanvasDrawingDeleteResult {
  readonly deleted: boolean;
}

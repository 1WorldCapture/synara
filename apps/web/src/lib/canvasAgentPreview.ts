// FILE: canvasAgentPreview.ts
// Purpose: Keeps ephemeral Canvas preview ordering and camera motion deterministic.
// Layer: Canvas workspace logic

import type { CanvasAgentPreviewEvent } from "@synara/contracts";

export type CanvasPreviewCursor = Pick<CanvasAgentPreviewEvent, "streamId" | "sequence">;

export type CanvasPreviewEventDecision =
  | {
      readonly apply: true;
      readonly reason: "new-stream" | "ordered-event";
    }
  | {
      readonly apply: false;
      readonly reason:
        | "base-revision-mismatch"
        | "missing-stream-start"
        | "revision-unavailable"
        | "sequence-gap";
    };

export function canvasPreviewEventDecision(input: {
  readonly current: CanvasPreviewCursor | null;
  readonly event: CanvasPreviewCursor & { readonly baseRevision: string };
  readonly revision: string | null;
}): CanvasPreviewEventDecision {
  if (!input.revision) return { apply: false, reason: "revision-unavailable" };
  if (input.event.baseRevision !== input.revision) {
    return { apply: false, reason: "base-revision-mismatch" };
  }
  if (!input.current) {
    return input.event.sequence === 0
      ? { apply: true, reason: "new-stream" }
      : { apply: false, reason: "missing-stream-start" };
  }
  if (input.current.streamId !== input.event.streamId) {
    return input.event.sequence === 0
      ? { apply: true, reason: "new-stream" }
      : { apply: false, reason: "missing-stream-start" };
  }
  return input.event.sequence === input.current.sequence + 1
    ? { apply: true, reason: "ordered-event" }
    : { apply: false, reason: "sequence-gap" };
}

export function shouldApplyCanvasPreviewEvent(input: {
  readonly current: CanvasPreviewCursor | null;
  readonly event: CanvasPreviewCursor & { readonly baseRevision: string };
  readonly revision: string | null;
}): boolean {
  return canvasPreviewEventDecision(input).apply;
}

export interface CanvasCameraPosition {
  readonly scrollX: number;
  readonly scrollY: number;
  readonly zoom: number;
}

export function canvasCameraTarget(
  camera: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  viewport: { readonly width: number; readonly height: number },
): CanvasCameraPosition {
  const width = Math.max(1, camera.width);
  const height = Math.max(1, camera.height);
  const viewportWidth = Math.max(1, viewport.width);
  const viewportHeight = Math.max(1, viewport.height);
  const zoom = Math.min(4, Math.max(0.1, Math.min(viewportWidth / width, viewportHeight / height) * 0.9));
  const centerX = camera.x + width / 2;
  const centerY = camera.y + height / 2;
  return {
    zoom,
    scrollX: viewportWidth / (2 * zoom) - centerX,
    scrollY: viewportHeight / (2 * zoom) - centerY,
  };
}

export function canvasCameraAnimationStep(
  current: CanvasCameraPosition,
  target: CanvasCameraPosition,
  deltaMs: number,
): CanvasCameraPosition {
  const alpha = 1 - Math.exp((-8 * Math.max(0, deltaMs)) / 1_000);
  return {
    scrollX: current.scrollX + (target.scrollX - current.scrollX) * alpha,
    scrollY: current.scrollY + (target.scrollY - current.scrollY) * alpha,
    zoom: current.zoom + (target.zoom - current.zoom) * alpha,
  };
}

export function isCanvasCameraSettled(
  current: CanvasCameraPosition,
  target: CanvasCameraPosition,
): boolean {
  return (
    Math.abs(current.scrollX - target.scrollX) < 0.25 &&
    Math.abs(current.scrollY - target.scrollY) < 0.25 &&
    Math.abs(current.zoom - target.zoom) < 0.001
  );
}

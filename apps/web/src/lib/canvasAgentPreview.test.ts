import { describe, expect, it } from "vitest";

import {
  canvasCameraAnimationStep,
  canvasCameraTarget,
  canvasPreviewEventDecision,
  shouldApplyCanvasPreviewEvent,
} from "./canvasAgentPreview";

describe("canvas agent preview", () => {
  it("requires an ordered stream starting at sequence zero", () => {
    expect(
      shouldApplyCanvasPreviewEvent({
        current: null,
        event: { streamId: "stream-1", sequence: 0, baseRevision: "revision-1" },
        revision: "revision-1",
      }),
    ).toBe(true);
    expect(
      shouldApplyCanvasPreviewEvent({
        current: null,
        event: { streamId: "stream-1", sequence: 4, baseRevision: "revision-1" },
        revision: "revision-1",
      }),
    ).toBe(false);
    expect(
      shouldApplyCanvasPreviewEvent({
        current: { streamId: "stream-1", sequence: 0 },
        event: { streamId: "stream-1", sequence: 2, baseRevision: "revision-1" },
        revision: "revision-1",
      }),
    ).toBe(false);
    expect(
      shouldApplyCanvasPreviewEvent({
        current: null,
        event: { streamId: "stream-2", sequence: 0, baseRevision: "revision-old" },
        revision: "revision-1",
      }),
    ).toBe(false);
  });

  it("reports why a preview event cannot be applied", () => {
    expect(
      canvasPreviewEventDecision({
        current: null,
        event: { streamId: "stream-1", sequence: 0, baseRevision: "revision-1" },
        revision: null,
      }),
    ).toEqual({ apply: false, reason: "revision-unavailable" });
    expect(
      canvasPreviewEventDecision({
        current: null,
        event: { streamId: "stream-1", sequence: 0, baseRevision: "revision-old" },
        revision: "revision-1",
      }),
    ).toEqual({ apply: false, reason: "base-revision-mismatch" });
    expect(
      canvasPreviewEventDecision({
        current: null,
        event: { streamId: "stream-1", sequence: 2, baseRevision: "revision-1" },
        revision: "revision-1",
      }),
    ).toEqual({ apply: false, reason: "missing-stream-start" });
    expect(
      canvasPreviewEventDecision({
        current: { streamId: "stream-1", sequence: 0 },
        event: { streamId: "stream-1", sequence: 2, baseRevision: "revision-1" },
        revision: "revision-1",
      }),
    ).toEqual({ apply: false, reason: "sequence-gap" });
    expect(
      canvasPreviewEventDecision({
        current: { streamId: "stream-1", sequence: 3 },
        event: { streamId: "stream-2", sequence: 0, baseRevision: "revision-1" },
        revision: "revision-1",
      }),
    ).toEqual({ apply: true, reason: "new-stream" });
  });

  it("fits camera bounds to the real viewport and eases independently of frame rate", () => {
    const target = canvasCameraTarget(
      { x: 100, y: 200, width: 800, height: 400 },
      { width: 1200, height: 800 },
    );
    expect(target.zoom).toBeCloseTo(1.35);
    expect(target.scrollX).toBeCloseTo(-55.56, 1);
    expect(target.scrollY).toBeCloseTo(-103.7, 1);

    const oneFrame = canvasCameraAnimationStep(
      { scrollX: 0, scrollY: 0, zoom: 1 },
      target,
      16,
    );
    const twoHalfFrames = canvasCameraAnimationStep(
      canvasCameraAnimationStep({ scrollX: 0, scrollY: 0, zoom: 1 }, target, 8),
      target,
      8,
    );
    expect(twoHalfFrames.zoom).toBeCloseTo(oneFrame.zoom, 8);
    expect(twoHalfFrames.scrollX).toBeCloseTo(oneFrame.scrollX, 8);
  });
});

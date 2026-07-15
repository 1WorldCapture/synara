import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { EMPTY_CANVAS_SCENE } from "@synara/shared/excalidrawScene";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  authorizeCanvasBridgeCapability,
  issueCanvasBridgeCapability,
  resetCanvasBridgeCapabilitiesForTest,
  revokeCanvasBridgeCapability,
  startCanvasBridgeServer,
  subscribeCanvasAgentPreviews,
  subscribeCanvasDrawingChanges,
} from "./canvasBridge";
import { createCanvasDrawing } from "./canvasDrawingFiles";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

beforeEach(resetCanvasBridgeCapabilitiesForTest);

describe("canvas bridge capabilities", () => {
  it("binds a high-entropy token to one drawing", () => {
    const grant = issueCanvasBridgeCapability({
      cwd: "/state",
      directorySegments: ["drawings", "project-1"],
      legacyCwd: "/project",
      threadId: "drawing-1",
    });
    expect(grant.token.length).toBeGreaterThan(32);
    expect(authorizeCanvasBridgeCapability(grant.token, "drawing-1")).toEqual({
      cwd: "/state",
      directorySegments: ["drawings", "project-1"],
      legacyCwd: "/project",
      threadId: "drawing-1",
    });
    expect(authorizeCanvasBridgeCapability(grant.token, "drawing-2")).toBeNull();
  });

  it("rejects a revoked capability", () => {
    const grant = issueCanvasBridgeCapability({ cwd: "/project", threadId: "drawing-1" });
    revokeCanvasBridgeCapability(grant.token);
    expect(authorizeCanvasBridgeCapability(grant.token, "drawing-1")).toBeNull();
  });

  it("serves capability-scoped drawings on an independent loopback listener", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "synara-canvas-bridge-"));
    roots.push(cwd);
    const snapshot = await createCanvasDrawing({ cwd, threadId: "drawing-loopback" });
    const grant = issueCanvasBridgeCapability({ cwd, threadId: "drawing-loopback" });
    const diagnostics: Array<{ stage: string; reason?: string; sequence?: number }> = [];
    const server = await startCanvasBridgeServer({
      onDiagnostic: (event) => diagnostics.push(event),
    });
    const drawingChanges: Array<{ threadId: string; revision: string }> = [];
    const previews: Array<{ streamId: string; sequence: number; phase: string }> = [];
    const unsubscribe = subscribeCanvasDrawingChanges((event) => drawingChanges.push(event));
    const unsubscribePreviews = subscribeCanvasAgentPreviews((event) => previews.push(event));
    try {
      const response = await fetch(`${server.baseUrl}/internal/canvas/read`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${grant.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ threadId: "drawing-loopback" }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        revision: snapshot.revision,
        scene: EMPTY_CANVAS_SCENE,
      });

      const saveResponse = await fetch(`${server.baseUrl}/internal/canvas/save`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${grant.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          threadId: "drawing-loopback",
          expectedRevision: snapshot.revision,
          scene: {
            ...EMPTY_CANVAS_SCENE,
            elements: [{ id: "agent-element", type: "rectangle" }],
          },
        }),
      });
      expect(saveResponse.status).toBe(200);
      const saved = (await saveResponse.json()) as { revision: string };
      expect(drawingChanges).toEqual([
        { threadId: "drawing-loopback", revision: saved.revision },
      ]);

      const previewBody = {
        threadId: "drawing-loopback",
        streamId: "stream-1",
        sequence: 1,
        phase: "partial",
        baseRevision: saved.revision,
        operations: [{ id: "preview-element", type: "ellipse" }],
        camera: { x: 0, y: 0, width: 640, height: 480, durationMs: 400 },
      };
      const postPreview = (body: Record<string, unknown>) =>
        fetch(`${server.baseUrl}/internal/canvas/preview`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${grant.token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        });
      expect(
        (
          await postPreview({
            ...previewBody,
            sequence: 0,
            phase: "start",
            operations: [],
            camera: undefined,
          })
        ).status,
      ).toBe(202);
      const previewResponse = await postPreview(previewBody);
      expect(previewResponse.status).toBe(202);
      expect(previews).toEqual([
        expect.objectContaining({ streamId: "stream-1", sequence: 0, phase: "start" }),
        expect.objectContaining({ streamId: "stream-1", sequence: 1, phase: "partial" }),
      ]);

      const replayed: typeof previews = [];
      const unsubscribeReplay = subscribeCanvasAgentPreviews(
        (event) => replayed.push(event),
        (event) => diagnostics.push(event),
      );
      expect(replayed).toHaveLength(2);
      expect((await postPreview(previewBody)).status).toBe(202);
      expect(previews).toHaveLength(2);

      expect(
        (
          await postPreview({
            ...previewBody,
            sequence: 2,
            phase: "complete",
          })
        ).status,
      ).toBe(202);
      expect(previews.at(-1)).toMatchObject({ sequence: 2, phase: "complete" });
      const afterCompletion: typeof previews = [];
      const unsubscribeAfterCompletion = subscribeCanvasAgentPreviews((event) =>
        afterCompletion.push(event),
      );
      expect(afterCompletion).toEqual([]);
      unsubscribeAfterCompletion();
      unsubscribeReplay();
      expect(diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ stage: "bridge.accepted", sequence: 0 }),
          expect.objectContaining({ stage: "bridge.accepted", sequence: 1 }),
          expect.objectContaining({ stage: "bridge.rejected", reason: "sequence-gap" }),
          expect.objectContaining({ stage: "rpc.subscriber-attached" }),
          expect.objectContaining({ stage: "rpc.replayed", sequence: 0 }),
          expect.objectContaining({ stage: "rpc.replayed", sequence: 1 }),
        ]),
      );
    } finally {
      unsubscribe();
      unsubscribePreviews();
      await server.close();
    }
  });
});

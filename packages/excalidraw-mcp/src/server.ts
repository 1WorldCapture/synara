import { randomUUID } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  CANVAS_MCP_DISPLAY_NAME,
  CANVAS_TOOL_NAMES,
} from "@synara/shared/canvasAgentContract";
import { z } from "zod";

import {
  publishPreview,
  readBridgeConfig,
  readScene,
  saveScene,
  type BridgeAgentPreview,
  type BridgeSceneSnapshot,
  type CanvasBridgeConfig,
} from "./bridge";
import { applyElementOperations } from "./scene";

const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const MCP_VERSION = "0.4.0-synara.1";
const [READ_TOOL_NAME, BEGIN_TOOL_NAME, APPEND_TOOL_NAME, COMMIT_TOOL_NAME, CANCEL_TOOL_NAME] =
  CANVAS_TOOL_NAMES;

const CANVAS_MCP_INSTRUCTIONS =
  "When using Synara Canvas, follow read → begin → append (one or more small semantic batches) " +
  "→ commit, or cancel to discard the preview. Begin and append never save; commit performs one " +
  "revision-checked atomic save. Preserve elements the user did not ask to change.";

interface ActivePreview {
  readonly streamId: string;
  readonly base: BridgeSceneSnapshot;
  scene: BridgeSceneSnapshot["scene"];
  sequence: number;
  previewDelivered: boolean;
}

function parseOperations(elements: string): Array<Record<string, unknown>> {
  const operations = JSON.parse(elements) as unknown;
  if (
    !Array.isArray(operations) ||
    !operations.every((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
  ) {
    throw new Error("elements must be a JSON array of Excalidraw element objects.");
  }
  return operations as Array<Record<string, unknown>>;
}

function cameraFromOperations(
  operations: ReadonlyArray<Record<string, unknown>>,
): BridgeAgentPreview["camera"] | undefined {
  const operation = operations.findLast((entry) => entry.type === "cameraUpdate");
  if (!operation) return undefined;
  const values = [operation.x, operation.y, operation.width, operation.height];
  if (!values.every((value) => typeof value === "number" && Number.isFinite(value))) {
    throw new Error("cameraUpdate requires finite x, y, width, and height values.");
  }
  if (Number(operation.width) <= 0 || Number(operation.height) <= 0) {
    throw new Error("cameraUpdate width and height must be positive.");
  }
  return {
    x: Number(operation.x),
    y: Number(operation.y),
    width: Number(operation.width),
    height: Number(operation.height),
    ...(typeof operation.durationMs === "number" && operation.durationMs >= 0
      ? { durationMs: Math.round(operation.durationMs) }
      : {}),
  };
}

function toolError(error: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
    isError: true,
  };
}

export function createServer(config: CanvasBridgeConfig = readBridgeConfig()): McpServer {
  const server = new McpServer(
    { name: CANVAS_MCP_DISPLAY_NAME, version: MCP_VERSION },
    { instructions: CANVAS_MCP_INSTRUCTIONS },
  );
  const checkpoints = new Map<string, ReadonlyArray<Record<string, unknown>>>();
  const failedPreviewStreams = new Set<string>();
  let activePreview: ActivePreview | null = null;
  let previewMutationChain = Promise.resolve();

  const serializePreviewMutation = <Result>(task: () => Promise<Result>): Promise<Result> => {
    const result = previewMutationChain.then(task, task);
    previewMutationChain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const applyOperations = (
    scene: BridgeSceneSnapshot["scene"],
    operations: ReadonlyArray<Record<string, unknown>>,
  ) => {
    const restoreOperation = operations.find((entry) => entry.type === "restoreCheckpoint");
    const restoreCheckpointId = restoreOperation?.id;
    const restoredElements =
      typeof restoreCheckpointId === "string" ? checkpoints.get(restoreCheckpointId) : undefined;
    if (typeof restoreCheckpointId === "string" && !restoredElements) {
      throw new Error(`Checkpoint '${restoreCheckpointId}' is unavailable.`);
    }
    return applyElementOperations(
      restoredElements ? { ...scene, elements: restoredElements } : scene,
      operations,
    );
  };

  const rememberCheckpoint = (scene: BridgeSceneSnapshot["scene"]) => {
    const checkpointId = randomUUID().replaceAll("-", "").slice(0, 18);
    checkpoints.set(checkpointId, scene.elements);
    if (checkpoints.size > 100) checkpoints.delete(checkpoints.keys().next().value!);
    return checkpointId;
  };

  const emitPreview = async (
    preview: ActivePreview,
    phase: BridgeAgentPreview["phase"],
    operations: ReadonlyArray<Record<string, unknown>> = [],
    camera?: BridgeAgentPreview["camera"],
  ) => {
    if (failedPreviewStreams.has(preview.streamId)) {
      preview.previewDelivered = false;
      return false;
    }
    const event: BridgeAgentPreview = {
      streamId: preview.streamId,
      sequence: preview.sequence,
      phase,
      baseRevision: preview.base.revision,
      operations,
      ...(camera ? { camera } : {}),
    };
    try {
      await publishPreview(config, event);
      return true;
    } catch {
      // Preview transport is best-effort; it must never prevent the atomic save.
      failedPreviewStreams.add(preview.streamId);
      if (failedPreviewStreams.size > 100) {
        failedPreviewStreams.delete(failedPreviewStreams.values().next().value!);
      }
      preview.previewDelivered = false;
      return false;
    }
  };

  const streamedOperations = (
    preview: ActivePreview,
    operations: ReadonlyArray<Record<string, unknown>>,
  ): ReadonlyArray<Record<string, unknown>> =>
    operations.some((operation) => operation.type === "restoreCheckpoint")
      ? [{ type: "replaceScene", elements: preview.scene.elements }]
      : operations;

  const cancelPreview = async (preview: ActivePreview) => {
    preview.scene = preview.base.scene;
    preview.sequence += 1;
    await emitPreview(preview, "cancelled");
  };

  const commitPreview = async (preview: ActivePreview): Promise<CallToolResult> => {
    const saved = await saveScene(config, {
      scene: preview.scene,
      expectedRevision: preview.base.revision,
    });
    preview.scene = saved.scene;
    preview.sequence += 1;
    await emitPreview(preview, "complete");
    const checkpointId = rememberCheckpoint(saved.scene);
    return {
      content: [
        {
          type: "text",
          text: `Drawing saved with ${saved.scene.elements.length} editable elements. Checkpoint: ${checkpointId}`,
        },
      ],
      structuredContent: {
        checkpointId,
        revision: saved.revision,
        elementCount: saved.scene.elements.length,
        previewDelivered: preview.previewDelivered,
      },
    };
  };

  server.registerTool(
    READ_TOOL_NAME,
    {
      description:
        "Read-only. Read the current editable scene and revision metadata; call begin before changing it.",
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const snapshot = await readScene(config);
        return {
          content: [{ type: "text", text: JSON.stringify(snapshot.scene) }],
          structuredContent: {
            revision: snapshot.revision,
            elementCount: snapshot.scene.elements.length,
          },
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    BEGIN_TOOL_NAME,
    {
      description:
        "Start an ephemeral preview from the latest scene without saving. It cancels an abandoned preview; call append next.",
    },
    async () => serializePreviewMutation(async () => {
      try {
        const abandonedPreview = activePreview;
        activePreview = null;
        if (abandonedPreview) {
          await cancelPreview(abandonedPreview);
        }
        const base = await readScene(config);
        activePreview = {
          streamId: randomUUID(),
          base,
          scene: base.scene,
          sequence: 0,
          previewDelivered: true,
        };
        await emitPreview(activePreview, "start");
        return {
          content: [{ type: "text", text: "Drawing preview started." }],
          structuredContent: {
            streamId: activePreview.streamId,
            baseRevision: base.revision,
            elementCount: base.scene.elements.length,
            previewDelivered: activePreview.previewDelivered,
          },
        };
      } catch (error) {
        return toolError(error);
      }
    }),
  );

  server.registerTool(
    APPEND_TOOL_NAME,
    {
      description:
        "Requires an active preview. Apply and immediately preview one small semantic batch without saving; append again or commit.",
      inputSchema: { elements: z.string().max(MAX_INPUT_BYTES) },
    },
    async ({ elements }) => serializePreviewMutation(async () => {
      try {
        if (!activePreview) throw new Error("Call begin before append.");
        const operations = parseOperations(elements);
        const camera = cameraFromOperations(operations);
        activePreview.scene = applyOperations(activePreview.scene, operations);
        activePreview.sequence += 1;
        await emitPreview(
          activePreview,
          "partial",
          streamedOperations(activePreview, operations),
          camera,
        );
        return {
          content: [
            {
              type: "text",
              text: `Preview updated with ${activePreview.scene.elements.length} editable elements.`,
            },
          ],
          structuredContent: {
            sequence: activePreview.sequence,
            elementCount: activePreview.scene.elements.length,
            previewDelivered: activePreview.previewDelivered,
          },
        };
      } catch (error) {
        return toolError(error);
      }
    }),
  );

  server.registerTool(
    COMMIT_TOOL_NAME,
    {
      description:
        "Requires an active preview. Revision-check and atomically save it exactly once, then complete the preview.",
    },
    async () => serializePreviewMutation(async () => {
      const preview = activePreview;
      if (!preview) return toolError(new Error("Call begin before commit."));
      activePreview = null;
      try {
        return await commitPreview(preview);
      } catch (error) {
        await cancelPreview(preview);
        return toolError(error);
      }
    }),
  );

  server.registerTool(
    CANCEL_TOOL_NAME,
    {
      description:
        "Requires an active preview. Discard it and restore the last saved scene without saving.",
    },
    async () => serializePreviewMutation(async () => {
      const preview = activePreview;
      if (!preview) return toolError(new Error("There is no active drawing preview."));
      activePreview = null;
      await cancelPreview(preview);
      return { content: [{ type: "text", text: "Drawing preview cancelled." }] };
    }),
  );

  return server;
}

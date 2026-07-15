import { randomUUID } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
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

export const CANVAS_AGENT_GUIDE = `# Synara Excalidraw tools

Always call read_scene before changing an existing drawing. Ask exactly one focused
clarifying question when a choice changes factual structure (for example TCP/IP
four-layer versus five-layer); choose sensible defaults for purely visual choices.
Use stable unique ids and preserve elements the user did not ask to change.

For non-trivial drawings, call begin_view once, then append_view repeatedly with
small semantic batches (usually 3-8 elements), then commit_view once. Put a
cameraUpdate before each semantic batch so the user can follow the work. Use
create_view only for small one-shot edits; Synara replays those edits as a visual
fallback before the atomic save.

Each elements argument is a JSON array string. Common elements use type, id, x, y,
width, height; rectangles may include label: {text, fontSize}; arrows use points
and endArrowhead. A camera pseudo-element uses
{"type":"cameraUpdate","x":0,"y":0,"width":800,"height":600}. Use readable
fonts (16+ body, 20+ headings), consistent directions, pastel fills, and clear
hierarchy. A delete pseudo-element uses {"type":"delete","ids":"id1,id2"}.
Preview batches never write the drawing; commit_view performs one revision-checked
atomic save. Call cancel_view if the drawing cannot be completed.`;

const REPLAY_BATCH_SIZE = 4;
const REPLAY_DELAY_MS = 120;
const REPLAY_MAX_TOTAL_DELAY_MS = 5_000;

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

function replayBatches(
  operations: ReadonlyArray<Record<string, unknown>>,
): Array<Array<Record<string, unknown>>> {
  const batches: Array<Array<Record<string, unknown>>> = [];
  let batch: Array<Record<string, unknown>> = [];
  let renderOperations = 0;
  const flush = () => {
    if (batch.length === 0) return;
    batches.push(batch);
    batch = [];
    renderOperations = 0;
  };
  for (const operation of operations) {
    if (operation.type === "cameraUpdate" && batch.length > 0) flush();
    batch.push(operation);
    if (operation.type !== "cameraUpdate") renderOperations += 1;
    if (renderOperations >= REPLAY_BATCH_SIZE) flush();
  }
  flush();
  return batches;
}

const wait = (delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs));

function toolError(error: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
    isError: true,
  };
}

export function createServer(config: CanvasBridgeConfig = readBridgeConfig()): McpServer {
  const server = new McpServer({ name: "Synara Excalidraw", version: "0.3.2-synara.1" });
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
    "read_me",
    {
      description: "Read the Synara Excalidraw scene and collaboration contract.",
      annotations: { readOnlyHint: true },
    },
    async () => ({ content: [{ type: "text", text: CANVAS_AGENT_GUIDE }] }),
  );

  server.registerTool(
    "read_scene",
    {
      description: "Read the current editable Excalidraw scene before modifying it.",
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
    "begin_view",
    {
      description:
        "Begin an ephemeral drawing preview. Call once before append_view batches; it does not save.",
    },
    async () => serializePreviewMutation(async () => {
      try {
        if (activePreview) {
          await cancelPreview(activePreview);
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
    "append_view",
    {
      description:
        "Append a small semantic batch to the active preview. Include cameraUpdate before new content.",
      inputSchema: { elements: z.string().max(MAX_INPUT_BYTES) },
    },
    async ({ elements }) => serializePreviewMutation(async () => {
      try {
        if (!activePreview) throw new Error("Call begin_view before append_view.");
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
    "commit_view",
    {
      description: "Atomically save the active drawing preview after all append_view batches.",
    },
    async () => serializePreviewMutation(async () => {
      const preview = activePreview;
      if (!preview) return toolError(new Error("Call begin_view before commit_view."));
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
    "cancel_view",
    {
      description: "Discard the active preview without changing the saved drawing.",
    },
    async () => serializePreviewMutation(async () => {
      const preview = activePreview;
      if (!preview) return toolError(new Error("There is no active drawing preview."));
      activePreview = null;
      await cancelPreview(preview);
      return { content: [{ type: "text", text: "Drawing preview cancelled." }] };
    }),
  );

  server.registerTool(
    "create_view",
    {
      description: "Atomically apply editable Excalidraw element operations to the current drawing.",
      inputSchema: { elements: z.string().max(MAX_INPUT_BYTES) },
    },
    async ({ elements }) => serializePreviewMutation(async () => {
      let preview: ActivePreview | null = null;
      try {
        if (activePreview) {
          await cancelPreview(activePreview);
          activePreview = null;
        }
        const operations = parseOperations(elements);
        const current = await readScene(config);
        preview = {
          streamId: randomUUID(),
          base: current,
          scene: current.scene,
          sequence: 0,
          previewDelivered: true,
        };
        await emitPreview(preview, "start");
        const batches = replayBatches(operations);
        const replayDelayMs = Math.min(
          REPLAY_DELAY_MS,
          REPLAY_MAX_TOTAL_DELAY_MS / Math.max(1, batches.length - 1),
        );
        for (let index = 0; index < batches.length; index += 1) {
          const batch = batches[index]!;
          preview.scene = applyOperations(preview.scene, batch);
          preview.sequence += 1;
          await emitPreview(
            preview,
            "partial",
            streamedOperations(preview, batch),
            cameraFromOperations(batch),
          );
          if (index < batches.length - 1) await wait(replayDelayMs);
        }
        return await commitPreview(preview);
      } catch (error) {
        if (preview) await cancelPreview(preview);
        return toolError(error);
      }
    }),
  );

  return server;
}

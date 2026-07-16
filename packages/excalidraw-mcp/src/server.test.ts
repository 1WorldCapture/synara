import { createServer as createHttpServer, type Server } from "node:http";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  CANVAS_MCP_DISPLAY_NAME,
  CANVAS_MCP_NAMESPACE,
  CANVAS_SKILL_NAME,
  CANVAS_TOOL_NAMES,
} from "@synara/shared/canvasAgentContract";
import { afterEach, describe, expect, it } from "vitest";

import type { BridgeSceneSnapshot, CanvasBridgeConfig } from "./bridge";
import { createServer } from "./server";

const servers: Server[] = [];
const MCP_VERSION = "0.4.0-synara.1";
const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const LEGACY_TOOL_NAMES = [
  "read_me",
  "read_scene",
  "begin_view",
  "append_view",
  "commit_view",
  "cancel_view",
  "create_view",
] as const;

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
});

async function startBridge(
  options: {
    readonly previewStatus?: number;
    readonly conflictOnSave?: boolean;
    readonly initialElements?: ReadonlyArray<Record<string, unknown>>;
  } = {},
) {
  let revision = "revision-1";
  let scene: BridgeSceneSnapshot["scene"] = {
    elements: options.initialElements ?? [],
    appState: {},
    files: {},
  };
  const previews: Array<Record<string, unknown>> = [];
  let saveCount = 0;
  let saveAttemptCount = 0;
  const server = createHttpServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
    expect(request.headers.authorization).toBe("Bearer bridge-secret");
    expect(body.threadId).toBe("drawing-1");

    if (request.url?.endsWith("/preview")) {
      previews.push(body);
      response.writeHead(options.previewStatus ?? 202).end();
      return;
    }

    if (request.url?.endsWith("/save")) {
      saveAttemptCount += 1;
      expect(body.expectedRevision).toBe(revision);
      if (options.conflictOnSave) {
        response.writeHead(409).end();
        return;
      }
      scene = body.scene as BridgeSceneSnapshot["scene"];
      revision = `revision-${Number(revision.split("-")[1]) + 1}`;
      saveCount += 1;
    }

    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({ relativePath: "drawings/drawing-1.excalidraw", scene, revision }),
    );
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Bridge did not bind a port.");
  return {
    config: {
      baseUrl: `http://127.0.0.1:${address.port}`,
      token: "bridge-secret",
      threadId: "drawing-1",
    },
    readScene: () => scene,
    readPreviews: () => previews,
    readSaveCount: () => saveCount,
    readSaveAttemptCount: () => saveAttemptCount,
  };
}

async function connectClient(config: CanvasBridgeConfig) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpServer = createServer(config);
  const client = new Client({ name: "synara-mcp-test", version: "1.0.0" });
  await Promise.all([mcpServer.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: async () => {
      await client.close();
      await mcpServer.close();
    },
  };
}

describe("Synara Canvas MCP server", () => {
  it("initializes with conditional guidance and lists exactly the shared five-tool contract", async () => {
    const bridge = await startBridge();
    const connection = await connectClient(bridge.config);

    expect(connection.client.getServerVersion()).toEqual({
      name: CANVAS_MCP_DISPLAY_NAME,
      version: MCP_VERSION,
    });
    const instructions = connection.client.getInstructions();
    expect(instructions).toContain("When using Synara Canvas");
    expect(instructions).toContain("read → begin → append");

    const tools = (await connection.client.listTools()).tools;
    expect(tools.map((tool) => tool.name)).toEqual(CANVAS_TOOL_NAMES);
    expect(
      tools.every(
        (tool) => typeof tool.description === "string" && tool.description.trim().length > 0,
      ),
    ).toBe(true);

    const read = await connection.client.callTool({ name: "read", arguments: {} });
    expect(read.isError).not.toBe(true);
    expect(read).toMatchObject({
      structuredContent: { revision: "revision-1", elementCount: 0 },
    });
    expect(bridge.readSaveAttemptCount()).toBe(0);

    const canonicalSkill = await readFile(
      path.resolve(import.meta.dirname, "../skills/canvas/SKILL.md"),
      "utf8",
    );
    expect(canonicalSkill).toMatch(
      new RegExp(`^---\\s*\\nname:\\s*${CANVAS_SKILL_NAME}\\s*$`, "m"),
    );
    const workflowOffsets = CANVAS_TOOL_NAMES.map((name) => canonicalSkill.indexOf(`\`${name}\``));
    expect(workflowOffsets.every((offset) => offset >= 0)).toBe(true);
    expect(workflowOffsets).toEqual([...workflowOffsets].sort((left, right) => left - right));

    const advertisedText = [
      CANVAS_MCP_NAMESPACE,
      CANVAS_MCP_DISPLAY_NAME,
      instructions,
      ...tools.flatMap((tool) => [tool.name, tool.description]),
      canonicalSkill,
    ].join("\n");
    for (const legacyName of LEGACY_TOOL_NAMES) {
      expect(advertisedText).not.toContain(legacyName);
      const result = await connection.client.callTool({ name: legacyName, arguments: {} });
      expect(result).toMatchObject({ isError: true });
      expect(result.content).toEqual([
        expect.objectContaining({ type: "text", text: expect.stringContaining("not found") }),
      ]);
    }
    expect(advertisedText).not.toContain("synara-excalidraw");
    expect(bridge.readSaveAttemptCount()).toBe(0);

    await connection.close();
  });

  it("streams two ordered semantic batches before one revision-checked commit", async () => {
    const bridge = await startBridge();
    const connection = await connectClient(bridge.config);

    const begin = await connection.client.callTool({ name: "begin", arguments: {} });
    expect(begin.isError).not.toBe(true);
    expect(begin).toMatchObject({ structuredContent: { previewDelivered: true } });

    const [firstAppend, secondAppend] = await Promise.all([
      connection.client.callTool({
        name: "append",
        arguments: {
          elements: JSON.stringify([
            { type: "cameraUpdate", x: 40, y: 60, width: 640, height: 480 },
            { id: "box-1", type: "rectangle", x: 80, y: 100, width: 240, height: 120 },
          ]),
        },
      }),
      connection.client.callTool({
        name: "append",
        arguments: {
          elements: JSON.stringify([
            { type: "cameraUpdate", x: 320, y: 60, width: 640, height: 480 },
            { id: "box-2", type: "rectangle", x: 400, y: 100, width: 240, height: 120 },
          ]),
        },
      }),
    ]);

    expect(firstAppend.isError).not.toBe(true);
    expect(firstAppend).toMatchObject({
      structuredContent: { sequence: 1, previewDelivered: true },
    });
    expect(secondAppend.isError).not.toBe(true);
    expect(secondAppend).toMatchObject({
      structuredContent: { sequence: 2, previewDelivered: true },
    });
    expect(bridge.readSaveCount()).toBe(0);
    expect(bridge.readScene().elements).toEqual([]);
    expect(bridge.readPreviews().map(({ phase, sequence }) => ({ phase, sequence }))).toEqual([
      { phase: "start", sequence: 0 },
      { phase: "partial", sequence: 1 },
      { phase: "partial", sequence: 2 },
    ]);
    expect(bridge.readPreviews()[1]).toMatchObject({
      camera: { x: 40, y: 60, width: 640, height: 480 },
      operations: expect.arrayContaining([expect.objectContaining({ id: "box-1" })]),
    });

    const commit = await connection.client.callTool({ name: "commit", arguments: {} });
    expect(commit.isError).not.toBe(true);
    expect(commit).toMatchObject({
      structuredContent: { revision: "revision-2", elementCount: 2, previewDelivered: true },
    });
    expect(bridge.readSaveAttemptCount()).toBe(1);
    expect(bridge.readSaveCount()).toBe(1);
    expect(bridge.readScene().elements.map((element) => element.id)).toEqual(["box-1", "box-2"]);
    expect(bridge.readPreviews().at(-1)).toMatchObject({ phase: "complete", sequence: 3 });

    await connection.close();
  });

  it("rejects append, commit, and cancel when no preview is active", async () => {
    const bridge = await startBridge();
    const connection = await connectClient(bridge.config);

    const append = await connection.client.callTool({
      name: "append",
      arguments: { elements: "[]" },
    });
    const commit = await connection.client.callTool({ name: "commit", arguments: {} });
    const cancel = await connection.client.callTool({ name: "cancel", arguments: {} });

    expect(append).toMatchObject({ isError: true });
    expect(commit).toMatchObject({ isError: true });
    expect(cancel).toMatchObject({ isError: true });
    expect(append.content).toEqual([
      expect.objectContaining({ type: "text", text: expect.stringContaining("Call begin") }),
    ]);
    expect(commit.content).toEqual([
      expect.objectContaining({ type: "text", text: expect.stringContaining("Call begin") }),
    ]);
    expect(cancel.content).toEqual([
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining("no active drawing preview"),
      }),
    ]);
    expect(bridge.readPreviews()).toEqual([]);
    expect(bridge.readSaveAttemptCount()).toBe(0);

    await connection.close();
  });

  it("cancels an abandoned stream before a new begin and preserves the saved scene on cancel", async () => {
    const savedElement = { id: "saved", type: "rectangle", x: 10, y: 10 };
    const bridge = await startBridge({ initialElements: [savedElement] });
    const connection = await connectClient(bridge.config);

    await connection.client.callTool({ name: "begin", arguments: {} });
    await connection.client.callTool({
      name: "append",
      arguments: {
        elements: JSON.stringify([
          { id: "temporary-1", type: "rectangle", x: 100, y: 100 },
        ]),
      },
    });
    await connection.client.callTool({ name: "begin", arguments: {} });
    expect(bridge.readPreviews().map((preview) => preview.phase)).toEqual([
      "start",
      "partial",
      "cancelled",
      "start",
    ]);
    expect(bridge.readPreviews()[2]).toMatchObject({ sequence: 2 });

    await connection.client.callTool({
      name: "append",
      arguments: {
        elements: JSON.stringify([
          { id: "temporary-2", type: "rectangle", x: 200, y: 200 },
        ]),
      },
    });
    const cancel = await connection.client.callTool({ name: "cancel", arguments: {} });
    expect(cancel.isError).not.toBe(true);
    expect(bridge.readPreviews().at(-1)).toMatchObject({ phase: "cancelled", sequence: 2 });
    expect(bridge.readScene().elements).toEqual([savedElement]);
    expect(bridge.readSaveAttemptCount()).toBe(0);

    expect((await connection.client.callTool({ name: "begin", arguments: {} })).isError).not.toBe(
      true,
    );

    await connection.close();
  });

  it("cancels preview semantics on revision conflict without overwriting the saved scene", async () => {
    const savedElement = { id: "saved", type: "rectangle", x: 10, y: 10 };
    const bridge = await startBridge({ conflictOnSave: true, initialElements: [savedElement] });
    const connection = await connectClient(bridge.config);

    await connection.client.callTool({ name: "begin", arguments: {} });
    await connection.client.callTool({
      name: "append",
      arguments: {
        elements: JSON.stringify([
          { id: "temporary-1", type: "rectangle", x: 100, y: 100 },
        ]),
      },
    });
    await connection.client.callTool({
      name: "append",
      arguments: {
        elements: JSON.stringify([
          { id: "temporary-2", type: "rectangle", x: 200, y: 200 },
        ]),
      },
    });
    const commit = await connection.client.callTool({ name: "commit", arguments: {} });

    expect(commit).toMatchObject({ isError: true });
    expect(commit.content).toEqual([
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining("Drawing changed while the agent was editing it"),
      }),
    ]);
    expect(bridge.readPreviews().map((preview) => preview.phase)).toEqual([
      "start",
      "partial",
      "partial",
      "cancelled",
    ]);
    expect(bridge.readSaveAttemptCount()).toBe(1);
    expect(bridge.readSaveCount()).toBe(0);
    expect(bridge.readScene().elements).toEqual([savedElement]);

    await connection.close();
  });

  it("keeps preview transport failures from blocking exactly one atomic save", async () => {
    const bridge = await startBridge({ previewStatus: 500 });
    const connection = await connectClient(bridge.config);

    const begin = await connection.client.callTool({ name: "begin", arguments: {} });
    const firstAppend = await connection.client.callTool({
      name: "append",
      arguments: {
        elements: JSON.stringify([
          { id: "saved-1", type: "rectangle", x: 0, y: 0 },
        ]),
      },
    });
    const secondAppend = await connection.client.callTool({
      name: "append",
      arguments: {
        elements: JSON.stringify([
          { id: "saved-2", type: "rectangle", x: 100, y: 0 },
        ]),
      },
    });
    const commit = await connection.client.callTool({ name: "commit", arguments: {} });

    for (const result of [begin, firstAppend, secondAppend, commit]) {
      expect(result).toMatchObject({ structuredContent: { previewDelivered: false } });
    }
    expect(bridge.readPreviews().map((preview) => preview.phase)).toEqual(["start"]);
    expect(bridge.readSaveAttemptCount()).toBe(1);
    expect(bridge.readSaveCount()).toBe(1);
    expect(bridge.readScene().elements.map((element) => element.id)).toEqual([
      "saved-1",
      "saved-2",
    ]);

    await connection.close();
  });

  it("bounds malformed operations, oversized input, invalid cameras, and missing checkpoints", async () => {
    const bridge = await startBridge();
    const connection = await connectClient(bridge.config);
    await connection.client.callTool({ name: "begin", arguments: {} });

    const malformed = await connection.client.callTool({
      name: "append",
      arguments: { elements: "not-json" },
    });
    const oversized = await connection.client.callTool({
      name: "append",
      arguments: { elements: "x".repeat(MAX_INPUT_BYTES + 1) },
    });
    const invalidCamera = await connection.client.callTool({
      name: "append",
      arguments: {
        elements: JSON.stringify([
          { type: "cameraUpdate", x: 0, y: 0, width: 0, height: 600 },
        ]),
      },
    });
    const missingCheckpoint = await connection.client.callTool({
      name: "append",
      arguments: {
        elements: JSON.stringify([{ type: "restoreCheckpoint", id: "missing" }]),
      },
    });

    for (const result of [malformed, oversized, invalidCamera, missingCheckpoint]) {
      expect(result).toMatchObject({ isError: true });
    }
    expect(bridge.readSaveAttemptCount()).toBe(0);
    expect(bridge.readPreviews().map((preview) => preview.phase)).toEqual(["start"]);

    const validAppend = await connection.client.callTool({
      name: "append",
      arguments: {
        elements: JSON.stringify([{ id: "valid", type: "rectangle", x: 0, y: 0 }]),
      },
    });
    expect(validAppend.isError).not.toBe(true);
    expect((await connection.client.callTool({ name: "commit", arguments: {} })).isError).not.toBe(
      true,
    );
    expect(bridge.readSaveCount()).toBe(1);

    await connection.close();
  });
});

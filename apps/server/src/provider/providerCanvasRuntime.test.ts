// FILE: providerCanvasRuntime.test.ts
// Purpose: Proves every Provider-facing Canvas MCP configuration uses the shared namespace.
// Layer: Provider runtime utility tests

import { ThreadId, type ProviderCanvasRuntime } from "@synara/contracts";
import { CANVAS_MCP_NAMESPACE } from "@synara/shared/canvasAgentContract";
import { describe, expect, it } from "vitest";

import {
  canvasAcpMcpServers,
  canvasMcpEnvironment,
  canvasStdioMcpServer,
} from "./providerCanvasRuntime.ts";

const canvas: ProviderCanvasRuntime = {
  bridgeUrl: "http://127.0.0.1:43100",
  bridgeToken: "bridge-token",
  threadId: ThreadId.makeUnsafe("thread-canvas-runtime"),
  mcpCommand: "/opt/synara/canvas-mcp",
  mcpArgs: ["--stdio", "--runtime=canvas"],
};

const expectedEnvironment = {
  SYNARA_CANVAS_BRIDGE_URL: canvas.bridgeUrl,
  SYNARA_CANVAS_BRIDGE_TOKEN: canvas.bridgeToken,
  SYNARA_CANVAS_THREAD_ID: canvas.threadId,
};

describe("Provider Canvas runtime", () => {
  it("emits exactly one ACP server under the shared canvas namespace", () => {
    expect(canvasAcpMcpServers(canvas)).toEqual([
      {
        name: CANVAS_MCP_NAMESPACE,
        command: canvas.mcpCommand,
        args: canvas.mcpArgs,
        env: Object.entries(expectedEnvironment).map(([name, value]) => ({ name, value })),
      },
    ]);
    expect(JSON.stringify(canvasAcpMcpServers(canvas))).not.toContain("synara-excalidraw");
  });

  it("keeps stdio command, args, and bridge environment unchanged", () => {
    expect(canvasMcpEnvironment(canvas)).toEqual(expectedEnvironment);
    expect(canvasStdioMcpServer(canvas)).toEqual({
      type: "stdio",
      command: canvas.mcpCommand,
      args: canvas.mcpArgs,
      env: expectedEnvironment,
    });
  });
});

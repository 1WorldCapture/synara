// FILE: providerCanvasRuntime.ts
// Purpose: Builds provider-specific MCP configuration from the shared Canvas runtime grant.
// Layer: Provider runtime utilities

import type { ProviderCanvasRuntime } from "@synara/contracts";
import { CANVAS_MCP_NAMESPACE } from "@synara/shared/canvasAgentContract";
import type * as EffectAcpSchema from "effect-acp/schema";

// Provider sessions snapshot this configuration at startup. Applying a contract
// change requires recreating the session; active sessions are never mutated.
export function canvasMcpEnvironment(canvas: ProviderCanvasRuntime): Record<string, string> {
  return {
    SYNARA_CANVAS_BRIDGE_URL: canvas.bridgeUrl,
    SYNARA_CANVAS_BRIDGE_TOKEN: canvas.bridgeToken,
    SYNARA_CANVAS_THREAD_ID: canvas.threadId,
  };
}

export function canvasAcpMcpServers(
  canvas: ProviderCanvasRuntime,
): ReadonlyArray<EffectAcpSchema.McpServer> {
  return [
    {
      name: CANVAS_MCP_NAMESPACE,
      command: canvas.mcpCommand,
      args: [...canvas.mcpArgs],
      env: Object.entries(canvasMcpEnvironment(canvas)).map(([name, value]) => ({ name, value })),
    },
  ];
}

export function canvasStdioMcpServer(canvas: ProviderCanvasRuntime): {
  readonly type: "stdio";
  readonly command: string;
  readonly args: string[];
  readonly env: Record<string, string>;
} {
  return {
    type: "stdio",
    command: canvas.mcpCommand,
    args: [...canvas.mcpArgs],
    env: canvasMcpEnvironment(canvas),
  };
}

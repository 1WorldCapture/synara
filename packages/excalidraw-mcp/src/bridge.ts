import type { CanvasAgentPreviewEvent } from "@synara/contracts";

export interface BridgeSceneSnapshot {
  readonly relativePath: string;
  readonly scene: {
    readonly elements: ReadonlyArray<Record<string, unknown>>;
    readonly appState: Record<string, unknown>;
    readonly files?: Record<string, unknown>;
    readonly [key: string]: unknown;
  };
  readonly revision: string;
}

export interface CanvasBridgeConfig {
  readonly baseUrl: string;
  readonly token: string;
  readonly threadId: string;
}

export type BridgeAgentPreview = Omit<CanvasAgentPreviewEvent, "threadId">;

const BRIDGE_REQUEST_TIMEOUT_MS = 15_000;
const PREVIEW_REQUEST_TIMEOUT_MS = 1_000;

export function readBridgeConfig(env: NodeJS.ProcessEnv = process.env): CanvasBridgeConfig {
  const baseUrl = env.SYNARA_CANVAS_BRIDGE_URL?.trim();
  const token = env.SYNARA_CANVAS_BRIDGE_TOKEN?.trim();
  const threadId = env.SYNARA_CANVAS_THREAD_ID?.trim();
  if (!baseUrl || !token || !threadId) {
    throw new Error("Synara Canvas bridge configuration is incomplete.");
  }
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) {
    throw new Error("Synara Canvas bridge must use a loopback HTTP URL.");
  }
  return { baseUrl: parsed.toString().replace(/\/$/, ""), token, threadId };
}

async function postBridge(
  config: CanvasBridgeConfig,
  operation: "read" | "save" | "preview",
  body: Record<string, unknown>,
  timeoutMs = BRIDGE_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const response = await fetch(`${config.baseUrl}/internal/canvas/${operation}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
    },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({ threadId: config.threadId, ...body }),
  });
  if (!response.ok) {
    throw new Error(
      response.status === 409
        ? "Drawing changed while the agent was editing it. Read the scene and retry."
        : `Synara Canvas bridge ${operation} failed (${response.status}).`,
    );
  }
  return response;
}

async function requestBridge(
  config: CanvasBridgeConfig,
  operation: "read" | "save",
  body: Record<string, unknown>,
): Promise<BridgeSceneSnapshot> {
  const response = await postBridge(config, operation, body);
  return (await response.json()) as BridgeSceneSnapshot;
}

export const readScene = (config: CanvasBridgeConfig) => requestBridge(config, "read", {});

export const saveScene = (
  config: CanvasBridgeConfig,
  input: { readonly scene: BridgeSceneSnapshot["scene"]; readonly expectedRevision: string },
) => requestBridge(config, "save", input);

export async function publishPreview(
  config: CanvasBridgeConfig,
  preview: BridgeAgentPreview,
): Promise<void> {
  await postBridge(config, "preview", { ...preview }, PREVIEW_REQUEST_TIMEOUT_MS);
}

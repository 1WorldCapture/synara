import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

import {
  CanvasAgentPreviewEvent,
  type CanvasAgentPreviewEvent as CanvasAgentPreviewEventType,
  type CanvasDrawingChangedEvent,
} from "@synara/contracts";
import { MAX_CANVAS_SCENE_BYTES } from "@synara/shared/excalidrawScene";
import { Schema } from "effect";

import {
  CanvasDrawingConflictError,
  createCanvasDrawing,
  saveCanvasDrawing,
} from "./canvasDrawingFiles";
import type { CanvasDrawingRef } from "./canvasDrawingStorage";

const CAPABILITY_TTL_MS = 12 * 60 * 60 * 1_000;
const MAX_CAPABILITIES = 256;
const MAX_BRIDGE_REQUEST_BYTES = MAX_CANVAS_SCENE_BYTES + 64 * 1024;
const PREVIEW_TTL_MS = 2 * 60 * 1_000;
const MAX_ACTIVE_PREVIEW_STREAMS = 32;
const MAX_PREVIEW_STREAM_BYTES = MAX_CANVAS_SCENE_BYTES + 64 * 1024;
const MAX_PREVIEW_REPLAY_BYTES = 32 * 1024 * 1024;

export interface CanvasBridgeDiagnostic {
  readonly stage:
    | "bridge.accepted"
    | "bridge.invalid"
    | "bridge.listener-failed"
    | "bridge.rejected"
    | "rpc.replayed"
    | "rpc.subscriber-attached"
    | "rpc.subscriber-detached";
  readonly threadId?: string;
  readonly streamId?: string;
  readonly sequence?: number;
  readonly phase?: CanvasAgentPreviewEventType["phase"];
  readonly baseRevision?: string;
  readonly operationCount?: number;
  readonly listenerCount?: number;
  readonly replayEventCount?: number;
  readonly currentStreamId?: string;
  readonly currentSequence?: number;
  readonly expectedSequence?: number;
  readonly reason?:
    | "invalid-payload"
    | "listener-threw"
    | "missing-stream-start"
    | "sequence-gap"
    | "stream-mismatch";
}

export type CanvasBridgeDiagnosticListener = (event: CanvasBridgeDiagnostic) => void;

function emitCanvasBridgeDiagnostic(
  listener: CanvasBridgeDiagnosticListener | undefined,
  event: CanvasBridgeDiagnostic,
): void {
  try {
    listener?.(event);
  } catch {
    // Diagnostics must never affect drawing delivery.
  }
}

function previewDiagnosticFields(event: CanvasAgentPreviewEventType) {
  return {
    threadId: event.threadId,
    streamId: event.streamId,
    sequence: event.sequence,
    phase: event.phase,
    baseRevision: event.baseRevision,
    operationCount: event.operations.length,
  } satisfies Partial<CanvasBridgeDiagnostic>;
}

interface CanvasBridgeGrant extends CanvasDrawingRef {
  expiresAt: number;
}

const grants = new Map<string, CanvasBridgeGrant>();
const drawingChangedListeners = new Set<(event: CanvasDrawingChangedEvent) => void>();
const agentPreviewListeners = new Set<(event: CanvasAgentPreviewEventType) => void>();
const agentPreviewStates = new Map<
  string,
  {
    readonly streamId: string;
    readonly sequence: number;
    readonly replayable: boolean;
    readonly expiresAt: number;
    readonly events: CanvasAgentPreviewEventType[];
    readonly byteLength: number;
  }
>();

function publishCanvasDrawingChanged(event: CanvasDrawingChangedEvent): void {
  for (const listener of drawingChangedListeners) {
    try {
      listener(event);
    } catch {
      // One renderer subscriber must not fail an agent save.
    }
  }
}

export function subscribeCanvasDrawingChanges(
  listener: (event: CanvasDrawingChangedEvent) => void,
): () => void {
  drawingChangedListeners.add(listener);
  return () => drawingChangedListeners.delete(listener);
}

function pruneAgentPreviews(now = Date.now()): void {
  for (const [threadId, state] of agentPreviewStates) {
    if (state.expiresAt <= now) agentPreviewStates.delete(threadId);
  }
}

function trimAgentPreviewReplayBuffers(): void {
  while (agentPreviewStates.size > MAX_ACTIVE_PREVIEW_STREAMS) {
    const oldest = agentPreviewStates.keys().next().value;
    if (oldest === undefined) break;
    agentPreviewStates.delete(oldest);
  }
  let totalBytes = [...agentPreviewStates.values()].reduce(
    (total, state) => total + state.byteLength,
    0,
  );
  if (totalBytes <= MAX_PREVIEW_REPLAY_BYTES) return;
  for (const [threadId, state] of agentPreviewStates) {
    if (state.byteLength === 0) continue;
    totalBytes -= state.byteLength;
    agentPreviewStates.set(threadId, {
      ...state,
      replayable: false,
      events: [],
      byteLength: 0,
    });
    if (totalBytes <= MAX_PREVIEW_REPLAY_BYTES) break;
  }
}

function publishCanvasAgentPreview(
  event: CanvasAgentPreviewEventType,
  onDiagnostic?: CanvasBridgeDiagnosticListener,
): void {
  pruneAgentPreviews();
  const current = agentPreviewStates.get(event.threadId);
  if (!current && (event.phase !== "start" || event.sequence !== 0)) {
    emitCanvasBridgeDiagnostic(onDiagnostic, {
      stage: "bridge.rejected",
      ...previewDiagnosticFields(event),
      expectedSequence: 0,
      reason: "missing-stream-start",
    });
    return;
  }
  if (current) {
    if (current.streamId === event.streamId) {
      if (event.sequence !== current.sequence + 1) {
        emitCanvasBridgeDiagnostic(onDiagnostic, {
          stage: "bridge.rejected",
          ...previewDiagnosticFields(event),
          currentStreamId: current.streamId,
          currentSequence: current.sequence,
          expectedSequence: current.sequence + 1,
          reason: "sequence-gap",
        });
        return;
      }
    } else if (event.phase !== "start" || event.sequence !== 0) {
      emitCanvasBridgeDiagnostic(onDiagnostic, {
        stage: "bridge.rejected",
        ...previewDiagnosticFields(event),
        currentStreamId: current.streamId,
        currentSequence: current.sequence,
        expectedSequence: 0,
        reason: "stream-mismatch",
      });
      return;
    }
  }
  const terminal = event.phase === "complete" || event.phase === "cancelled";
  const encodedBytes = Buffer.byteLength(JSON.stringify(event));
  const replayable = !terminal && (current?.streamId !== event.streamId || current.replayable);
  let bufferedEvents: CanvasAgentPreviewEventType[] = [];
  if (replayable) {
    if (current?.streamId === event.streamId) {
      bufferedEvents = current.events;
      bufferedEvents.push(event);
    } else {
      bufferedEvents = [event];
    }
  }
  const bufferedBytes = terminal
    ? 0
    : current?.streamId === event.streamId && replayable
      ? current.byteLength + encodedBytes
      : replayable
        ? encodedBytes
        : 0;
  const withinReplayLimit = replayable && bufferedBytes <= MAX_PREVIEW_STREAM_BYTES;
  agentPreviewStates.delete(event.threadId);
  if (!terminal) {
    agentPreviewStates.set(event.threadId, {
      streamId: event.streamId,
      sequence: event.sequence,
      replayable: withinReplayLimit,
      expiresAt: Date.now() + PREVIEW_TTL_MS,
      events: withinReplayLimit ? bufferedEvents : [],
      byteLength: withinReplayLimit ? bufferedBytes : 0,
    });
  }
  trimAgentPreviewReplayBuffers();
  emitCanvasBridgeDiagnostic(onDiagnostic, {
    stage: "bridge.accepted",
    ...previewDiagnosticFields(event),
    listenerCount: agentPreviewListeners.size,
  });
  for (const listener of agentPreviewListeners) {
    try {
      listener(event);
    } catch {
      emitCanvasBridgeDiagnostic(onDiagnostic, {
        stage: "bridge.listener-failed",
        ...previewDiagnosticFields(event),
        listenerCount: agentPreviewListeners.size,
        reason: "listener-threw",
      });
      // One renderer subscriber must not fail an agent preview.
    }
  }
}

export function subscribeCanvasAgentPreviews(
  listener: (event: CanvasAgentPreviewEventType) => void,
  onDiagnostic?: CanvasBridgeDiagnosticListener,
): () => void {
  pruneAgentPreviews();
  agentPreviewListeners.add(listener);
  const replayEvents = [...agentPreviewStates.values()].flatMap((state) => state.events);
  emitCanvasBridgeDiagnostic(onDiagnostic, {
    stage: "rpc.subscriber-attached",
    listenerCount: agentPreviewListeners.size,
    replayEventCount: replayEvents.length,
  });
  for (const event of replayEvents) {
    emitCanvasBridgeDiagnostic(onDiagnostic, {
      stage: "rpc.replayed",
      ...previewDiagnosticFields(event),
      listenerCount: agentPreviewListeners.size,
    });
    listener(event);
  }
  return () => {
    agentPreviewListeners.delete(listener);
    emitCanvasBridgeDiagnostic(onDiagnostic, {
      stage: "rpc.subscriber-detached",
      listenerCount: agentPreviewListeners.size,
    });
  };
}

function tokenKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function pruneExpired(now = Date.now()): void {
  for (const [token, grant] of grants) {
    if (grant.expiresAt <= now) grants.delete(token);
  }
  while (grants.size >= MAX_CAPABILITIES) {
    const oldest = grants.keys().next().value;
    if (oldest === undefined) break;
    grants.delete(oldest);
  }
}

export function issueCanvasBridgeCapability(
  input: CanvasDrawingRef,
): { readonly token: string; readonly expiresAt: number } {
  pruneExpired();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + CAPABILITY_TTL_MS;
  grants.set(tokenKey(token), { ...input, expiresAt });
  return { token, expiresAt };
}

export function revokeCanvasBridgeCapability(token: string): void {
  grants.delete(tokenKey(token));
}

export function revokeCanvasBridgeCapabilitiesForThread(threadId: string): number {
  let revoked = 0;
  for (const [token, grant] of grants) {
    if (grant.threadId !== threadId) continue;
    grants.delete(token);
    revoked += 1;
  }
  agentPreviewStates.delete(threadId);
  return revoked;
}

export function authorizeCanvasBridgeCapability(
  token: string,
  threadId: string,
): CanvasDrawingRef | null {
  const now = Date.now();
  pruneExpired(now);
  const grant = grants.get(tokenKey(token));
  if (!grant) return null;
  const left = Buffer.from(grant.threadId);
  const right = Buffer.from(threadId);
  if (left.byteLength !== right.byteLength || !timingSafeEqual(left, right)) return null;
  grant.expiresAt = now + CAPABILITY_TTL_MS;
  return {
    root: grant.root,
    threadId: grant.threadId,
  };
}

export function resetCanvasBridgeCapabilitiesForTest(): void {
  grants.clear();
  drawingChangedListeners.clear();
  agentPreviewListeners.clear();
  agentPreviewStates.clear();
}

function parseCanvasAgentPreview(
  record: Record<string, unknown>,
  threadId: CanvasDrawingRef["threadId"],
): CanvasAgentPreviewEventType | null {
  try {
    return Schema.decodeUnknownSync(CanvasAgentPreviewEvent)({ ...record, threadId });
  } catch {
    return null;
  }
}

function isLoopbackAddress(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

async function readJsonBody(request: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let byteLength = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteLength += buffer.byteLength;
    if (byteLength > MAX_BRIDGE_REQUEST_BYTES) {
      throw new RangeError("Canvas bridge request is too large.");
    }
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(
  response: import("node:http").ServerResponse,
  status: number,
  value: unknown,
): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

export interface CanvasBridgeServer {
  readonly baseUrl: string;
  readonly close: () => Promise<void>;
}

export function startCanvasBridgeServer(options?: {
  readonly onDiagnostic?: CanvasBridgeDiagnosticListener;
}): Promise<CanvasBridgeServer> {
  return new Promise((resolve, reject) => {
    const server = createServer(async (request, response) => {
      if (!isLoopbackAddress(request.socket.remoteAddress)) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      if (request.method !== "POST") {
        response.writeHead(405).end("Method Not Allowed");
        return;
      }

      try {
        const payload = await readJsonBody(request);
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
          response.writeHead(400).end("Bad Request");
          return;
        }
        const record = payload as Record<string, unknown>;
        const threadId = typeof record.threadId === "string" ? record.threadId : "";
        const authorization = request.headers.authorization ?? "";
        const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
        const drawing = authorizeCanvasBridgeCapability(token, threadId);
        if (!drawing) {
          response.writeHead(403).end("Forbidden");
          return;
        }

        if (request.url === "/internal/canvas/read") {
          sendJson(response, 200, await createCanvasDrawing(drawing));
          return;
        }
        if (request.url === "/internal/canvas/save") {
          if (typeof record.expectedRevision !== "string" || !record.scene) {
            response.writeHead(400).end("Bad Request");
            return;
          }
          const snapshot = await saveCanvasDrawing({
            ...drawing,
            expectedRevision: record.expectedRevision,
            scene: record.scene as never,
          });
          publishCanvasDrawingChanged({
            threadId: drawing.threadId,
            revision: snapshot.revision,
          });
          sendJson(response, 200, snapshot);
          return;
        }
        if (request.url === "/internal/canvas/preview") {
          const event = parseCanvasAgentPreview(record, drawing.threadId);
          if (!event) {
            emitCanvasBridgeDiagnostic(options?.onDiagnostic, {
              stage: "bridge.invalid",
              threadId: drawing.threadId,
              reason: "invalid-payload",
            });
            response.writeHead(400).end("Bad Request");
            return;
          }
          publishCanvasAgentPreview(event, options?.onDiagnostic);
          response.writeHead(202).end();
          return;
        }
        response.writeHead(404).end("Not Found");
      } catch (error) {
        if (response.headersSent) {
          response.end();
          return;
        }
        const status =
          error instanceof CanvasDrawingConflictError
            ? 409
            : error instanceof RangeError
              ? 413
              : error instanceof SyntaxError
                ? 400
                : 500;
        response.writeHead(status).end(
          error instanceof CanvasDrawingConflictError
            ? error.message
            : status === 413
              ? "Payload Too Large"
              : status === 400
                ? "Bad Request"
                : "Canvas bridge request failed",
        );
      }
    });

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Canvas bridge did not receive a TCP address."));
        return;
      }
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise<void>((closeResolve, closeReject) => {
            server.close((error) => (error ? closeReject(error) : closeResolve()));
          }),
      });
    });
  });
}

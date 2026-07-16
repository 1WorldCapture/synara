// FILE: canvasAgentState.ts
// Purpose: Derives the Canvas single-writer lock from namespace-safe agent tool activity.
// Layer: Web domain utility

import type {
  OrchestrationLatestTurn,
  OrchestrationThreadActivity,
  TurnId,
} from "@synara/contracts";
import {
  CANVAS_MCP_NAMESPACE,
  isCanvasMutationToolName,
  type CanvasMutationToolName,
} from "@synara/shared/canvasAgentContract";

const IDENTITY_KEYS = ["toolName", "tool_name", "tool", "name", "title"] as const;
const STRUCTURED_CONTAINER_KEYS = ["data", "item", "call", "toolCall", "payload"] as const;
const MCP_SERVER_KEYS = ["server", "serverName", "mcpServer", "mcpServerName"] as const;
const MCP_TOOL_KEYS = ["tool", "toolName", "tool_name", "name"] as const;
const QUALIFIED_CANVAS_TOOL = /^(?:mcp__)?canvas\s*(?:__|[.:/])\s*([a-z_]+)$/i;
const ACTIVITY_STATE_PREFIX = /^(?:running|run|calling|call)\s+/i;
const ACTIVITY_STATE_SUFFIX =
  /\s+(?:complete|completed|done|finished|success|succeeded|started|running|failed|cancelled)$/i;

const HISTORICAL_MUTATION_IDENTITIES = new Map<string, CanvasMutationToolName>([
  ["begin_view", "begin"],
  ["append_view", "append"],
  ["commit_view", "commit"],
  ["cancel_view", "cancel"],
  ["create_view", "commit"],
  ["canvas_create_view", "commit"],
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizedActivityIdentity(value: string): string {
  return value
    .trim()
    .replace(ACTIVITY_STATE_PREFIX, "")
    .replace(ACTIVITY_STATE_SUFFIX, "")
    .trim()
    .toLowerCase();
}

function mutationFromIdentity(value: string): CanvasMutationToolName | null {
  const normalized = normalizedActivityIdentity(value);
  const qualified = QUALIFIED_CANVAS_TOOL.exec(normalized)?.[1];
  if (qualified && isCanvasMutationToolName(qualified)) {
    return qualified;
  }

  const historicalIdentity = normalized.startsWith("mcp__synara-excalidraw__")
    ? normalized.slice("mcp__synara-excalidraw__".length)
    : normalized;
  return HISTORICAL_MUTATION_IDENTITIES.get(historicalIdentity) ?? null;
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function mutationFromStructuredMcpMetadata(
  value: unknown,
  depth = 0,
): CanvasMutationToolName | null {
  if (depth > 4) return null;
  const record = asRecord(value);
  if (!record) return null;

  const server = firstString(record, MCP_SERVER_KEYS)?.toLowerCase();
  const tool = firstString(record, MCP_TOOL_KEYS)?.toLowerCase();
  if (server === CANVAS_MCP_NAMESPACE && tool && isCanvasMutationToolName(tool)) {
    return tool;
  }

  for (const key of STRUCTURED_CONTAINER_KEYS) {
    const nested = mutationFromStructuredMcpMetadata(record[key], depth + 1);
    if (nested) return nested;
  }
  return null;
}

/**
 * Returns a Canvas mutation only from a model-visible qualified identity or paired MCP metadata.
 * Arbitrary detail/input/output strings are intentionally excluded from this UI fallback.
 */
export function canvasAgentMutationToolName(
  activity: OrchestrationThreadActivity,
): CanvasMutationToolName | null {
  if (activity.tone !== "tool") return null;
  const payload = asRecord(activity.payload) ?? {};

  const structured = mutationFromStructuredMcpMetadata(payload);
  if (structured) return structured;

  const candidates = [activity.summary];
  for (const key of IDENTITY_KEYS) {
    const value = payload[key];
    if (typeof value === "string") candidates.push(value);
  }
  const data = asRecord(payload.data);
  if (data) {
    for (const key of IDENTITY_KEYS) {
      const value = data[key];
      if (typeof value === "string") candidates.push(value);
    }
  }

  for (const candidate of candidates) {
    const mutation = mutationFromIdentity(candidate);
    if (mutation) return mutation;
  }
  return null;
}

export function canvasAgentMutationTurnId(input: {
  latestTurn: OrchestrationLatestTurn | null;
  activities: readonly OrchestrationThreadActivity[];
}): TurnId | null {
  const turnId = input.latestTurn?.turnId ?? null;
  if (!turnId) return null;
  return input.activities.some(
    (activity) => activity.turnId === turnId && canvasAgentMutationToolName(activity) !== null,
  )
    ? turnId
    : null;
}

export function isCanvasAgentEditing(input: {
  latestTurn: OrchestrationLatestTurn | null;
  activities: readonly OrchestrationThreadActivity[];
}): boolean {
  return (
    input.latestTurn?.state === "running" && canvasAgentMutationTurnId(input) !== null
  );
}

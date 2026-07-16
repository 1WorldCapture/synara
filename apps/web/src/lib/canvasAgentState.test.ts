import { describe, expect, it } from "vitest";
import {
  type OrchestrationThreadActivity,
  EventId,
  TurnId,
} from "@synara/contracts";

import {
  canvasAgentMutationToolName,
  canvasAgentMutationTurnId,
  isCanvasAgentEditing,
} from "./canvasAgentState";

const turnId = TurnId.makeUnsafe("turn-1");

function latestTurn(state: "running" | "completed" = "running") {
  return {
    turnId,
    state,
    requestedAt: "2026-07-14T00:00:00.000Z",
    startedAt: "2026-07-14T00:00:00.000Z",
    completedAt: state === "running" ? null : "2026-07-14T00:00:01.000Z",
    assistantMessageId: null,
  } as const;
}

function activity(
  id: string,
  summary: string,
  payload: Record<string, unknown>,
): OrchestrationThreadActivity {
  return {
    id: EventId.makeUnsafe(id),
    tone: "tool",
    kind: "tool.started",
    summary,
    payload,
    turnId,
    createdAt: "2026-07-14T00:00:00.000Z",
  };
}

describe("Canvas agent activity identity", () => {
  it.each([
    ["mcp__canvas__begin", "begin"],
    ["mcp__canvas__append", "append"],
    ["canvas.commit", "commit"],
    ["canvas/cancel", "cancel"],
    ["Canvas: append started", "append"],
  ] as const)("recognizes the qualified mutation identity %s", (identity, toolName) => {
    expect(
      canvasAgentMutationToolName(activity(`event-${toolName}`, identity, { toolName: identity })),
    ).toBe(toolName);
  });

  it("recognizes paired structured MCP metadata without reading arbitrary detail", () => {
    expect(
      canvasAgentMutationToolName(
        activity("event-structured", "MCP tool call started", {
          title: "MCP tool call",
          data: { server: "canvas", tool: "begin" },
        }),
      ),
    ).toBe("begin");
    expect(
      canvasAgentMutationToolName(
        activity("event-output", "MCP tool call started", {
          title: "MCP tool call",
          detail: "mcp__canvas__append",
          data: { rawOutput: "mcp__canvas__commit", detail: "canvas/cancel" },
        }),
      ),
    ).toBeNull();
  });

  it.each([
    "read",
    "begin",
    "append",
    "commit",
    "cancel",
    "git commit",
    "ordinary cancellation",
    "mcp__canvas__read",
    "mcp__other__append",
    "canvasish.append",
  ])("does not infer Canvas mutation state from %s", (identity) => {
    expect(
      canvasAgentMutationToolName(activity(`event-${identity}`, identity, { toolName: identity })),
    ).toBeNull();
  });

  it("keeps distinctive historical identities as exact UI-only fallbacks", () => {
    expect(
      canvasAgentMutationToolName(
        activity("event-legacy", "create_view started", { title: "MCP tool call" }),
      ),
    ).toBe("commit");
    expect(
      canvasAgentMutationToolName(
        activity("event-legacy-no-substring", "A create_view helper started", {
          title: "MCP tool call",
        }),
      ),
    ).toBeNull();
  });
});

describe("isCanvasAgentEditing", () => {
  const mutationActivity = activity("event-1", "mcp__canvas__begin", {
    data: { toolName: "mcp__canvas__begin" },
  });

  it("locks only while the current running turn has a qualified mutation activity", () => {
    expect(
      isCanvasAgentEditing({ latestTurn: latestTurn(), activities: [mutationActivity] }),
    ).toBe(true);
    expect(
      isCanvasAgentEditing({ latestTurn: latestTurn("completed"), activities: [mutationActivity] }),
    ).toBe(false);
    expect(
      canvasAgentMutationTurnId({
        latestTurn: latestTurn("completed"),
        activities: [mutationActivity],
      }),
    ).toBe(turnId);
  });

  it("keeps Canvas editable while the agent is only researching", () => {
    expect(isCanvasAgentEditing({ latestTurn: latestTurn(), activities: [] })).toBe(false);
    expect(
      canvasAgentMutationTurnId({ latestTurn: latestTurn("completed"), activities: [] }),
    ).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import {
  CANVAS_MCP_NAMESPACE,
  CANVAS_MCP_DISPLAY_NAME,
  CANVAS_MUTATION_TOOL_NAMES,
  CANVAS_SKILL_NAME,
  CANVAS_TOOL_NAMES,
  isCanvasMutationToolName,
  isCanvasToolName,
} from "./canvasAgentContract";

describe("Canvas Agent contract", () => {
  it("defines the stable built-in Skill and MCP identities", () => {
    expect(CANVAS_SKILL_NAME).toBe("canvas");
    expect(CANVAS_MCP_NAMESPACE).toBe("canvas");
    expect(CANVAS_MCP_DISPLAY_NAME).toBe("Synara Canvas");
    expect(CANVAS_TOOL_NAMES).toEqual([
      "read",
      "begin",
      "append",
      "commit",
      "cancel",
    ]);
    expect(CANVAS_MUTATION_TOOL_NAMES).toEqual(["begin", "append", "commit", "cancel"]);
  });

  it("exposes readonly membership helpers for all and mutation tools", () => {
    expect(isCanvasToolName("read")).toBe(true);
    expect(isCanvasToolName("read_scene")).toBe(false);
    expect(isCanvasMutationToolName("append")).toBe(true);
    expect(isCanvasMutationToolName("read")).toBe(false);
    expect(new Set(CANVAS_TOOL_NAMES).size).toBe(CANVAS_TOOL_NAMES.length);
  });
});

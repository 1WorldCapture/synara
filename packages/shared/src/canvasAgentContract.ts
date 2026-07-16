// FILE: canvasAgentContract.ts
// Purpose: Centralizes the stable Agent-facing Canvas Skill and MCP identities.
// Layer: Shared runtime utility

export const CANVAS_SKILL_NAME = "canvas" as const;
export const SYNARA_BUILTIN_SKILL_SCOPE = "synara-builtin" as const;
export const CANVAS_SKILL_ASSET_RELATIVE_PATH = "skills/canvas/SKILL.md" as const;
export const CANVAS_MCP_NAMESPACE = "canvas" as const;
export const CANVAS_MCP_DISPLAY_NAME = "Synara Canvas" as const;

export const CANVAS_TOOL_NAMES = ["read", "begin", "append", "commit", "cancel"] as const;
export type CanvasToolName = (typeof CANVAS_TOOL_NAMES)[number];

export const CANVAS_MUTATION_TOOL_NAMES = ["begin", "append", "commit", "cancel"] as const;
export type CanvasMutationToolName = (typeof CANVAS_MUTATION_TOOL_NAMES)[number];

export const CANVAS_TOOL_NAME_SET: ReadonlySet<string> = new Set(CANVAS_TOOL_NAMES);
export const CANVAS_MUTATION_TOOL_NAME_SET: ReadonlySet<string> = new Set(
  CANVAS_MUTATION_TOOL_NAMES,
);

export function isCanvasToolName(value: string): value is CanvasToolName {
  return CANVAS_TOOL_NAME_SET.has(value);
}

export function isCanvasMutationToolName(value: string): value is CanvasMutationToolName {
  return CANVAS_MUTATION_TOOL_NAME_SET.has(value);
}

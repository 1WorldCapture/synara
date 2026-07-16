// FILE: canvas-mcp-dist-assets.ts
// Purpose: Centralizes the release-critical files in a complete Canvas MCP distribution.
// Layer: Release/build helper

import { existsSync } from "node:fs";
import path from "node:path";

import {
  CANVAS_SKILL_ASSET_RELATIVE_PATH,
} from "../../packages/excalidraw-mcp/scripts/copySkillAssets.ts";

export const CANVAS_MCP_REQUIRED_DIST_ASSETS = [
  "main.mjs",
  CANVAS_SKILL_ASSET_RELATIVE_PATH,
] as const;

export function findMissingCanvasMcpDistAssets(distDir: string): string[] {
  return CANVAS_MCP_REQUIRED_DIST_ASSETS.filter(
    (relativePath) => !existsSync(path.join(distDir, relativePath)),
  );
}

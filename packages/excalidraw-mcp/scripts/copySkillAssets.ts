// FILE: copySkillAssets.ts
// Purpose: Copies canonical Agent Skill assets into the Canvas MCP distribution.
// Layer: Excalidraw MCP build helper

import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CANVAS_SKILL_ASSET_RELATIVE_PATH = "skills/canvas/SKILL.md";

export async function copySkillAssets(input: {
  readonly packageRoot?: string;
  readonly outDir?: string;
} = {}): Promise<string> {
  const packageRoot = input.packageRoot ?? path.resolve(import.meta.dirname, "..");
  const outDir = input.outDir ?? path.join(packageRoot, "dist");
  const sourcePath = path.join(packageRoot, CANVAS_SKILL_ASSET_RELATIVE_PATH);
  const targetPath = path.join(outDir, CANVAS_SKILL_ASSET_RELATIVE_PATH);

  await mkdir(path.dirname(targetPath), { recursive: true });
  await copyFile(sourcePath, targetPath);
  return targetPath;
}

const invokedPath = process.argv[1];
if (invokedPath && path.resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  await copySkillAssets();
}

// FILE: canvas-mcp-dist-assets.test.ts
// Purpose: Proves release staging fails closed when either Canvas MCP contract asset is absent.
// Layer: Release/build helper test

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CANVAS_MCP_REQUIRED_DIST_ASSETS,
  findMissingCanvasMcpDistAssets,
} from "./canvas-mcp-dist-assets.ts";

const tempDirs: string[] = [];

function makeDist(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "synara-canvas-mcp-dist-"));
  tempDirs.push(dir);
  return dir;
}

function writeAsset(root: string, relativePath: string): void {
  const assetPath = path.join(root, relativePath);
  mkdirSync(path.dirname(assetPath), { recursive: true });
  writeFileSync(assetPath, relativePath);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("Canvas MCP distribution assets", () => {
  it("requires the executable entry and canonical Skill source", () => {
    expect(CANVAS_MCP_REQUIRED_DIST_ASSETS).toEqual([
      "main.mjs",
      "skills/canvas/SKILL.md",
    ]);
  });

  it("reports the Skill as missing even when the executable exists", () => {
    const dist = makeDist();
    writeAsset(dist, "main.mjs");

    expect(findMissingCanvasMcpDistAssets(dist)).toEqual(["skills/canvas/SKILL.md"]);
  });

  it("accepts only a complete Canvas MCP distribution", () => {
    const dist = makeDist();
    for (const relativePath of CANVAS_MCP_REQUIRED_DIST_ASSETS) {
      writeAsset(dist, relativePath);
    }

    expect(findMissingCanvasMcpDistAssets(dist)).toEqual([]);
  });
});

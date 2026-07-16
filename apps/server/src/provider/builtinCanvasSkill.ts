// FILE: builtinCanvasSkill.ts
// Purpose: Atomically materializes Synara's bundled Canvas Skill on real disk.
// Layer: Server provider discovery helper

import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { CANVAS_SKILL_NAME } from "@synara/shared/canvasAgentContract";

export const SYNARA_BUILTIN_SKILL_SCOPE = "synara-builtin" as const;
export const BUILTIN_SKILLS_DIR_NAME = "builtin-skills" as const;

const CANVAS_SKILL_RELATIVE_PATH = path.join(CANVAS_SKILL_NAME, "SKILL.md");

export interface BuiltinCanvasSkillIo {
  readonly readFile: (filePath: string) => Promise<string>;
  readonly makeDirectory: (dirPath: string) => Promise<void>;
  readonly writeFile: (filePath: string, contents: string) => Promise<void>;
  readonly rename: (fromPath: string, toPath: string) => Promise<void>;
  readonly removeFile: (filePath: string) => Promise<void>;
}

const nodeIo: BuiltinCanvasSkillIo = {
  readFile: (filePath) => fs.readFile(filePath, "utf8"),
  makeDirectory: async (dirPath) => {
    await fs.mkdir(dirPath, { recursive: true });
  },
  writeFile: (filePath, contents) => fs.writeFile(filePath, contents, "utf8"),
  rename: fs.rename,
  removeFile: async (filePath) => {
    await fs.rm(filePath, { force: true });
  },
};

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === code
  );
}

export function builtinSkillsRoot(baseDir: string): string {
  return path.join(baseDir, BUILTIN_SKILLS_DIR_NAME);
}

export function builtinCanvasSkillPath(baseDir: string): string {
  return path.join(builtinSkillsRoot(baseDir), CANVAS_SKILL_RELATIVE_PATH);
}

export function resolveBuiltinCanvasSkillSourcePath(input: {
  readonly runtime?: "bun" | "node";
  readonly moduleDir?: string;
  readonly packageRoot?: string;
} = {}): string {
  const runtime = input.runtime ?? (process.versions.bun ? "bun" : "node");
  if (runtime === "node") {
    return path.join(
      input.moduleDir ?? import.meta.dirname,
      "excalidraw-mcp",
      "skills",
      CANVAS_SKILL_RELATIVE_PATH,
    );
  }

  const packageRoot =
    input.packageRoot ??
    path.dirname(createRequire(import.meta.url).resolve("@synara/excalidraw-mcp/package.json"));
  return path.join(packageRoot, "skills", CANVAS_SKILL_RELATIVE_PATH);
}

function hasCanvasSkillFrontmatter(contents: string): boolean {
  const frontmatter = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/.exec(
    contents.replace(/\r\n/g, "\n"),
  )?.[1];
  if (!frontmatter) return false;
  return frontmatter
    .split("\n")
    .some((line) => /^name:\s*["']?canvas["']?\s*$/.test(line.trim()));
}

export async function materializeBuiltinCanvasSkill(input: {
  readonly baseDir: string;
  readonly sourcePath?: string;
  readonly io?: BuiltinCanvasSkillIo;
}): Promise<string | null> {
  const io = input.io ?? nodeIo;
  const sourcePath = input.sourcePath ?? resolveBuiltinCanvasSkillSourcePath();
  const targetPath = builtinCanvasSkillPath(input.baseDir);
  const targetDir = path.dirname(targetPath);
  let tempPath: string | undefined;

  try {
    const sourceContents = await io.readFile(sourcePath);
    if (!hasCanvasSkillFrontmatter(sourceContents)) return null;

    await io.makeDirectory(targetDir);
    try {
      if ((await io.readFile(targetPath)) === sourceContents) {
        return targetPath;
      }
    } catch (error) {
      // Only absence authorizes creating the managed copy. Other read failures
      // fail closed so a last complete file is never replaced speculatively.
      if (!hasErrorCode(error, "ENOENT")) return null;
    }

    tempPath = path.join(
      targetDir,
      `.SKILL.md.${process.pid}.${Date.now()}.${randomUUID()}.tmp`,
    );
    await io.writeFile(tempPath, sourceContents);
    if ((await io.readFile(tempPath)) !== sourceContents) {
      throw new Error("Canvas Skill staging verification failed.");
    }
    await io.rename(tempPath, targetPath);
    tempPath = undefined;

    return (await io.readFile(targetPath)) === sourceContents ? targetPath : null;
  } catch {
    return null;
  } finally {
    if (tempPath) {
      try {
        await io.removeFile(tempPath);
      } catch {
        // Discovery must fail closed even if best-effort temp cleanup also fails.
      }
    }
  }
}

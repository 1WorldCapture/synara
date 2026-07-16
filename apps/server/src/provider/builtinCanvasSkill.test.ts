import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CANVAS_SKILL_NAME } from "@synara/shared/canvasAgentContract";

import {
  builtinCanvasSkillPath,
  materializeBuiltinCanvasSkill,
  resolveBuiltinCanvasSkillSourcePath,
  type BuiltinCanvasSkillIo,
} from "./builtinCanvasSkill";
import { readSkillDescriptor } from "./skillsCatalog";

const initialSkill = `---
name: canvas
description: Draw editable diagrams.
---

# Canvas
`;

const updatedSkill = `${initialSkill}\nUse read, begin, append, commit, and cancel.\n`;

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

const nodeIo: BuiltinCanvasSkillIo = {
  readFile: (filePath) => readFile(filePath, "utf8"),
  makeDirectory: async (dirPath) => {
    await mkdir(dirPath, { recursive: true });
  },
  writeFile: (filePath, contents) => writeFile(filePath, contents, "utf8"),
  rename,
  removeFile: async (filePath) => {
    await rm(filePath, { force: true });
  },
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("built-in Canvas Skill", () => {
  it("materializes the canonical development asset byte-for-byte", async () => {
    const baseDir = await makeTempDir("synara-built-in-canvas-");
    const sourcePath = resolveBuiltinCanvasSkillSourcePath({ runtime: "bun" });

    const managedPath = await materializeBuiltinCanvasSkill({ baseDir, sourcePath });

    expect(managedPath).toBe(builtinCanvasSkillPath(baseDir));
    expect(await readFile(managedPath!, "utf8")).toBe(await readFile(sourcePath, "utf8"));
  });

  it("materializes the exact bundled content at the managed path and is idempotent", async () => {
    const baseDir = await makeTempDir("synara-built-in-canvas-");
    const sourceDir = await makeTempDir("synara-built-in-canvas-source-");
    const sourcePath = path.join(sourceDir, "SKILL.md");
    await writeFile(sourcePath, initialSkill, "utf8");

    const firstPath = await materializeBuiltinCanvasSkill({ baseDir, sourcePath });
    expect(firstPath).toBe(builtinCanvasSkillPath(baseDir));
    expect(await readFile(firstPath!, "utf8")).toBe(initialSkill);
    expect(await readFile(firstPath!, "utf8")).toContain("name: canvas");
    const firstStat = await stat(firstPath!);

    const secondPath = await materializeBuiltinCanvasSkill({ baseDir, sourcePath });
    const secondStat = await stat(secondPath!);
    expect(secondPath).toBe(firstPath);
    expect(secondStat.ino).toBe(firstStat.ino);
  });

  it("atomically replaces changed content without leaving temporary files", async () => {
    const baseDir = await makeTempDir("synara-built-in-canvas-");
    const sourceDir = await makeTempDir("synara-built-in-canvas-source-");
    const sourcePath = path.join(sourceDir, "SKILL.md");
    await writeFile(sourcePath, initialSkill, "utf8");
    await materializeBuiltinCanvasSkill({ baseDir, sourcePath });

    await writeFile(sourcePath, updatedSkill, "utf8");
    const managedPath = await materializeBuiltinCanvasSkill({ baseDir, sourcePath });

    expect(await readFile(managedPath!, "utf8")).toBe(updatedSkill);
    expect(await readdir(path.dirname(managedPath!))).toEqual(["SKILL.md"]);
  });

  it("fails closed and preserves the last complete file on source read or temp write failure", async () => {
    const baseDir = await makeTempDir("synara-built-in-canvas-");
    const sourceDir = await makeTempDir("synara-built-in-canvas-source-");
    const sourcePath = path.join(sourceDir, "SKILL.md");
    await writeFile(sourcePath, initialSkill, "utf8");
    const managedPath = await materializeBuiltinCanvasSkill({ baseDir, sourcePath });

    expect(
      await materializeBuiltinCanvasSkill({
        baseDir,
        sourcePath: path.join(sourceDir, "missing.md"),
      }),
    ).toBeNull();
    expect(await readFile(managedPath!, "utf8")).toBe(initialSkill);

    await writeFile(sourcePath, updatedSkill, "utf8");
    const failingIo: BuiltinCanvasSkillIo = {
      ...nodeIo,
      writeFile: async () => {
        throw new Error("simulated write failure");
      },
    };
    expect(await materializeBuiltinCanvasSkill({ baseDir, sourcePath, io: failingIo })).toBeNull();
    expect(await readFile(managedPath!, "utf8")).toBe(initialSkill);
    expect(await readdir(path.dirname(managedPath!))).toEqual(["SKILL.md"]);

    const unreadableTargetIo: BuiltinCanvasSkillIo = {
      ...nodeIo,
      readFile: (filePath) => {
        if (filePath === managedPath) throw new Error("simulated target read failure");
        return nodeIo.readFile(filePath);
      },
    };
    expect(
      await materializeBuiltinCanvasSkill({ baseDir, sourcePath, io: unreadableTargetIo }),
    ).toBeNull();
    expect(await readFile(managedPath!, "utf8")).toBe(initialSkill);
  });

  it("resolves the packaged Node asset independently of the working directory", async () => {
    const serverDist = await makeTempDir("synara-server-dist-");
    const expected = path.join(serverDist, "excalidraw-mcp/skills/canvas/SKILL.md");
    expect(
      resolveBuiltinCanvasSkillSourcePath({ runtime: "node", moduleDir: serverDist }),
    ).toBe(expected);
  });

  it("materializes and discovers the Skill from an isolated packaged server layout", async () => {
    const serverDist = await makeTempDir("synara-packaged-server-dist-");
    const packagedSource = path.join(
      serverDist,
      "excalidraw-mcp/skills/canvas/SKILL.md",
    );
    await mkdir(path.dirname(packagedSource), { recursive: true });
    await copyFile(resolveBuiltinCanvasSkillSourcePath({ runtime: "bun" }), packagedSource);

    const isolatedBaseDir = await makeTempDir("synara-packaged-home-");
    const resolvedSource = resolveBuiltinCanvasSkillSourcePath({
      runtime: "node",
      moduleDir: serverDist,
    });
    const managedPath = await materializeBuiltinCanvasSkill({
      baseDir: isolatedBaseDir,
      sourcePath: resolvedSource,
    });

    expect(managedPath).toBe(builtinCanvasSkillPath(isolatedBaseDir));
    const descriptor = await readSkillDescriptor({
      skillPath: managedPath!,
      scope: "synara-builtin",
    });
    expect(descriptor).toMatchObject({
      name: CANVAS_SKILL_NAME,
      path: managedPath,
      scope: "synara-builtin",
    });
    expect(await readFile(managedPath!, "utf8")).toBe(await readFile(packagedSource, "utf8"));
  });
});

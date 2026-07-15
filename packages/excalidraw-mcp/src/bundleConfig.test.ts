// FILE: bundleConfig.test.ts
// Purpose: Keeps the packaged Canvas MCP entry self-contained outside the monorepo.
// Layer: Excalidraw MCP build regression test

import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { isBuiltin } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { build } from "tsdown";

import config, { shouldBundleCanvasMcpDependency } from "../tsdown.config";

describe("Canvas MCP bundle config", () => {
  it("bundles runtime packages while leaving Node built-ins external", () => {
    expect(
      shouldBundleCanvasMcpDependency("@modelcontextprotocol/sdk/server/stdio.js"),
    ).toBe(true);
    expect(shouldBundleCanvasMcpDependency("@synara/shared/excalidrawScene")).toBe(true);
    expect(shouldBundleCanvasMcpDependency("zod")).toBe(true);

    for (const builtin of ["node:crypto", "node:fs", "path"]) {
      expect(isBuiltin(builtin)).toBe(true);
      expect(shouldBundleCanvasMcpDependency(builtin)).toBe(false);
    }
  });

  it("builds every public runtime entry through the shared standalone config", () => {
    expect(config).toMatchObject({
      entry: ["src/main.ts", "src/server.ts", "src/bridge.ts"],
      format: "esm",
      outDir: "dist",
      clean: true,
      inlineOnly: false,
      noExternal: shouldBundleCanvasMcpDependency,
    });
  });

  it("emits entries that load without monorepo dependencies", async () => {
    const packageRoot = path.resolve(import.meta.dirname, "..");
    const outDir = await mkdtemp(path.join(tmpdir(), "synara-canvas-mcp-bundle-"));
    const unrelatedCwd = await mkdtemp(path.join(tmpdir(), "synara-canvas-mcp-cwd-"));

    try {
      await build({
        cwd: packageRoot,
        config: path.join(packageRoot, "tsdown.config.ts"),
        outDir,
        dts: false,
        clean: true,
        logLevel: "silent",
      });

      const publicEntries = ["main.mjs", "server.mjs", "bridge.mjs"];
      expect(await readdir(outDir)).toEqual(expect.arrayContaining(publicEntries));

      for (const entry of publicEntries) {
        const launch = spawnSync("node", [path.join(outDir, entry)], {
          cwd: unrelatedCwd,
          encoding: "utf8",
          env: {
            ...process.env,
            SYNARA_CANVAS_BRIDGE_URL: "http://127.0.0.1:9",
            SYNARA_CANVAS_BRIDGE_TOKEN: "bundle-smoke-token",
            SYNARA_CANVAS_THREAD_ID: "bundle-smoke-thread",
          },
          input: "",
          timeout: 5_000,
        });
        expect(launch.error).toBeUndefined();
        expect(launch.status, `${entry}: ${launch.stderr}`).toBe(0);
      }
    } finally {
      await Promise.all([
        rm(outDir, { recursive: true, force: true }),
        rm(unrelatedCwd, { recursive: true, force: true }),
      ]);
    }
  }, 30_000);
});

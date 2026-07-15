// FILE: tsdown.config.ts
// Purpose: Produces self-contained Canvas MCP entries for packaged desktop apps.
// Layer: Excalidraw MCP build config
// Depends on: Node built-in detection and tsdown.

import { isBuiltin } from "node:module";

import { defineConfig } from "tsdown";

export function shouldBundleCanvasMcpDependency(id: string): boolean {
  return !isBuiltin(id);
}

export default defineConfig({
  entry: ["src/main.ts", "src/server.ts", "src/bridge.ts"],
  format: "esm",
  outDir: "dist",
  clean: true,
  noExternal: shouldBundleCanvasMcpDependency,
  inlineOnly: false,
});

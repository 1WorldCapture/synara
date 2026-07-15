// FILE: canvasProvider.ts
// Purpose: Declares which provider runtimes can safely receive a thread-scoped Canvas tool bridge.
// Layer: Shared provider capability policy

import type { ProviderKind } from "@synara/contracts";

const CANVAS_PROVIDER_SUPPORT: Record<ProviderKind, boolean> = {
  codex: true,
  claudeAgent: true,
  cursor: true,
  antigravity: false,
  grok: true,
  droid: true,
  kilo: false,
  opencode: false,
  pi: false,
};

export function isCanvasProviderSupported(provider: ProviderKind): boolean {
  return CANVAS_PROVIDER_SUPPORT[provider];
}

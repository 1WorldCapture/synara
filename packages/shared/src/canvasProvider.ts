// FILE: canvasProvider.ts
// Purpose: Declares which provider runtimes can safely receive a thread-scoped Canvas tool bridge.
// Layer: Shared provider capability policy

import type { ProviderKind } from "@synara/contracts";

export const CANVAS_FALLBACK_PROVIDER = "codex" as const satisfies ProviderKind;

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

export const CANVAS_UNSUPPORTED_PROVIDERS = (Object.keys(CANVAS_PROVIDER_SUPPORT) as ProviderKind[])
  .filter((provider) => !CANVAS_PROVIDER_SUPPORT[provider]);

export function isCanvasProviderSupported(provider: ProviderKind): boolean {
  return CANVAS_PROVIDER_SUPPORT[provider];
}

export function hideUnsupportedCanvasProviders(
  hiddenProviders: ReadonlyArray<ProviderKind>,
): ReadonlyArray<ProviderKind> {
  return Array.from(new Set([...hiddenProviders, ...CANVAS_UNSUPPORTED_PROVIDERS]));
}

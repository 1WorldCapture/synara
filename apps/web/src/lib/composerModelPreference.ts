// FILE: composerModelPreference.ts
// Purpose: Resolves the provider/model precedence shared by fresh Chat and Canvas threads.
// Layer: Web model-selection logic

import type { ModelSelection, ProviderKind } from "@synara/contracts";
import { getDefaultModel } from "@synara/shared/model";

export const COMPOSER_PROVIDER_KINDS = [
  "codex",
  "claudeAgent",
  "cursor",
  "gemini",
  "grok",
  "droid",
  "kilo",
  "opencode",
  "pi",
] as const satisfies readonly ProviderKind[];

export interface ComposerModelPreferenceInput {
  readonly draft:
    | {
        readonly modelSelectionByProvider: Partial<Record<ProviderKind, ModelSelection>>;
        readonly activeProvider: ProviderKind | null;
      }
    | null
    | undefined;
  readonly threadModelSelection: ModelSelection | null | undefined;
  readonly projectModelSelection: ModelSelection | null | undefined;
  readonly defaultProvider?: ProviderKind | null | undefined;
}

export function resolvePreferredComposerModelPreference(input: ComposerModelPreferenceInput): {
  readonly provider: ProviderKind;
  readonly explicitModelSelection: ModelSelection | null;
} {
  const draftProviderWithSelection =
    COMPOSER_PROVIDER_KINDS.find(
      (provider) => input.draft?.modelSelectionByProvider?.[provider] !== undefined,
    ) ?? null;
  const provider =
    input.draft?.activeProvider ??
    draftProviderWithSelection ??
    input.threadModelSelection?.provider ??
    input.projectModelSelection?.provider ??
    input.defaultProvider ??
    "codex";
  const explicitModelSelection =
    input.draft?.modelSelectionByProvider?.[provider] ??
    (input.threadModelSelection?.provider === provider ? input.threadModelSelection : null) ??
    (input.projectModelSelection?.provider === provider ? input.projectModelSelection : null);

  return { provider, explicitModelSelection };
}

export function resolvePreferredComposerModelSelection(
  input: ComposerModelPreferenceInput & {
    readonly runtimeDefaultModelByProvider?: Partial<Record<ProviderKind, string | null>>;
  },
): ModelSelection {
  const preference = resolvePreferredComposerModelPreference(input);
  if (preference.explicitModelSelection) {
    return preference.explicitModelSelection;
  }

  const runtimeDefaultModel = input.runtimeDefaultModelByProvider?.[preference.provider]?.trim();
  if (runtimeDefaultModel) {
    return { provider: preference.provider, model: runtimeDefaultModel };
  }

  // Pi intentionally has no static model. Until runtime discovery supplies one,
  // keep the existing durable-thread fallback used by ordinary Chat promotion.
  const fallbackProvider = preference.provider === "pi" ? "codex" : preference.provider;
  return {
    provider: fallbackProvider,
    model: getDefaultModel(fallbackProvider),
  };
}

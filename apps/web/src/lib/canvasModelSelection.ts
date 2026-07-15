// FILE: canvasModelSelection.ts
// Purpose: Resolves a durable Canvas thread's initial provider/model using fresh-Chat precedence.
// Layer: Web model-selection logic

import type { ModelSelection, ProviderKind, ProviderModelDescriptor } from "@synara/contracts";
import {
  CANVAS_FALLBACK_PROVIDER,
  isCanvasProviderSupported,
} from "@synara/shared/canvasProvider";
import { resolveSelectableModel } from "@synara/shared/model";

import {
  resolvePreferredComposerModelPreference,
  resolvePreferredComposerModelSelection,
} from "./composerModelPreference";

const DEFAULT_MODEL_DISCOVERY_TIMEOUT_MS = 4_000;

export interface CanvasModelResolution {
  readonly modelSelection: ModelSelection;
  readonly fallbackFromProvider: ProviderKind | null;
}

function discoverModelsWithTimeout(
  listModels: () => Promise<ReadonlyArray<ProviderModelDescriptor>>,
  timeoutMs: number,
): Promise<ReadonlyArray<ProviderModelDescriptor>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Canvas model discovery timed out.")),
      timeoutMs,
    );
    listModels().then(
      (models) => {
        clearTimeout(timeout);
        resolve(models);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

export async function resolveCanvasModelSelection(input: {
  readonly stickyActiveProvider: ProviderKind | null;
  readonly stickyModelSelectionByProvider: Partial<Record<ProviderKind, ModelSelection>>;
  readonly projectModelSelection: ModelSelection | null | undefined;
  readonly defaultProvider: ProviderKind;
  readonly listModels: (
    provider: ProviderKind,
  ) => Promise<ReadonlyArray<ProviderModelDescriptor>>;
  readonly modelDiscoveryTimeoutMs?: number;
}): Promise<CanvasModelResolution> {
  const preferenceInput = {
    draft: {
      activeProvider: input.stickyActiveProvider,
      modelSelectionByProvider: input.stickyModelSelectionByProvider,
    },
    threadModelSelection: null,
    projectModelSelection: input.projectModelSelection,
    defaultProvider: input.defaultProvider,
  } as const;
  const requestedPreference = resolvePreferredComposerModelPreference(preferenceInput);
  const fallbackFromProvider = isCanvasProviderSupported(requestedPreference.provider)
    ? null
    : requestedPreference.provider;
  const preference = fallbackFromProvider
    ? { provider: CANVAS_FALLBACK_PROVIDER, explicitModelSelection: null }
    : requestedPreference;

  let availableModels: ReadonlyArray<ProviderModelDescriptor> = [];
  try {
    availableModels = await discoverModelsWithTimeout(
      () => input.listModels(preference.provider),
      input.modelDiscoveryTimeoutMs ?? DEFAULT_MODEL_DISCOVERY_TIMEOUT_MS,
    );
  } catch {
    // Runtime discovery is best-effort. Match Chat's static/offline fallback
    // rather than making Canvas creation depend on a healthy provider CLI.
  }

  if (availableModels.length > 0) {
    const resolvedExplicitModel = resolveSelectableModel(
      preference.provider,
      preference.explicitModelSelection?.model,
      availableModels,
    );
    if (preference.explicitModelSelection && resolvedExplicitModel) {
      return {
        modelSelection: {
          ...preference.explicitModelSelection,
          model: resolvedExplicitModel,
        },
        fallbackFromProvider,
      };
    }
    return {
      modelSelection: {
        provider: preference.provider,
        model: availableModels[0]!.slug,
      },
      fallbackFromProvider,
    };
  }

  return {
    modelSelection: fallbackFromProvider
      ? resolvePreferredComposerModelSelection({
          ...preferenceInput,
          draft: null,
          projectModelSelection: null,
          defaultProvider: CANVAS_FALLBACK_PROVIDER,
        })
      : resolvePreferredComposerModelSelection(preferenceInput),
    fallbackFromProvider,
  };
}

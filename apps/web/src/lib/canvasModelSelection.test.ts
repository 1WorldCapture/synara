// FILE: canvasModelSelection.test.ts
// Purpose: Verifies Canvas creation follows the same provider/model precedence as a fresh Chat.
// Layer: Web model-selection unit tests

import type { ProviderModelDescriptor } from "@synara/contracts";
import { hideUnsupportedCanvasProviders } from "@synara/shared/canvasProvider";
import { describe, expect, it, vi } from "vitest";

import { resolveCanvasModelSelection } from "./canvasModelSelection";

const runtimeModel = (slug: string): ProviderModelDescriptor => ({ slug, name: slug });

describe("resolveCanvasModelSelection", () => {
  it("hides providers that cannot host isolated Canvas tools", () => {
    expect(hideUnsupportedCanvasProviders(["gemini"])).toEqual([
      "gemini",
      "kilo",
      "opencode",
      "pi",
    ]);
  });

  it("uses the sticky Chat provider and its explicit model selection", async () => {
    const listModels = vi.fn(async () => [runtimeModel("claude-opus-4-8")]);

    await expect(
      resolveCanvasModelSelection({
        stickyActiveProvider: "claudeAgent",
        stickyModelSelectionByProvider: {
          claudeAgent: {
            provider: "claudeAgent",
            model: "claude-opus-4-8",
            options: { effort: "max" },
          },
        },
        projectModelSelection: { provider: "codex", model: "gpt-5.4" },
        defaultProvider: "grok",
        listModels,
      }),
    ).resolves.toEqual({
      modelSelection: {
        provider: "claudeAgent",
        model: "claude-opus-4-8",
        options: { effort: "max" },
      },
      fallbackFromProvider: null,
    });
    expect(listModels).toHaveBeenCalledWith("claudeAgent");
  });

  it("uses the runtime default model for the configured Chat provider", async () => {
    const listModels = vi.fn(async () => [
      runtimeModel("grok-4.5"),
      runtimeModel("grok-composer-2.5-fast"),
    ]);

    await expect(
      resolveCanvasModelSelection({
        stickyActiveProvider: null,
        stickyModelSelectionByProvider: {},
        projectModelSelection: null,
        defaultProvider: "grok",
        listModels,
      }),
    ).resolves.toEqual({
      modelSelection: { provider: "grok", model: "grok-4.5" },
      fallbackFromProvider: null,
    });
    expect(listModels).toHaveBeenCalledWith("grok");
  });

  it("does not force Grok when Chat defaults to another provider", async () => {
    const listModels = vi.fn(async () => [runtimeModel("gpt-5.6-sol")]);

    await expect(
      resolveCanvasModelSelection({
        stickyActiveProvider: null,
        stickyModelSelectionByProvider: {},
        projectModelSelection: null,
        defaultProvider: "codex",
        listModels,
      }),
    ).resolves.toEqual({
      modelSelection: { provider: "codex", model: "gpt-5.6-sol" },
      fallbackFromProvider: null,
    });
    expect(listModels).toHaveBeenCalledWith("codex");
  });

  it("keeps an explicit project model when the provider still offers it", async () => {
    const listModels = vi.fn(async () => [
      runtimeModel("cursor-auto"),
      runtimeModel("cursor-fast"),
    ]);

    await expect(
      resolveCanvasModelSelection({
        stickyActiveProvider: null,
        stickyModelSelectionByProvider: {},
        projectModelSelection: { provider: "cursor", model: "cursor-auto" },
        defaultProvider: "codex",
        listModels,
      }),
    ).resolves.toEqual({
      modelSelection: { provider: "cursor", model: "cursor-auto" },
      fallbackFromProvider: null,
    });
    expect(listModels).toHaveBeenCalledWith("cursor");
  });

  it("replaces a stale project model with the provider runtime default", async () => {
    await expect(
      resolveCanvasModelSelection({
        stickyActiveProvider: null,
        stickyModelSelectionByProvider: {},
        projectModelSelection: { provider: "grok", model: "grok-build" },
        defaultProvider: "codex",
        listModels: async () => [
          runtimeModel("grok-4.5"),
          runtimeModel("grok-composer-2.5-fast"),
        ],
      }),
    ).resolves.toEqual({
      modelSelection: { provider: "grok", model: "grok-4.5" },
      fallbackFromProvider: null,
    });
  });

  it("falls back to the static provider default when discovery fails", async () => {
    await expect(
      resolveCanvasModelSelection({
        stickyActiveProvider: null,
        stickyModelSelectionByProvider: {},
        projectModelSelection: null,
        defaultProvider: "grok",
        listModels: async () => {
          throw new Error("CLI unavailable");
        },
      }),
    ).resolves.toEqual({
      modelSelection: { provider: "grok", model: "grok-build" },
      fallbackFromProvider: null,
    });
  });

  it.each(["pi", "opencode", "kilo"] as const)(
    "falls back from %s because it cannot host an isolated Canvas tool session",
    async (provider) => {
      const listModels = vi.fn(async () => [runtimeModel("gpt-5.6-sol")]);

      await expect(
        resolveCanvasModelSelection({
          stickyActiveProvider: null,
          stickyModelSelectionByProvider: {},
          projectModelSelection: null,
          defaultProvider: provider,
          listModels,
        }),
      ).resolves.toEqual({
        modelSelection: { provider: "codex", model: "gpt-5.6-sol" },
        fallbackFromProvider: provider,
      });
      expect(listModels).toHaveBeenCalledWith("codex");
    },
  );

  it("uses the static fallback when runtime model discovery does not settle", async () => {
    await expect(
      resolveCanvasModelSelection({
        stickyActiveProvider: null,
        stickyModelSelectionByProvider: {},
        projectModelSelection: null,
        defaultProvider: "grok",
        listModels: () => new Promise(() => undefined),
        modelDiscoveryTimeoutMs: 1,
      }),
    ).resolves.toEqual({
      modelSelection: { provider: "grok", model: "grok-build" },
      fallbackFromProvider: null,
    });
  });
});

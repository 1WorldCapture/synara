// FILE: ProviderCommandReactor.skillMentions.test.ts
// Purpose: Covers provider-specific prompt text normalization for selected skills.
// Layer: Server orchestration tests
// Exports: Vitest cases for ProviderCommandReactor helpers.

import { describe, expect, it } from "vitest";

import {
  canonicalizeCanvasSkillReferences,
  normalizeSkillMentionTextForProvider,
} from "./ProviderCommandReactor.ts";

describe("normalizeSkillMentionTextForProvider", () => {
  it("translates slash-selected skills to Codex dollar mentions before provider dispatch", () => {
    expect(
      normalizeSkillMentionTextForProvider({
        provider: "codex",
        messageText: "Use /check-code and /recap please",
        skills: [
          { name: "check-code", path: "/skills/check-code/SKILL.md" },
          { name: "recap", path: "/skills/recap/SKILL.md" },
        ],
      }),
    ).toBe("Use $check-code and $recap please");
  });

  it("leaves non-Codex slash skills untouched", () => {
    expect(
      normalizeSkillMentionTextForProvider({
        provider: "cursor",
        messageText: "Use /check-code please",
        skills: [{ name: "check-code", path: "/skills/check-code/SKILL.md" }],
      }),
    ).toBe("Use /check-code please");
  });
});

describe("canonicalizeCanvasSkillReferences", () => {
  it("rewrites and deduplicates Canvas while preserving unrelated skill order", async () => {
    const managedPath = "/custom/base/builtin-skills/canvas/SKILL.md";
    await expect(
      canonicalizeCanvasSkillReferences({
        provider: "cursor",
        skills: [
          { name: "reviewer", path: "/skills/reviewer/SKILL.md" },
          { name: "Canvas", path: "/stale/canvas/SKILL.md" },
          { name: "canvas", path: "/provider-native/canvas/SKILL.md" },
          { name: "writer", path: "/skills/writer/SKILL.md" },
        ],
        disabledSkillNames: [],
        baseDir: "/custom/base",
        materialize: async () => managedPath,
      }),
    ).resolves.toEqual({
      skills: [
        { name: "reviewer", path: "/skills/reviewer/SKILL.md" },
        { name: "canvas", path: managedPath },
        { name: "writer", path: "/skills/writer/SKILL.md" },
      ],
      managedCanvasPath: managedPath,
    });
  });

  it("fails explicitly when Canvas is disabled or cannot be materialized", async () => {
    await expect(
      canonicalizeCanvasSkillReferences({
        provider: "codex",
        skills: [{ name: "canvas", path: "/stale/canvas/SKILL.md" }],
        disabledSkillNames: ["Canvas"],
        baseDir: "/custom/base",
      }),
    ).rejects.toThrow("disabled");

    await expect(
      canonicalizeCanvasSkillReferences({
        provider: "gemini",
        skills: [{ name: "canvas", path: "/stale/canvas/SKILL.md" }],
        disabledSkillNames: [],
        baseDir: "/custom/base",
        materialize: async () => null,
      }),
    ).rejects.toThrow("unavailable");
  });

  it("leaves an unsupported provider's ordinary Canvas reference untouched", async () => {
    const userCanvas = { name: "canvas", path: "/user/opencode/canvas/SKILL.md" };
    await expect(
      canonicalizeCanvasSkillReferences({
        provider: "opencode",
        skills: [userCanvas],
        disabledSkillNames: [],
        baseDir: "/custom/base",
      }),
    ).resolves.toEqual({ skills: [userCanvas] });
  });
});

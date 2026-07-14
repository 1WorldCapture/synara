import { describe, expect, it } from "vitest";

import {
  buildCanvasThreadPlaceholderTitle,
  buildPromptThreadTitleFallback,
  GENERIC_CHAT_THREAD_TITLE,
  isGenericCanvasThreadTitle,
  isGenericChatThreadTitle,
  sanitizeGeneratedThreadTitle,
} from "./chatThreads";

describe("chatThreads", () => {
  it("builds a short fallback title without forcing case", () => {
    expect(buildPromptThreadTitleFallback("FIX the BROKEN auth redirect in production now")).toBe(
      "FIX the BROKEN auth redirect in",
    );
  });

  it("falls back to the generic thread title when there is no usable text", () => {
    expect(buildPromptThreadTitleFallback("   \n\t  ")).toBe(GENERIC_CHAT_THREAD_TITLE);
  });

  it("sanitizes generated titles without lowercasing acronyms", () => {
    expect(sanitizeGeneratedThreadTitle('"Folder picker UI ASAP."')).toBe("Folder picker UI ASAP");
  });

  it("keeps distinguishing identifiers within the six-word cap", () => {
    expect(sanitizeGeneratedThreadTitle("PR #1234 Conflict Review and more extra")).toBe(
      "PR #1234 Conflict Review and more",
    );
  });

  it("detects the generic chat placeholder title", () => {
    expect(isGenericChatThreadTitle(" New thread ")).toBe(true);
    expect(isGenericChatThreadTitle("Manual rename")).toBe(false);
  });

  it("detects only unedited canvas placeholder titles", () => {
    expect(isGenericCanvasThreadTitle(" Untitled drawing ")).toBe(true);
    expect(isGenericCanvasThreadTitle("Untitled drawing 2")).toBe(true);
    expect(isGenericCanvasThreadTitle("Untitled drawing ideas")).toBe(false);
    expect(isGenericCanvasThreadTitle("J2EE onion architecture")).toBe(false);
  });

  it("builds canvas placeholder titles from the existing drawing count", () => {
    expect(buildCanvasThreadPlaceholderTitle(0)).toBe("Untitled drawing");
    expect(buildCanvasThreadPlaceholderTitle(1)).toBe("Untitled drawing 2");
  });
});

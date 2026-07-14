// FILE: chatThreads.ts
// Purpose: Shared chat-thread title helpers used by web and server flows.
// Layer: Shared util
// Exports: generic title checks plus fallback/generated title sanitizers

export const GENERIC_CHAT_THREAD_TITLE = "New thread";
export const GENERIC_CANVAS_THREAD_TITLE = "Untitled drawing";
const MAX_CHAT_THREAD_TITLE_LENGTH = 60;
// Single source for the title word cap. Exported so the server-side title prompt
// (textGenerationShared.buildThreadTitlePrompt) derives its wording and fallback
// limits from the same number the sanitizers enforce here.
export const MAX_CHAT_THREAD_TITLE_WORDS = 6;

function normalizeTitleWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function trimTitleToken(token: string): string {
  return token.replace(/^[\s"'`([{]+|[\s"'`)\]}:;,.!?]+$/g, "");
}

function titleWords(value: string): string[] {
  return normalizeTitleWhitespace(value)
    .split(" ")
    .map(trimTitleToken)
    .filter((token) => token.length > 0);
}

export function truncateChatThreadTitle(
  text: string,
  maxLength = MAX_CHAT_THREAD_TITLE_LENGTH,
): string {
  const trimmed = normalizeTitleWhitespace(text);
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength)}...`;
}

// Build a short deterministic title while the model-generated rename is pending.
export function buildPromptThreadTitleFallback(message: string): string {
  const words = titleWords(message).slice(0, MAX_CHAT_THREAD_TITLE_WORDS);
  if (words.length === 0) {
    return GENERIC_CHAT_THREAD_TITLE;
  }
  return truncateChatThreadTitle(words.join(" "));
}

// Keep generated titles compact so the sidebar never renders sentence-length prompts.
export function sanitizeGeneratedThreadTitle(raw: string): string {
  const unquoted = normalizeTitleWhitespace(raw).replace(/^['"`]+|['"`]+$/g, "");
  const words = titleWords(unquoted).slice(0, MAX_CHAT_THREAD_TITLE_WORDS);
  if (words.length === 0) {
    return GENERIC_CHAT_THREAD_TITLE;
  }
  return truncateChatThreadTitle(words.join(" "));
}

export function isGenericChatThreadTitle(title: string | null | undefined): boolean {
  return normalizeTitleWhitespace(title ?? "") === GENERIC_CHAT_THREAD_TITLE;
}

export function buildCanvasThreadPlaceholderTitle(existingDrawingCount: number): string {
  return existingDrawingCount === 0
    ? GENERIC_CANVAS_THREAD_TITLE
    : `${GENERIC_CANVAS_THREAD_TITLE} ${existingDrawingCount + 1}`;
}

export function isGenericCanvasThreadTitle(title: string | null | undefined): boolean {
  const normalized = normalizeTitleWhitespace(title ?? "");
  const numberedPrefix = `${GENERIC_CANVAS_THREAD_TITLE} `;
  return (
    normalized === GENERIC_CANVAS_THREAD_TITLE ||
    (normalized.startsWith(numberedPrefix) &&
      /^[1-9]\d*$/.test(normalized.slice(numberedPrefix.length)))
  );
}

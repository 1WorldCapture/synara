// FILE: composerMentions.ts
// Purpose: Share parsing/formatting helpers for `@...` composer mentions, including quoted paths.
// Layer: Web composer helper
// Exports: mention token formatters plus regex helpers used by composer parsing and prompt sync.

import type {
  ProviderKind,
  ProviderMentionReference,
  ProviderSkillDescriptor,
  ProviderSkillReference,
} from "@synara/contracts";
import {
  CANVAS_SKILL_NAME,
  SYNARA_BUILTIN_SKILL_SCOPE,
} from "@synara/shared/canvasAgentContract";
import { isCanvasProviderSupported } from "@synara/shared/canvasProvider";

export function skillMentionPrefix(provider: string): string {
  return provider === "pi" ? "/skill:" : "/";
}

// The alternation must be unambiguous — a backslash may only match the escape
// branch — or unclosed `@"` + a backslash run backtracks exponentially on the
// per-keystroke composer parse (ReDoS).
const QUOTED_MENTION_PATH_SOURCE = String.raw`((?:\\.|[^"\\])*)`;

export function createComposerMentionTokenRegex(options: {
  includeTrailingTokenAtEnd: boolean;
  global?: boolean;
}): RegExp {
  const suffix = options.includeTrailingTokenAtEnd ? "(?=\\s|$)" : "(?=\\s)";
  return new RegExp(
    `(^|\\s)@(?:"${QUOTED_MENTION_PATH_SOURCE}"|([^\\s@]+))${suffix}`,
    options.global === false ? "" : "g",
  );
}

export function decodeComposerMentionQuotedPath(path: string): string {
  return path.replace(/\\(["\\])/g, "$1");
}

export function extractComposerMentionPath(match: RegExpExecArray | RegExpMatchArray): string {
  return match[2] === undefined ? (match[3] ?? "") : decodeComposerMentionQuotedPath(match[2]);
}

export function composerMentionQuotedPathHasClosingQuote(path: string): boolean {
  let precedingBackslashes = 0;
  for (const character of path) {
    if (character === "\\") {
      precedingBackslashes += 1;
      continue;
    }
    if (character === '"' && precedingBackslashes % 2 === 0) {
      return true;
    }
    precedingBackslashes = 0;
  }
  return false;
}

function encodeComposerMentionQuotedPath(path: string): string {
  return path.replace(/["\\]/g, "\\$&");
}

/**
 * Paths that need quoting so spaces, parentheses, and shell-ish characters
 * stay a single mention token (#351). Prefer quoting over relying on the
 * unquoted `[^()\s@]+` trigger form.
 */
export function composerMentionPathNeedsQuoting(path: string): boolean {
  return /[\s()@"'`$\\]/.test(path);
}

export function formatComposerMentionToken(path: string): string {
  const normalizedPath = path.startsWith("@") ? path.slice(1) : path;
  return composerMentionPathNeedsQuoting(normalizedPath)
    ? `@"${encodeComposerMentionQuotedPath(normalizedPath)}"`
    : `@${normalizedPath}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function promptIncludesSkillMention(
  prompt: string,
  skillName: string,
  provider: string,
): boolean {
  const escapedSkillName = escapeRegExp(skillName);
  const prefixes =
    provider === "pi" ? [skillMentionPrefix(provider)] : [skillMentionPrefix(provider), "$"];
  return prefixes.some((prefix) => {
    const pattern = new RegExp(`(^|\\s)${escapeRegExp(prefix)}${escapedSkillName}(?=\\s|$)`, "i");
    return pattern.test(prompt);
  });
}

export function filterPromptSkillReferences(
  prompt: string,
  skills: ReadonlyArray<ProviderSkillReference>,
  provider: string,
): ProviderSkillReference[] {
  return skills.filter((skill) => promptIncludesSkillMention(prompt, skill.name, provider));
}

function normalizeMentionNameKey(name: string): string {
  return name.trim().toLowerCase();
}

export function collectPromptSkillMentionNames(prompt: string, provider: ProviderKind): string[] {
  const pattern =
    provider === "pi"
      ? /(^|\s)(?:\/skill:([a-z0-9][a-z0-9._-]*)|\/(canvas))(?=\s|$)/gi
      : /(^|\s)[/$]([a-z0-9][a-z0-9._-]*)(?=\s|$)/gi;
  const names: string[] = [];
  const seen = new Set<string>();
  for (const match of prompt.matchAll(pattern)) {
    const name = normalizeMentionNameKey(match[2] ?? match[3] ?? "");
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

export interface PromptSkillReferenceResolution {
  readonly skills: ProviderSkillReference[];
  readonly unavailableSkillNames: string[];
}

/**
 * Rebuilds per-turn Skill references from the visible prompt and the active
 * provider catalog. Existing picker order wins; manually typed tokens missing
 * from that selection are appended in prompt order. Canvas is fail-closed when
 * it denotes Synara's built-in capability, while unsupported providers may
 * still expose an ordinary user-owned skill named canvas.
 */
export function resolvePromptSkillReferences(input: {
  readonly prompt: string;
  readonly provider: ProviderKind;
  readonly selectedSkills: ReadonlyArray<ProviderSkillReference>;
  readonly catalogSkills: ReadonlyArray<ProviderSkillDescriptor>;
}): PromptSkillReferenceResolution {
  const promptNames = collectPromptSkillMentionNames(input.prompt, input.provider);
  const promptNameSet = new Set(promptNames);
  const catalogByName = new Map<string, ProviderSkillDescriptor>();
  for (const skill of input.catalogSkills) {
    if (!skill.enabled) continue;
    const key = normalizeMentionNameKey(skill.name);
    if (!catalogByName.has(key)) catalogByName.set(key, skill);
  }

  const skills: ProviderSkillReference[] = [];
  const includedNames = new Set<string>();
  const addResolved = (name: string, existing?: ProviderSkillReference): boolean => {
    if (includedNames.has(name)) return true;
    const catalogSkill = catalogByName.get(name);
    const isCanvas = name === CANVAS_SKILL_NAME;
    if (
      isCanvas &&
      isCanvasProviderSupported(input.provider) &&
      catalogSkill?.scope !== SYNARA_BUILTIN_SKILL_SCOPE
    ) {
      return false;
    }
    const resolved = catalogSkill ?? (isCanvas ? undefined : existing);
    if (!resolved) return false;
    skills.push({ name: resolved.name, path: resolved.path });
    includedNames.add(name);
    return true;
  };

  const unavailableSkillNames: string[] = [];
  for (const selected of input.selectedSkills) {
    const name = normalizeMentionNameKey(selected.name);
    if (!promptNameSet.has(name)) continue;
    if (!addResolved(name, selected) && name === CANVAS_SKILL_NAME) {
      unavailableSkillNames.push(CANVAS_SKILL_NAME);
    }
  }
  for (const name of promptNames) {
    if (includedNames.has(name)) continue;
    if (!addResolved(name) && name === CANVAS_SKILL_NAME) {
      unavailableSkillNames.push(CANVAS_SKILL_NAME);
    }
  }

  return {
    skills,
    unavailableSkillNames: [...new Set(unavailableSkillNames)],
  };
}

export function providerSkillReferencesEqual(
  left: ReadonlyArray<ProviderSkillReference>,
  right: ReadonlyArray<ProviderSkillReference>,
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (skill, index) => skill.name === right[index]?.name && skill.path === right[index]?.path,
    )
  );
}

function collectProviderMentionTokenKeys(mention: ProviderMentionReference): Set<string> {
  const keys = new Set<string>();
  const normalizedName = normalizeMentionNameKey(mention.name);
  if (normalizedName.length > 0) {
    keys.add(normalizedName);
  }

  const normalizedPath = normalizeMentionNameKey(mention.path);
  if (normalizedPath.length > 0) {
    keys.add(normalizedPath);
  }

  if (normalizedPath.startsWith("plugin://")) {
    const pluginSpecifier = normalizedPath.slice("plugin://".length);
    if (pluginSpecifier.length > 0) {
      keys.add(pluginSpecifier);
      const pluginName = pluginSpecifier.split("@")[0] ?? "";
      if (pluginName.length > 0) {
        keys.add(pluginName);
      }
    }
  }

  return keys;
}

export function providerMentionMatchesToken(
  mention: ProviderMentionReference,
  token: string,
): boolean {
  const normalizedToken = normalizeMentionNameKey(token);
  return (
    normalizedToken.length > 0 && collectProviderMentionTokenKeys(mention).has(normalizedToken)
  );
}

export type MentionChipKind = "path" | "plugin";

export function isPluginProviderMentionReference(mention: ProviderMentionReference): boolean {
  return mention.path.startsWith("plugin://");
}

export function resolveMentionChipKind(
  path: string,
  options?: {
    kind?: MentionChipKind;
    mentionReferences?: ReadonlyArray<ProviderMentionReference>;
  },
): MentionChipKind {
  if (options?.kind === "plugin" || path.startsWith("plugin://")) {
    return "plugin";
  }
  if (
    options?.mentionReferences?.some(
      (mention) =>
        isPluginProviderMentionReference(mention) && providerMentionMatchesToken(mention, path),
    )
  ) {
    return "plugin";
  }
  return "path";
}

const PROMPT_MENTION_NAME_REGEX = createComposerMentionTokenRegex({
  includeTrailingTokenAtEnd: true,
});

function collectPromptMentionNameKeys(prompt: string): Set<string> {
  const names = new Set<string>();
  for (const match of prompt.matchAll(PROMPT_MENTION_NAME_REGEX)) {
    const mentionName = extractComposerMentionPath(match);
    if (mentionName.length > 0) {
      names.add(normalizeMentionNameKey(mentionName));
    }
  }
  return names;
}

export function filterPromptProviderMentionReferences(
  prompt: string,
  mentions: ReadonlyArray<ProviderMentionReference>,
): ProviderMentionReference[] {
  const promptMentionNames = collectPromptMentionNameKeys(prompt);
  if (promptMentionNames.size === 0) {
    return [];
  }

  const seenPaths = new Set<string>();
  const matchedMentions: ProviderMentionReference[] = [];
  for (const mention of mentions) {
    const mentionKeys = collectProviderMentionTokenKeys(mention);
    if (!Array.from(mentionKeys).some((key) => promptMentionNames.has(key))) {
      continue;
    }
    if (seenPaths.has(mention.path)) {
      continue;
    }
    seenPaths.add(mention.path);
    matchedMentions.push(mention);
  }
  return matchedMentions;
}

export function providerMentionReferencesEqual(
  left: ReadonlyArray<ProviderMentionReference>,
  right: ReadonlyArray<ProviderMentionReference>,
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (mention, index) =>
        mention.path === right[index]?.path && mention.name === right[index]?.name,
    )
  );
}

/**
 * 按会话模型 contextWindow 估算压缩触发 / 硬裁预算。
 * 对齐 Codex / Cursor：约 90% 窗触发；缺窗回落 catalog 默认 128k。
 * 规格：agent-context-compaction.md
 */
import { DEFAULT_CONTEXT_WINDOW } from "../../../../config/model-catalog.js";

/** 粗估：1 token ≈ 4 字符（与 Pi estimateTokens / Host compact-sdk 一致）。 */
export const CHARS_PER_TOKEN_ESTIMATE = 4;

/** Codex / Cursor 默认：近满窗再压。 */
export const COMPACT_TRIGGER_RATIO = 0.9;

/** 硬裁略高于触发，给语义压缩失败留回退空间。 */
export const COMPACT_HARD_TRUNCATE_RATIO = 0.95;

export function resolveContextWindowTokens(contextWindow?: number | null): number {
  if (typeof contextWindow === "number" && Number.isFinite(contextWindow) && contextWindow > 0) {
    return Math.floor(contextWindow);
  }
  return DEFAULT_CONTEXT_WINDOW;
}

export function estimateTokensFromChars(chars: number): number {
  return Math.ceil(Math.max(0, chars) / CHARS_PER_TOKEN_ESTIMATE);
}

export function charsFromTokens(tokens: number): number {
  return Math.floor(Math.max(0, tokens) * CHARS_PER_TOKEN_ESTIMATE);
}

export type CompactBudgets = {
  contextWindowTokens: number;
  /** 可喂视图达到该字符量 → 触发语义压缩 */
  triggerChars: number;
  /** transcriptToPrompt 硬裁上限 */
  hardTruncateChars: number;
};

/** 由会话模型窗推导两道闸（字符粗估）。 */
export function compactBudgetsFromContextWindow(
  contextWindow?: number | null,
): CompactBudgets {
  const contextWindowTokens = resolveContextWindowTokens(contextWindow);
  return {
    contextWindowTokens,
    triggerChars: charsFromTokens(Math.floor(contextWindowTokens * COMPACT_TRIGGER_RATIO)),
    hardTruncateChars: charsFromTokens(
      Math.floor(contextWindowTokens * COMPACT_HARD_TRUNCATE_RATIO),
    ),
  };
}

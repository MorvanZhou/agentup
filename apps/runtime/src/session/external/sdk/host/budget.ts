/**
 * 按会话模型 contextWindow + 输出预留估算压缩触发 / 硬裁预算。
 * 有效输入窗 = 总窗 − min(maxTokens, 窗×50%)；再 ×90% 触发 / ×95% 硬裁。
 * 缺窗回落 catalog 默认 128k；缺 maxTokens 回落 DEFAULT_MAX_TOKENS。
 * 规格：agent-context-compaction.md
 */
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
} from "../../../../config/model-catalog.js";

/** 粗估：1 token ≈ 4 字符（与 Pi estimateTokens / Host compact-sdk 一致）。 */
export const CHARS_PER_TOKEN_ESTIMATE = 4;

/** Codex / Cursor 默认：近满窗再压。 */
export const COMPACT_TRIGGER_RATIO = 0.9;

/** 硬裁略高于触发，给语义压缩失败留回退空间。 */
export const COMPACT_HARD_TRUNCATE_RATIO = 0.95;

/**
 * 输出预留占窗上限：避免 maxTokens 接近整窗时把有效输入吃光。
 * Copilot 常见 128k/400k≈32%，仍低于此帽。
 */
export const MAX_OUTPUT_RESERVE_RATIO = 0.5;

export function resolveContextWindowTokens(contextWindow?: number | null): number {
  if (typeof contextWindow === "number" && Number.isFinite(contextWindow) && contextWindow > 0) {
    return Math.floor(contextWindow);
  }
  return DEFAULT_CONTEXT_WINDOW;
}

/** 厂商「先留输出再卡输入」：从总窗扣掉的 token 数。 */
export function resolveOutputReserveTokens(
  contextWindowTokens: number,
  maxTokens?: number | null,
): number {
  const window = Math.max(1, Math.floor(contextWindowTokens));
  const raw =
    typeof maxTokens === "number" && Number.isFinite(maxTokens) && maxTokens > 0
      ? Math.floor(maxTokens)
      : DEFAULT_MAX_TOKENS;
  const cap = Math.floor(window * MAX_OUTPUT_RESERVE_RATIO);
  // 至少给输入留 1 token
  return Math.max(0, Math.min(raw, cap, window - 1));
}

/** 真正可用于 prompt / 历史的 token 预算（总窗 − 输出预留）。 */
export function resolveEffectivePromptWindowTokens(
  contextWindow?: number | null,
  maxTokens?: number | null,
): number {
  const window = resolveContextWindowTokens(contextWindow);
  return Math.max(1, window - resolveOutputReserveTokens(window, maxTokens));
}

export function estimateTokensFromChars(chars: number): number {
  return Math.ceil(Math.max(0, chars) / CHARS_PER_TOKEN_ESTIMATE);
}

export function charsFromTokens(tokens: number): number {
  return Math.floor(Math.max(0, tokens) * CHARS_PER_TOKEN_ESTIMATE);
}

export type CompactBudgets = {
  /** catalog / 模型广告总窗 */
  contextWindowTokens: number;
  /** 为回答预留、从总窗扣掉的量 */
  outputReserveTokens: number;
  /** 可用于历史+问题的有效窗 */
  effectiveWindowTokens: number;
  /** 可喂视图达到该字符量 → 触发语义压缩 */
  triggerChars: number;
  /** transcriptToPrompt 硬裁上限 */
  hardTruncateChars: number;
};

/**
 * 由会话模型窗 + 输出上限推导两道闸（字符粗估）。
 * 第二参为 maxTokens；缺省扣 DEFAULT_MAX_TOKENS。
 */
export function compactBudgetsFromContextWindow(
  contextWindow?: number | null,
  maxTokens?: number | null,
): CompactBudgets {
  const contextWindowTokens = resolveContextWindowTokens(contextWindow);
  const outputReserveTokens = resolveOutputReserveTokens(contextWindowTokens, maxTokens);
  const effectiveWindowTokens = Math.max(1, contextWindowTokens - outputReserveTokens);
  return {
    contextWindowTokens,
    outputReserveTokens,
    effectiveWindowTokens,
    triggerChars: charsFromTokens(Math.floor(effectiveWindowTokens * COMPACT_TRIGGER_RATIO)),
    hardTruncateChars: charsFromTokens(
      Math.floor(effectiveWindowTokens * COMPACT_HARD_TRUNCATE_RATIO),
    ),
  };
}

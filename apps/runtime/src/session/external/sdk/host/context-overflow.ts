/**
 * Host 上下文超限契约：只认稳定 code；文案识别属于各 adaptor。
 * adaptor 用 matchContextOverflowText(patterns) + stampContextOverflowIfMatched。
 */
import type { WorkerResult } from "../contract.js";

/** 稳定失败码：adaptor normalize 优先写入。 */
export const CONTEXT_OVERFLOW_CODE = "context_overflow";

/**
 * 厂商超限报错通常是一两句短文（Copilot 约 170 字）。
 * 超过此长度的「错误正文」更像对话/日志 dump，adaptor 文案匹配应先过此闸。
 */
export const CONTEXT_OVERFLOW_MESSAGE_MAX_CHARS = 800;

/** 是否短到值得做 overflow 文案匹配（稳定 code 不经此闸）。 */
export function isShortOverflowCandidate(text: string): boolean {
  const raw = (text ?? "").trim();
  return raw.length > 0 && raw.length <= CONTEXT_OVERFLOW_MESSAGE_MAX_CHARS;
}

/**
 * adaptor 共用：短文案 ∩ 本厂 patterns。
 * Host 回合路径不直接扫各厂原文，只认 stamp 后的 code。
 */
export function matchContextOverflowText(
  text: string,
  patterns: readonly RegExp[],
): boolean {
  const raw = (text ?? "").trim();
  if (!isShortOverflowCandidate(raw)) return false;
  return patterns.some((pattern) => pattern.test(raw));
}

/** 把本厂识别出的超限结果打上 context_overflow，供 Host 安全网消费。 */
export function stampContextOverflowIfMatched(
  result: WorkerResult | null,
  isVendorOverflowText: (text: string) => boolean,
): WorkerResult | null {
  if (!result || result.finishReason !== "error") return result;
  if (result.error?.code === CONTEXT_OVERFLOW_CODE) return result;
  const detail = (result.error?.message ?? result.finalText ?? "").trim();
  if (!detail || !isVendorOverflowText(detail)) return result;
  return {
    ...result,
    error: { code: CONTEXT_OVERFLOW_CODE, message: detail },
  };
}

/** Host：只认稳定 code（文案识别在 adaptor）。 */
export function isContextOverflowResult(result: WorkerResult | null | undefined): boolean {
  if (!result || result.finishReason !== "error") return false;
  return result.error?.code === CONTEXT_OVERFLOW_CODE;
}

/** Host：抛错物只认 code；adaptor 应尽量 stamp 进 WorkerResult。 */
export function isContextOverflowError(error: unknown): boolean {
  if (error && typeof error === "object") {
    const row = error as { code?: unknown };
    if (row.code === CONTEXT_OVERFLOW_CODE) return true;
  }
  return false;
}

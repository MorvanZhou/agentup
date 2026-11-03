import type { WorkerResult } from "../contract.js";

/** 外部 SDK 的消息形态随版本变，一律按字段鸭子判断。 */
export type SdkMessage = Record<string, unknown>;

const ERROR_TEXT: Record<string, string> = {
  error_during_execution: "外部 agent 执行出错",
  error_max_turns: "外部 agent 达到轮次上限",
  error_max_budget_usd: "外部 agent 达到预算上限",
};

/** 默认归一：CodeBuddy / Claude 系 ResultMessage；厂商字段不同时由 adaptor.normalizeResult 覆盖。 */
export function resultFromSdkMessage(message: unknown): WorkerResult | null {
  if (!message || typeof message !== "object") return null;
  const row = message as SdkMessage;
  if (row.type !== "result") return null;
  const subtype = typeof row.subtype === "string" ? row.subtype : "success";
  const sessionId = typeof row.session_id === "string" ? row.session_id : undefined;
  const usage = usageOf(row.usage, row.duration_ms);
  const permissionDenials = Array.isArray(row.permission_denials) ? row.permission_denials.length : 0;
  const resultText = typeof row.result === "string" ? row.result : "";

  if (subtype === "success") {
    return {
      finalText: resultText,
      finishReason: "completed",
      sessionId,
      usage,
      permissionDenials,
      numTurns: numberOf(row.num_turns),
    };
  }
  const reasons = Array.isArray(row.errors)
    ? row.errors.filter((item): item is string => typeof item === "string").join("；")
    : "";
  const text = reasons || ERROR_TEXT[subtype] || "外部 agent 执行失败";
  return {
    finalText: resultText || text,
    finishReason: subtype === "error_max_turns" ? "max_tokens" : "error",
    sessionId,
    usage,
    error: { code: subtype, message: text },
    permissionDenials,
  };
}

function usageOf(raw: unknown, durationMs: unknown): WorkerResult["usage"] {
  const row = (raw ?? {}) as SdkMessage;
  return {
    inputTokens: numberOf(row.input_tokens),
    outputTokens: numberOf(row.output_tokens),
    cacheRead: numberOf(row.cache_read_input_tokens),
    cacheWrite: numberOf(row.cache_creation_input_tokens),
    durationMs: numberOf(durationMs),
  };
}

function numberOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

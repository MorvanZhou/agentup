import type { WorkerResult } from "../contract.js";
import { resultFromSdkMessage } from "./result.js";

/**
 * 消费一轮 SDK 流，取最终摘要正文。
 * 优先 result.finalText；部分厂商 result 为空时用 onMessage 累加。
 */
export async function collectCompactSummary(
  iterable: AsyncIterable<unknown>,
  options?: {
    normalizeResult?: (message: unknown) => WorkerResult | null;
    /** 从非 result 消息抽助手正文（Codex / Copilot / OpenCode） */
    onMessage?: (message: unknown, acc: { text: string }) => void;
  },
): Promise<string> {
  const normalize = options?.normalizeResult ?? resultFromSdkMessage;
  const acc = { text: "" };
  let fromResult = "";

  for await (const message of iterable) {
    (options?.onMessage ?? accumulateAssistantDuck)(message, acc);
    const result = normalize(message);
    if (!result) continue;
    if (result.finishReason === "error" || result.finishReason === "aborted") {
      throw new Error(result.error?.message || "compact summarize failed");
    }
    if (result.finalText.trim()) fromResult = result.finalText.trim();
  }

  const summary = (fromResult || acc.text).trim();
  if (!summary) throw new Error("compact summarize: empty completion");
  return summary;
}

/** Host 鸭子消息里抽 assistant 文本（result 常为空的厂商回落）。 */
export function accumulateAssistantDuck(message: unknown, acc: { text: string }): void {
  if (!message || typeof message !== "object" || Array.isArray(message)) return;
  const row = message as Record<string, unknown>;
  if (row.type === "assistant" || row.role === "assistant") {
    const chunk = textFromUnknown(row.message ?? row.content ?? row);
    if (chunk) acc.text += chunk;
    return;
  }
  if (row.type === "stream_event" || row.type === "content_block_delta") {
    const delta = row.delta;
    if (delta && typeof delta === "object") {
      const text = (delta as { text?: unknown }).text;
      if (typeof text === "string" && text) acc.text += text;
    }
  }
}

function textFromUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const row = value as Record<string, unknown>;
  if (typeof row.text === "string") return row.text;
  if (typeof row.result === "string") return row.result;
  if (!Array.isArray(row.content)) return "";
  return row.content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const block = part as { type?: string; text?: string };
      return block.type === "text" || typeof block.text === "string" ? block.text ?? "" : "";
    })
    .join("");
}

export function closeIterable(iterable: AsyncIterable<unknown>): void {
  try {
    const closer = (iterable as { return?: () => Promise<unknown> | undefined }).return;
    void Promise.resolve(closer?.call(iterable)).catch(() => undefined);
  } catch {
    /* ignore */
  }
}

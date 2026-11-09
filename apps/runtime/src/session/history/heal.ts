import { buildSessionContext, SessionManager } from "@earendil-works/pi-coding-agent";
import type { UIMessage } from "ai";

import { INTERRUPTED_ASK_USER_RESULT, INTERRUPTED_TOOL_RESULT } from "./constants.js";

/**
 * 把会话里「有 toolCall、无 toolResult」的悬空调用补成中断结果。
 * 进程退出后多数等待已无法继续；不愈合则下次 prompt 会卡在残缺工具链上。
 * `skipToolCallIds`：盘上仍可闭合的 HITL（审批 / ask_user），留给用户拍板（策略 A）。
 */
export function healInterruptedSessionTools(
  manager: SessionManager,
  options: { skipToolCallIds?: ReadonlySet<string> } = {},
): number {
  const skip = options.skipToolCallIds ?? new Set<string>();
  const pending = new Map<string, string>();
  for (const message of buildSessionContext(manager.getEntries()).messages) {
    if (!message || typeof message !== "object") continue;
    const record = message as {
      role?: unknown;
      content?: unknown;
      toolCallId?: unknown;
      toolName?: unknown;
    };
    if (record.role === "assistant" && Array.isArray(record.content)) {
      for (const part of record.content) {
        if (!part || typeof part !== "object") continue;
        const item = part as { type?: unknown; id?: unknown; name?: unknown };
        if (item.type === "toolCall" && typeof item.id === "string" && typeof item.name === "string") {
          pending.set(item.id, item.name);
        }
      }
    }
    if (record.role === "toolResult" && typeof record.toolCallId === "string") {
      pending.delete(record.toolCallId);
    }
  }
  const now = Date.now();
  let healed = 0;
  for (const [toolCallId, toolName] of pending) {
    if (skip.has(toolCallId)) continue;
    // 与 ask_user 一样软中断：不标 isError，避免模型把「应用退出」当成工具硬失败。
    manager.appendMessage({
      role: "toolResult",
      toolCallId,
      toolName,
      content: [
        {
          type: "text",
          text: toolName === "ask_user" ? INTERRUPTED_ASK_USER_RESULT : INTERRUPTED_TOOL_RESULT,
        },
      ],
      isError: false,
      timestamp: now + healed,
    } as never);
    healed += 1;
  }
  return healed;
}

/** 投影层兜底：仍停在 input-available 的工具视为中断（未愈合的会话 / 单测直接调 projectHistory）。 */
export function settleInterruptedToolParts(messages: UIMessage[]): void {
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    message.parts = message.parts.map((part) => {
      if (part.type !== "dynamic-tool" || part.state !== "input-available") return part;
      return {
        type: "dynamic-tool" as const,
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        state: "output-available" as const,
        input: part.input ?? {},
        output: part.toolName === "ask_user" ? INTERRUPTED_ASK_USER_RESULT : INTERRUPTED_TOOL_RESULT,
      };
    });
  }
}

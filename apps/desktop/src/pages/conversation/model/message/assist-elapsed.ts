/** 协助 Agent 身份层耗时：墙钟起点解析（跨 tab 卸载仍累计）。 */

import type { AssistAgentRef } from "./message-assistants";

/**
 * part.timing 缺失时按 toolCallId 兜底；模块级 Map，避免 Tabs unmountOnHide
 * 重挂面板后 Date.now() 重新起表。
 */
const localStartedAt = new Map<string, number>();

export function resolveAssistStartMs(
  assist: Pick<AssistAgentRef, "startedAt" | "status" | "toolCallId" | "agentId">,
  nowMs: number = Date.now(),
): number | undefined {
  if (typeof assist.startedAt === "number") return assist.startedAt;
  if (assist.status !== "running") return undefined;
  const key = assist.toolCallId || assist.agentId;
  if (!key) return undefined;
  const cached = localStartedAt.get(key);
  if (cached !== undefined) return cached;
  localStartedAt.set(key, nowMs);
  return nowMs;
}

/** 单测隔离：清空本地兜底起点。 */
export function resetAssistStartMsCacheForTests(): void {
  localStartedAt.clear();
}

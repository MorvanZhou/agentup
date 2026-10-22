import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

import type { ModelConfig } from "../../config/load.js";
import type { Visit } from "../../package/sync.js";
import type { AsyncWakeItem } from "../wake/index.js";
import type { PromptRewind, PromptSession } from "./types.js";

export function slotModelKey(model: ModelConfig): string {
  return `${model.templateId}::${model.modelId}`;
}

export function visitKind(visit: Pick<Visit, "kind">): AsyncWakeItem["kind"] {
  return visit.kind === "personal" || visit.kind === "local" ? visit.kind : "recruited";
}

export function visitKey(userId: string, agentId: string, kind: Visit["kind"] = "recruited"): string {
  const bucket = kind === "personal" ? "personal" : kind === "local" ? "local" : "recruited";
  return `${userId}/${bucket}/${agentId}`;
}

/** 从 Pi 事件里收集最近一次模型失败文案（含 auto-retry）。 */
export function trackModelFailure(
  event: AgentSessionEvent,
  setError: (message: string) => void,
): void {
  if (event.type === "auto_retry_start" && event.errorMessage) {
    setError(event.errorMessage);
    return;
  }
  if (event.type === "auto_retry_end") {
    if (!event.success && event.finalError) setError(event.finalError);
    return;
  }
  if (event.type !== "entry_appended") return;
  const entry = event.entry;
  if (entry.type !== "message") return;
  const message = entry.message as { role?: string; errorMessage?: unknown };
  if (message.role !== "assistant") return;
  if (typeof message.errorMessage === "string" && message.errorMessage.trim()) {
    setError(message.errorMessage.trim());
  }
}

/** 编辑旧 user message 重发前：navigateTree 回退对话，checkpoint 扩展顺带还原文件。 */
export async function rewindSession(session: PromptSession, rewind?: PromptRewind): Promise<void> {
  if (!rewind) return;
  const targetId = resolveRewindEntryId(session, rewind);
  if (!targetId || typeof session.navigateTree !== "function") return;
  const result = await session.navigateTree(targetId);
  if (result.cancelled) throw new Error("已取消回退对话");
}

export function resolveRewindEntryId(session: PromptSession, rewind: PromptRewind): string | undefined {
  const manager = session.sessionManager;
  if (!manager) return undefined;

  if (rewind.messageId) {
    const entry = manager.getEntry(rewind.messageId);
    if (entry?.type === "message" && entry.message.role === "user") return entry.id;
  }

  if (typeof rewind.userTurnOrdinal !== "number" || rewind.userTurnOrdinal < 0) return undefined;
  const users = manager.getBranch().filter(
    (entry) => entry.type === "message" && entry.message.role === "user",
  );
  return users[rewind.userTurnOrdinal]?.id;
}

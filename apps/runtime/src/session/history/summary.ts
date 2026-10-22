import type { ExtensionContext, ExtensionFactory, SessionEntry } from "@earendil-works/pi-coding-agent";

import { ASYNC_WAKE_CUSTOM_TYPE } from "../wake/index.js";

/** 会话 custom entry：turn 结束后标记主产物（最后一段非空 text）。 */
export const AGENTUP_SUMMARY_CUSTOM_TYPE = "agentup-summary";

export type AgentUpSummaryRef = {
  /** 流式 text part id（历史投影可能没有）。 */
  textPartId?: string;
  /** 本条 assistant UIMessage 中非空 text part 的序数（从 0 起）。 */
  textPartIndex: number;
};

export type AgentUpSummaryEntryData = {
  textPartIndex: number;
};

/** 从当前分支最近一次 user 之后的 assistant 内容，解析主产物 text 序数。 */
export function resolveSummaryFromBranch(
  branch: readonly SessionEntry[],
): AgentUpSummaryEntryData | undefined {
  let lastUser = -1;
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (entry?.type === "message" && entry.message.role === "user") {
      lastUser = index;
      break;
    }
  }

  // 空闲 wake 没有新的 user。只统计 wake 之后的正文，避免序号指到上一句。
  let start = lastUser + 1;
  for (let index = branch.length - 1; index > lastUser; index -= 1) {
    const entry = branch[index];
    if (entry?.type === "custom_message" && entry.customType === ASYNC_WAKE_CUSTOM_TYPE) {
      start = index + 1;
      break;
    }
  }

  let textCount = 0;
  let lastIndex: number | undefined;
  for (let index = start; index < branch.length; index += 1) {
    const entry = branch[index];
    if (entry?.type !== "message" || entry.message.role !== "assistant") continue;
    const content = entry.message.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const item = part as { type?: unknown; text?: unknown };
      if (item.type !== "text" || typeof item.text !== "string" || !item.text) continue;
      lastIndex = textCount;
      textCount += 1;
    }
  }
  return lastIndex === undefined ? undefined : { textPartIndex: lastIndex };
}

export function parseSummaryEntryData(data: unknown): AgentUpSummaryEntryData | undefined {
  if (!data || typeof data !== "object") return undefined;
  const index = (data as { textPartIndex?: unknown }).textPartIndex;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0) return undefined;
  return { textPartIndex: index };
}

/** turn 完全 settled 后写入主产物引用；供流式投影与历史还原。 */
export function createSummaryExtension(): ExtensionFactory {
  return (pi) => {
    pi.on("agent_settled", async (_event, ctx: ExtensionContext) => {
      const summary = resolveSummaryFromBranch(ctx.sessionManager.getBranch());
      if (!summary) return;
      pi.appendEntry<AgentUpSummaryEntryData>(AGENTUP_SUMMARY_CUSTOM_TYPE, summary);
    });
  };
}

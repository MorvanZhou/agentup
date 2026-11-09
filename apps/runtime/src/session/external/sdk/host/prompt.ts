import type { Message } from "@earendil-works/pi-ai";

import { sanitizeToolResultText } from "../../../history/sanitize-tool-result.js";

/**
 * 交付给外部 agent 的 prompt 上限回落值。
 * 主路径应按会话模型 `compactBudgetsFromContextWindow().hardTruncateChars` 传入 maxChars。
 */
export const MAX_PROMPT_CHARS = 60_000;

/** Host 落盘的上下文压缩边界（隐藏 custom_message）。规格：agent-context-compaction.md §5 */
export const CONTEXT_COMPACTION_CUSTOM_TYPE = "agentup.context_compaction";

/** 压缩摘要进可喂视图时的可见前缀（flatten 后给模型看）。 */
export const CONTEXT_COMPACTION_PREFIX = "[上下文压缩]\n";

/**
 * @deprecated 旧滑动窗口默认值；主路径已改为全量原文 + 边界。保留导出以免外部 import 断裂。
 */
export const DEFAULT_RECENT_TURNS = 6;

export type TranscriptPromptOptions = {
  maxChars?: number;
};

export type SessionBranchEntry = {
  id?: string;
  type?: string;
  message?: Message;
  content?: string;
  customType?: string;
  summary?: string;
  firstKeptEntryId?: string;
  timestamp?: number;
};

/**
 * 把可喂视图折成一段任务描述：丢掉 Pi 的系统提示，只留对话本身。
 * 主路径：全部原文行拼接（有压缩边界时视图里已是 summary+尾巴）。
 * 超 maxChars：回退——从最早整行丢掉并明说省略；仍超则硬切尾。
 * 上下文由 runtime 每轮重拼，不 resume 厂商 session。
 * 规格：docs/ARCHITECTURE/agent-context-compaction.md § SDK
 */
export function transcriptToPrompt(
  messages: readonly Message[],
  options: TranscriptPromptOptions = {},
): string {
  const maxChars = options.maxChars ?? MAX_PROMPT_CHARS;
  const lines = messages
    .map(messageToLine)
    .filter((line): line is string => line !== null);

  let text = lines.join("\n");
  if (text.length <= maxChars) return text;

  let dropped = 0;
  const kept = [...lines];
  while (kept.length > 1 && kept.join("\n").length > maxChars) {
    kept.shift();
    dropped += 1;
  }
  text = kept.join("\n");
  if (dropped === 0) {
    return text.length <= maxChars ? text : `…${text.slice(-(maxChars - 1))}`;
  }
  // 先为省略通知留位，再截正文，避免硬切把「已省略」字样切掉
  const notice = `（已省略更早 ${dropped} 条消息，需要回顾请说）\n`;
  const bodyBudget = Math.max(1, maxChars - notice.length);
  if (text.length > bodyBudget) text = `…${text.slice(-(bodyBudget - 1))}`;
  return `${notice}${text}`;
}

function pushBranchMessage(feed: Message[], entry: SessionBranchEntry): void {
  if (entry.type === "custom_message" && typeof entry.content === "string" && entry.content.trim()) {
    if (entry.customType === CONTEXT_COMPACTION_CUSTOM_TYPE) return;
    feed.push({
      role: "user",
      content: `[会话上下文]\n${entry.content.trim()}`,
      timestamp: typeof entry.timestamp === "number" ? entry.timestamp : Date.now(),
    });
    return;
  }
  if (entry.type === "message" && entry.message && typeof entry.message === "object") {
    const message = entry.message;
    if (
      message.role === "system" ||
      message.role === "user" ||
      message.role === "assistant" ||
      message.role === "toolResult"
    ) {
      feed.push(message);
    }
  }
}

/**
 * 从 Pi/Host session branch 构建 SDK 可喂 Message 列表。
 * 支持：`agentup.context_compaction` custom_message，以及 Pi `compaction` entry
 *（与 buildContextEntries 同序：summary + firstKept… + 边界后）。
 */
export function feedMessagesFromBranch(
  entries: readonly unknown[],
  userText: string,
): Message[] {
  const rows: SessionBranchEntry[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    rows.push(entry as SessionBranchEntry);
  }

  let lastPiCompaction: { index: number; summary: string; firstKeptEntryId: string } | null =
    null;
  let lastCustomCompaction: { index: number; summary: string } | null = null;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.type === "compaction" && typeof row.summary === "string" && row.summary.trim()) {
      lastPiCompaction = {
        index: i,
        summary: row.summary.trim(),
        firstKeptEntryId: typeof row.firstKeptEntryId === "string" ? row.firstKeptEntryId : "",
      };
    }
    if (
      row.type === "custom_message" &&
      row.customType === CONTEXT_COMPACTION_CUSTOM_TYPE &&
      typeof row.content === "string" &&
      row.content.trim()
    ) {
      lastCustomCompaction = { index: i, summary: row.content.trim() };
    }
  }

  const feed: Message[] = [];

  // API→SDK 切换后可能两界并存：取 branch 上更晚的那条为权威
  const useCustom =
    lastCustomCompaction != null &&
    (!lastPiCompaction || lastCustomCompaction.index >= lastPiCompaction.index);

  if (useCustom && lastCustomCompaction) {
    feed.push({
      role: "user",
      content: `${CONTEXT_COMPACTION_PREFIX}${lastCustomCompaction.summary}`,
      timestamp: Date.now(),
    });
    for (let i = lastCustomCompaction.index + 1; i < rows.length; i++) {
      pushBranchMessage(feed, rows[i]!);
    }
  } else if (lastPiCompaction) {
    // 与 Pi buildContextEntries 对齐：摘要 + firstKept 至边界前 + 边界后
    feed.push({
      role: "user",
      content: `${CONTEXT_COMPACTION_PREFIX}${lastPiCompaction.summary}`,
      timestamp: Date.now(),
    });
    let keeping = !lastPiCompaction.firstKeptEntryId;
    for (let i = 0; i < lastPiCompaction.index; i++) {
      const row = rows[i]!;
      if (lastPiCompaction.firstKeptEntryId && row.id === lastPiCompaction.firstKeptEntryId) {
        keeping = true;
      }
      if (!keeping) continue;
      pushBranchMessage(feed, row);
    }
    for (let i = lastPiCompaction.index + 1; i < rows.length; i++) {
      pushBranchMessage(feed, rows[i]!);
    }
  } else {
    for (const row of rows) pushBranchMessage(feed, row);
  }

  if (userText.trim()) {
    feed.push({ role: "user", content: userText, timestamp: Date.now() });
  }
  return feed;
}

/** 估算可喂视图字符量（粗闸，供触发压缩）。 */
export function estimateFeedChars(messages: readonly Message[]): number {
  return transcriptToPrompt(messages).length;
}

/** 是否建议触发 Host 压缩（粗闸；主路径传入按窗算的 budgetChars）。 */
export function shouldCompactFeed(
  messages: readonly Message[],
  budgetChars: number = Math.floor(MAX_PROMPT_CHARS * 0.9),
): boolean {
  return estimateFeedChars(messages) >= budgetChars;
}

function messageToLine(message: Message): string | null {
  if (message.role === "system") {
    // Pi 的系统提示里是 AgentUp 的工具清单与路径，喂给外部 agent 只会误导它
    return null;
  }
  if (message.role === "user") {
    return `用户：${contentToText(message.content)}`;
  }
  if (message.role === "assistant") {
    const parts = message.content.map((block) => {
      if (block.type === "text") return block.text;
      if (block.type === "toolCall") return `[调用工具 ${block.name}]`;
      return "";
    });
    const text = parts.filter((item) => item.length > 0).join("");
    return text ? `助手：${text}` : null;
  }
  return `工具结果（${message.toolName}）：${contentToText(message.content)}`;
}

function contentToText(content: unknown): string {
  // 旧会话里可能已落盘 ViewImage data URL；重拼时仍须剥掉
  if (typeof content === "string") return sanitizeToolResultText(content);
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      const row = block as { type?: string; text?: string };
      if (row?.type === "text") return sanitizeToolResultText(row.text ?? "");
      if (row?.type === "image" || row?.type === "image_url" || row?.type === "input_image") {
        return "[图片]";
      }
      return "";
    })
    .filter((item) => item.length > 0)
    .join("\n");
}

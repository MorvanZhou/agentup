/**
 * SDK Host 上下文压缩落盘（agent-context-compaction.md §5）。
 * R1：边界写入与读取已接上；R2：由调用方提供 summarize 再落盘。
 * API：用 Pi appendCompaction，使 buildContextEntries 真正缩短可喂 messages。
 */
import { findCutPoint } from "@earendil-works/pi-coding-agent";

import {
  CONTEXT_COMPACTION_CUSTOM_TYPE,
  feedMessagesFromBranch,
  shouldCompactFeed,
  transcriptToPrompt,
  MAX_PROMPT_CHARS,
} from "./prompt.js";
import { estimateTokensFromChars, resolveContextWindowTokens } from "./budget.js";

export type CompactionSink = {
  appendCustomMessageEntry?(
    customType: string,
    content: string,
    display: boolean,
  ): void;
};

/** Pi SessionManager.appendCompaction 最小面。 */
export type ApiCompactionSink = {
  appendCompaction(
    summary: string,
    firstKeptEntryId: string | null,
    tokensBefore: number,
    details?: unknown,
    fromHook?: boolean,
  ): string;
};

type BranchEntry = {
  id?: string;
  type?: string;
  summary?: string;
  firstKeptEntryId?: string;
  message?: unknown;
};

/** 将语义摘要写入 Host session（隐藏，不进 UI 气泡）。SDK flatten 用。 */
export function appendContextCompaction(sink: CompactionSink | undefined, summary: string): boolean {
  const text = summary.trim();
  if (!text || typeof sink?.appendCustomMessageEntry !== "function") return false;
  try {
    sink.appendCustomMessageEntry(CONTEXT_COMPACTION_CUSTOM_TYPE, text, false);
    return true;
  } catch {
    return false;
  }
}

export type MaybeCompactInput = {
  /** 压缩前的 branch（不含本轮即将追加的 user，或已含均可） */
  entries: readonly unknown[];
  /** 本轮用户句；参与体积估算 */
  userText: string;
  /** 对「边界前原文」做摘要；失败则跳过压缩 */
  summarize: (plainTranscript: string) => Promise<string>;
  sink: CompactionSink;
  /**
   * 触发字符预算；应由调用方按会话模型 `compactBudgetsFromContextWindow` 传入。
   * 未传时回落旧固定闸（兼容测例）。
   */
  budgetChars?: number;
};

/**
 * 若可喂视图超预算：摘要边界前原文并落盘（custom_message，供 SDK flatten）。
 * 成功返回 true（调用方应重新 feedMessagesFromBranch）；失败/无需压缩返回 false。
 */
export async function maybeCompactBranch(input: MaybeCompactInput): Promise<boolean> {
  const budget = input.budgetChars ?? Math.floor(MAX_PROMPT_CHARS * 0.9);
  const probe = feedMessagesFromBranch(input.entries, input.userText);
  if (!shouldCompactFeed(probe, budget)) return false;

  // 边界前可喂视图（不含本轮 userText）作为待摘要材料
  const material = feedMessagesFromBranch(input.entries, "");
  if (material.length === 0) return false;

  const plain = transcriptToPrompt(material);
  if (!plain.trim()) return false;

  let summary: string;
  try {
    summary = (await input.summarize(plain)).trim();
  } catch {
    return false;
  }
  if (!summary) return false;
  return appendContextCompaction(input.sink, summary);
}

export type MaybeCompactApiInput = {
  entries: readonly unknown[];
  userText: string;
  summarize: (plainTranscript: string) => Promise<string>;
  sink: ApiCompactionSink;
  budgetChars?: number;
  /** 用于推导 keepRecentTokens；缺则 128k */
  contextWindowTokens?: number;
  /** 测例可注入；默认见 resolveApiKeepRecentTokens */
  keepRecentTokens?: number;
};

/**
 * 保留尾巴的 token 预算：不能只用「窗×15%」（中等会话常被整段判定为 keep，压了等于没压）。
 * 相对当前可喂体积取约 25%，再与窗比例取小，夹在 500–20k。
 */
export function resolveApiKeepRecentTokens(input: {
  contextWindowTokens?: number;
  feedChars: number;
}): number {
  const window = resolveContextWindowTokens(input.contextWindowTokens);
  const byWindow = Math.floor(window * 0.15);
  const feedTokens = Math.max(1, estimateTokensFromChars(input.feedChars));
  const byFeed = Math.floor(feedTokens * 0.25);
  return Math.max(500, Math.min(20_000, byWindow, byFeed));
}

/**
 * API/Pi：超预算时用同模型摘要 + SessionManager.appendCompaction。
 * firstKept 按 Pi findCutPoint；keep 预算相对可喂体积，避免「超闸却切不出尾巴」。
 */
export async function maybeCompactApiBranch(input: MaybeCompactApiInput): Promise<boolean> {
  const budget = input.budgetChars ?? Math.floor(MAX_PROMPT_CHARS * 0.9);
  const probe = feedMessagesFromBranch(input.entries, input.userText);
  if (!shouldCompactFeed(probe, budget)) return false;

  const entries = input.entries as BranchEntry[];
  if (entries.length === 0) return false;

  const feedChars = transcriptToPrompt(probe).length;
  let keepRecentTokens =
    input.keepRecentTokens ??
    resolveApiKeepRecentTokens({
      contextWindowTokens: input.contextWindowTokens,
      feedChars,
    });

  // 已有 compaction 之后才算新材料（与 Pi prepare 一致）
  let startIndex = 0;
  for (let i = 0; i < entries.length; i++) {
    if (entries[i]?.type === "compaction") startIndex = i + 1;
  }
  if (startIndex >= entries.length) return false;

  let firstKeptIndex = startIndex;
  // 若仍切不出（极端短会话/元数据占满），逐步收紧 keep 再试
  for (let attempt = 0; attempt < 4; attempt++) {
    const cut = findCutPoint(
      entries as Parameters<typeof findCutPoint>[0],
      startIndex,
      entries.length,
      keepRecentTokens,
    );
    if (cut.firstKeptEntryIndex > startIndex) {
      firstKeptIndex = cut.firstKeptEntryIndex;
      break;
    }
    keepRecentTokens = Math.max(200, Math.floor(keepRecentTokens / 2));
  }
  if (firstKeptIndex <= startIndex) return false;

  const firstKept = entries[firstKeptIndex];
  if (!firstKept?.id) return false;

  const toSummarize = entries.slice(startIndex, firstKeptIndex);
  const material = feedMessagesFromBranch(toSummarize, "");
  if (material.length === 0) return false;

  const plain = transcriptToPrompt(material);
  if (!plain.trim()) return false;

  let summary: string;
  try {
    summary = (await input.summarize(plain)).trim();
  } catch {
    return false;
  }
  if (!summary) return false;

  const tokensBefore = estimateTokensFromChars(
    transcriptToPrompt(feedMessagesFromBranch(input.entries, "")).length,
  );
  try {
    input.sink.appendCompaction(
      summary,
      firstKept.id,
      tokensBefore,
      { source: "agentup.host" },
      true,
    );
    return true;
  } catch {
    return false;
  }
}

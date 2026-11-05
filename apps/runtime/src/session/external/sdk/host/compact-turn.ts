/**
 * 回合前压缩接线：同会话模型 + 按窗预算。
 */
import type { ModelConfig } from "../../../../config/load.js";
import { compactBudgetsFromContextWindow } from "./budget.js";
import {
  maybeCompactApiBranch,
  maybeCompactBranch,
  type ApiCompactionSink,
  type CompactionSink,
} from "./compact.js";
import { createCompactSummarize } from "./summarize.js";

export type CompactTurnOptions = {
  compactSummarize?: (plainTranscript: string) => Promise<string>;
  compactBudgetChars: number;
  promptMaxChars: number;
};

/** VisitChats / 群 / 委托共用：摘要器与两道闸都锚定 prefer。 */
export function compactTurnOptions(input: {
  userDataRoot: string;
  prefer: ModelConfig;
  signal?: AbortSignal;
}): CompactTurnOptions {
  const budgets = compactBudgetsFromContextWindow(input.prefer.contextWindow);
  const compactSummarize = createCompactSummarize({
    userDataRoot: input.userDataRoot,
    prefer: input.prefer,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  return {
    ...(compactSummarize ? { compactSummarize } : {}),
    compactBudgetChars: budgets.triggerChars,
    promptMaxChars: budgets.hardTruncateChars,
  };
}

type ApiCompactSession = {
  sessionManager?: CompactionSink &
    Partial<ApiCompactionSink> & {
      getBranch?(): unknown[];
    };
};

/**
 * API/Pi 回合前：同模型摘要 + appendCompaction，缩短 Pi 可喂 messages。
 * 无摘要能力时跳过；Pi 仍可依 model.contextWindow 走内建 compact。
 */
export async function maybeCompactApiSession(input: {
  session: ApiCompactSession;
  userText: string;
  userDataRoot: string;
  model: ModelConfig;
  signal?: AbortSignal;
}): Promise<void> {
  const manager = input.session.sessionManager;
  if (!manager?.getBranch) return;

  const budgets = compactBudgetsFromContextWindow(input.model.contextWindow);
  const compact = compactTurnOptions({
    userDataRoot: input.userDataRoot,
    prefer: input.model,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (!compact.compactSummarize) return;

  try {
    if (typeof manager.appendCompaction === "function") {
      await maybeCompactApiBranch({
        entries: manager.getBranch() ?? [],
        userText: input.userText,
        summarize: compact.compactSummarize,
        sink: manager as ApiCompactionSink,
        budgetChars: compact.compactBudgetChars,
        contextWindowTokens: budgets.contextWindowTokens,
      });
      return;
    }
    // 无 appendCompaction 的替身（测例）仍可写 custom_message
    if (typeof manager.appendCustomMessageEntry === "function") {
      await maybeCompactBranch({
        entries: manager.getBranch() ?? [],
        userText: input.userText,
        summarize: compact.compactSummarize,
        sink: manager,
        budgetChars: compact.compactBudgetChars,
      });
    }
  } catch {
    // 不挡本轮
  }
}

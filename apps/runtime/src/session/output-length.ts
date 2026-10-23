import type { ExtensionFactory, SessionManager } from "@earendil-works/pi-coding-agent";

import { t } from "../i18n/index.js";
import type { UiLocale } from "../i18n/locale.js";
import {
  consumeStreamDegeneration,
  streamDegenerationAbortedMessage,
} from "./stream-guard.js";

/**
 * 输出上限（`stopReason: length`）自动恢复。
 *
 * Pi 内置 compact-and-retry 只覆盖「可恢复 length」（`output < maxTokens`，上下文挤窄输出）。
 * 顶满 `maxTokens`（含纯 reasoning）不在其范围 —— 本扩展在 `agent_before_settle`
 * 有界注入续写指令并 `continue: true`，主会话与委托会话共用，调用方无需手动处理。
 *
 * 策略（OpenCode / AutoGen / Anthropic 惯例）：
 * - 任意 `length` → 自动续写（含仅 reasoning），上限 {@link MAX_OUTPUT_LENGTH_CONTINUATIONS}
 * - 续写提示禁止长推理，要求 tool/短摘要
 * - 仍无正文时由调用方用 {@link resolveEmptyAssistantError} 给出明确失败
 */

export const AGENTUP_OUTPUT_LENGTH_CONTINUE_TYPE = "agentup-output-length-continue";

/** 单次 agent run 内最多自动续写次数。 */
export const MAX_OUTPUT_LENGTH_CONTINUATIONS = 2;

/** 续写提示：对模型用英文；禁止复述与长推理。 */
export const OUTPUT_LENGTH_CONTINUE_PROMPT =
  "Output token limit was hit (possibly while only reasoning). " +
  "Do not continue long reasoning or repeat prior text. " +
  "Immediately emit the next tool call, or write results via tools/files, then a short final summary.";

export type LastAssistantInspection = {
  stopReason: string | undefined;
  hasText: boolean;
  hasToolCall: boolean;
  hasThinking: boolean;
};

type BranchEntry = {
  type: string;
  message?: {
    role?: string;
    stopReason?: string;
    content?: unknown;
  };
};

/** 当前分支最后一条 assistant 消息的截断相关信号。 */
export function inspectLastAssistantMessage(
  branch: readonly BranchEntry[],
): LastAssistantInspection | undefined {
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (entry?.type !== "message") continue;
    const message = entry.message;
    if (!message || message.role !== "assistant") continue;
    let hasText = false;
    let hasToolCall = false;
    let hasThinking = false;
    if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (!part || typeof part !== "object") continue;
        const item = part as { type?: unknown; text?: unknown; thinking?: unknown };
        if (item.type === "text" && typeof item.text === "string" && item.text.trim()) {
          hasText = true;
        } else if (
          item.type === "toolCall" ||
          item.type === "tool_use" ||
          item.type === "functionCall"
        ) {
          hasToolCall = true;
        } else if (
          item.type === "thinking" &&
          typeof item.thinking === "string" &&
          item.thinking.trim()
        ) {
          hasThinking = true;
        }
      }
    }
    return {
      stopReason: typeof message.stopReason === "string" ? message.stopReason : undefined,
      hasText,
      hasToolCall,
      hasThinking,
    };
  }
  return undefined;
}

export function inspectLastAssistantFromManager(
  manager: Pick<SessionManager, "getBranch">,
): LastAssistantInspection | undefined {
  return inspectLastAssistantMessage(manager.getBranch() as readonly BranchEntry[]);
}

/** 是否应在 settle 前自动续写一轮。 */
export function shouldAutoContinueOutputLength(
  inspection: LastAssistantInspection | undefined,
  continuedCount: number,
  maxContinuations: number = MAX_OUTPUT_LENGTH_CONTINUATIONS,
): boolean {
  if (!inspection || inspection.stopReason !== "length") return false;
  return continuedCount < maxContinuations;
}

export function outputLengthExceededMessage(locale?: UiLocale | string | null): string {
  return t("chat.outputLengthExceeded", locale);
}

export function emptyAssistantResultMessage(locale?: UiLocale | string | null): string {
  return t("chat.emptyAssistantResult", locale);
}

/** prompt 已结束后仍无正文：优先流式退化，再按是否 length 选错误文案。 */
export function resolveEmptyAssistantError(
  manager: Pick<SessionManager, "getBranch">,
  locale?: UiLocale | string | null,
): string {
  if (consumeStreamDegeneration(manager)) {
    return streamDegenerationAbortedMessage(locale);
  }
  const inspection = inspectLastAssistantFromManager(manager);
  if (inspection?.stopReason === "length") {
    return outputLengthExceededMessage(locale);
  }
  return emptyAssistantResultMessage(locale);
}

/**
 * 挂到 `createAgentSession`：撞上输出上限时在 agent 内自动续写，无需调用方再 prompt。
 */
export function createOutputLengthExtension(
  options: { maxContinuations?: number } = {},
): ExtensionFactory {
  const max = options.maxContinuations ?? MAX_OUTPUT_LENGTH_CONTINUATIONS;
  return (pi) => {
    let continued = 0;

    pi.on("agent_start", () => {
      continued = 0;
    });

    pi.on("agent_before_settle", (event, ctx) => {
      if (event.outcome === "aborted" || event.outcome === "error") return;
      if (!event.context.canContinue) return;

      const inspection = inspectLastAssistantFromManager(ctx.sessionManager);
      if (!shouldAutoContinueOutputLength(inspection, continued, max)) return;

      continued += 1;
      return {
        entries: [
          ...event.entries,
          {
            type: "custom_message" as const,
            customType: AGENTUP_OUTPUT_LENGTH_CONTINUE_TYPE,
            content: OUTPUT_LENGTH_CONTINUE_PROMPT,
            display: false,
          },
        ],
        continue: true,
      };
    });
  };
}

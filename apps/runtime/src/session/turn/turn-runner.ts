import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { UIMessageChunk } from "ai";

import type { UiLocale } from "../../i18n/locale.js";
import type { DelegationStartedEvent } from "../delegation/progress.js";
import { PiUIMessageProjector } from "../history/frames.js";
import type { ApprovalRequest } from "../hitl/approval/types.js";
import type { ShellHangRequest } from "../hitl/shell-hang/types.js";
import {
  assistantFailureNotice,
  isModelServiceUnavailable,
  isUserCancelError,
  modelUnavailableNotice,
} from "../model/unavailable.js";
import { resolveEmptyAssistantError } from "../output-length.js";
import {
  consumeStreamDegeneration,
  sanitizeStreamText,
  streamDegenerationAbortedMessage,
} from "../stream-guard.js";
import type { AskUserRequest } from "../tools/ask-user.js";
import { trackModelFailure } from "./helpers.js";
import type { PromptSession } from "./types.js";

export type TurnErrorPolicy = "prompt" | "wake" | "propagate";

export type TurnHitlLabel = {
  askedByName?: string;
  taskLabel?: string;
};

type HitlIdentity = {
  userId: string;
  agentId: string;
  origin?: "visit" | "delegation";
  parentAgentId?: string;
  taskId?: string;
  groupId?: string;
};

export type ObservedTurnInput = {
  session: PromptSession;
  signal?: AbortSignal;
  write: (chunks: UIMessageChunk[]) => void;
  locale?: UiLocale | string | null;
  /** prompt 吞掉错误并写进流；wake 写完再抛出；propagate 原样抛出。 */
  errorPolicy: TurnErrorPolicy;
  /** wake 用来告诉调用方不要立刻再开一轮。 */
  outcome?: { aborted: boolean };
  /** 编排条刷新。prompt 与 wake 的即时事件略有不同。 */
  onDirty?: () => void;
  dirty?: "prompt" | "wake";
  hitl?: {
    accept: (request: HitlIdentity) => boolean;
    label?: (request: { origin?: string; taskId?: string }) => TurnHitlLabel;
    approvals?: { subscribe: (listener: (request: ApprovalRequest) => void) => () => void };
    askUser?: { subscribe: (listener: (request: AskUserRequest) => void) => () => void };
    shellHang?: { subscribe: (listener: (request: ShellHangRequest) => void) => () => void };
  };
  delegationStarted?: {
    accept: (event: DelegationStartedEvent) => boolean;
    subscribe: (listener: (event: DelegationStartedEvent) => void) => () => void;
  };
  /** 注入上下文并调用 prompt / sendCustomMessage。订阅已经接好。 */
  run: () => Promise<void>;
};

export async function runObservedTurn(input: ObservedTurnInput): Promise<{ visibleText: string }> {
  const projector = new PiUIMessageProjector();
  let lastModelError = "";
  let lastFailureError = "";
  let sawAssistantText = false;
  let visibleText = "";
  let lastDirtyAt = 0;
  const unsubscribe = input.session.subscribe((event) => {
    trackModelFailure(event, (error) => {
      lastModelError = error;
      if (!isUserCancelError(error)) lastFailureError = error;
    });
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta" &&
      typeof event.assistantMessageEvent.delta === "string" &&
      event.assistantMessageEvent.delta.length > 0
    ) {
      const { text } = sanitizeStreamText(event.assistantMessageEvent.delta);
      if (text.length > 0) {
        sawAssistantText = true;
        visibleText += text;
      }
    }
    if (input.onDirty && shouldMarkDirty(event, input.dirty ?? "prompt", lastDirtyAt)) {
      lastDirtyAt = Date.now();
      input.onDirty();
    }
    input.write(projector.project(event));
  });
  const label = (request: { origin?: string; taskId?: string }) => input.hitl?.label?.(request) ?? {};
  const unsubscribeApproval = input.hitl?.approvals?.subscribe((request: ApprovalRequest) => {
    if (!input.hitl?.accept(request)) return;
    input.write(
      projector.approval({
        id: request.id,
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        args: request.args,
        ...label(request),
      }),
    );
  });
  const unsubscribeAskUser = input.hitl?.askUser?.subscribe((request: AskUserRequest) => {
    if (!input.hitl?.accept(request)) return;
    input.write(
      projector.askUser({
        id: request.id,
        toolCallId: request.toolCallId,
        questions: request.questions,
        ...label(request),
      }),
    );
  });
  const unsubscribeShellHang = input.hitl?.shellHang?.subscribe((request: ShellHangRequest) => {
    if (!input.hitl?.accept(request)) return;
    input.write(
      projector.shellHang({
        id: request.id,
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        command: request.command,
        elapsedMs: request.elapsedMs,
        ...label(request),
      }),
    );
  });
  const unsubscribeDelegationStarted = input.delegationStarted?.subscribe((event) => {
    if (!input.delegationStarted?.accept(event)) return;
    input.write(
      projector.delegationStarted({
        taskId: event.taskId,
        toolCallId: event.toolCallId,
        toAgentId: event.toAgentId,
        toAgentName: event.toAgentName,
        brief: event.brief,
        wait: event.wait,
      }),
    );
  });
  const onAbort = () => {
    void input.session.abort().catch(() => undefined);
  };
  if (input.signal?.aborted) onAbort();
  else input.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    await input.run();
    input.write(
      input.errorPolicy === "propagate"
        ? projector.finish()
        : finishEmptyAssistantTurn({
            projector,
            sawAssistantText,
            lastModelError: lastFailureError || lastModelError,
            sessionManager: input.session.sessionManager,
            locale: input.locale,
          }),
    );
    return { visibleText };
  } catch (error) {
    if (input.errorPolicy === "propagate") throw error;
    if (input.errorPolicy === "wake") {
      const message = error instanceof Error ? error.message : String(error ?? "");
      const aborted =
        isUserCancelError(message) || (error instanceof Error && /abort/i.test(error.name));
      if (input.outcome) input.outcome.aborted = aborted;
      writeFailure(input.write, projector, message, undefined, sawAssistantText, aborted);
      throw error;
    }
    const raw = error instanceof Error && error.message ? error.message : "对话失败";
    writeFailure(input.write, projector, raw, input.locale, sawAssistantText, false);
    return { visibleText };
  } finally {
    input.signal?.removeEventListener("abort", onAbort);
    unsubscribeDelegationStarted?.();
    unsubscribeShellHang?.();
    unsubscribeAskUser?.();
    unsubscribeApproval?.();
    unsubscribe();
  }
}

function shouldMarkDirty(event: AgentSessionEvent, dirty: "prompt" | "wake", lastDirtyAt: number): boolean {
  if (
    event.type === "entry_appended" ||
    event.type === "tool_execution_start" ||
    event.type === "tool_execution_end" ||
    (dirty === "wake" && event.type === "message_start")
  ) {
    return true;
  }
  return Date.now() - lastDirtyAt > 800;
}

function writeFailure(
  write: (chunks: UIMessageChunk[]) => void,
  projector: PiUIMessageProjector,
  raw: string,
  locale: UiLocale | string | null | undefined,
  sawAssistantText: boolean,
  aborted: boolean,
): void {
  if (aborted) {
    write(projector.finish(raw || "已停止"));
    return;
  }
  if (isModelServiceUnavailable(raw) && !isUserCancelError(raw)) {
    const notice = modelUnavailableNotice(locale);
    if (!sawAssistantText) write(projector.modelUnavailable(notice));
    write(projector.finish(notice));
    return;
  }
  const notice = assistantFailureNotice(raw, locale);
  write(projector.finish(notice ?? (raw || "对话失败")));
}

/**
 * prompt/wake 正常返回但无可见正文时：把限流、连不上、空结果等原因写进流，避免空气泡。
 * 用户取消（abort）不注入正文，交给桌面 cancelled 态。
 */
function finishEmptyAssistantTurn(input: {
  projector: PiUIMessageProjector;
  sawAssistantText: boolean;
  lastModelError: string;
  sessionManager: { getBranch: () => unknown } | undefined;
  locale: UiLocale | string | null | undefined;
}): UIMessageChunk[] {
  const { projector, sawAssistantText, lastModelError, sessionManager, locale } = input;
  if (sawAssistantText) return projector.finish();
  if (lastModelError) {
    const notice = assistantFailureNotice(lastModelError, locale);
    if (notice && isModelServiceUnavailable(lastModelError)) {
      return [...projector.modelUnavailable(notice), ...projector.finish()];
    }
    if (notice) return projector.finish(notice);
    return projector.finish();
  }
  if (sessionManager && consumeStreamDegeneration(sessionManager as never)) {
    return projector.finish(streamDegenerationAbortedMessage(locale));
  }
  if (sessionManager) {
    return projector.finish(resolveEmptyAssistantError(sessionManager as never, locale));
  }
  return projector.finish();
}

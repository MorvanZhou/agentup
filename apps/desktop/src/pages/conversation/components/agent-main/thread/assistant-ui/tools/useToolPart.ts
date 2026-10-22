import { computed } from "vue";
import { useAuiState } from "@assistant-ui/vue";
import type {} from "@assistant-ui/core/store";

import { formatElapsedMs } from "../../../../../model/message/elapsed";
import { injectPendingAskUserToolCallId } from "../../../../../model/thread/thread-ask-user";
import { injectPendingApprovalToolCallId } from "../../../../../model/thread/thread-approval";
import {
  formatToolResult,
  isInterruptedToolOutput,
  isToolProgressActive,
} from "./tool-args";

export function useToolPart() {
  const part = useAuiState((s) => (s.part.type === "tool-call" ? s.part : null));
  const threadIsRunning = useAuiState((s) => s.thread.isRunning);
  const pendingApprovalToolCallId = injectPendingApprovalToolCallId();
  const pendingAskUserToolCallId = injectPendingAskUserToolCallId();
  const statusType = computed(() => part.value?.status?.type ?? "complete");
  const isRunning = computed(() => statusType.value === "running");
  const args = computed(() => part.value?.args ?? {});
  const argsText = computed(() => part.value?.argsText ?? "");
  const resultText = computed(() =>
    part.value?.result === undefined ? "" : formatToolResult(part.value.result),
  );
  const hasResult = computed(() => part.value?.result !== undefined);
  const awaitingApproval = computed(
    () =>
      Boolean(
        part.value?.toolCallId &&
          pendingApprovalToolCallId.value &&
          part.value.toolCallId === pendingApprovalToolCallId.value,
      ),
  );
  const awaitingAskUser = computed(
    () =>
      Boolean(
        part.value?.toolCallId &&
          pendingAskUserToolCallId.value &&
          part.value.toolCallId === pendingAskUserToolCallId.value,
      ),
  );
  /**
   * 用户停止后浮层已清、线程已停、工具仍无结果 → 视为中断。
   * 仍在等待 HITL 时不标记（问卷/审批进行中）。
   */
  const isHitlStopped = computed(() => {
    if (hasResult.value || threadIsRunning.value) return false;
    if (awaitingAskUser.value || awaitingApproval.value) return false;
    if (part.value?.toolName === "ask_user") return true;
    return (
      statusType.value === "requires-action" ||
      statusType.value === "incomplete" ||
      statusType.value === "running"
    );
  });
  const isCancelled = computed(
    () =>
      (part.value?.status?.type === "incomplete" &&
        part.value.status.reason === "cancelled") ||
      isHitlStopped.value,
  );
  /** 应用退出后愈合的中断结果；不按硬错误扫光/标红。 */
  const isInterrupted = computed(
    () =>
      isInterruptedToolOutput(part.value?.result) ||
      isInterruptedToolOutput(resultText.value) ||
      isHitlStopped.value,
  );
  const isError = computed(
    () =>
      !isInterrupted.value &&
      (part.value?.isError === true ||
        (part.value?.status?.type === "incomplete" &&
          part.value.status.reason === "error")),
  );
  const isActive = computed(() =>
    isToolProgressActive(statusType.value, {
      cancelled: isCancelled.value || isInterrupted.value,
      error: isError.value,
      hasResult: hasResult.value,
      isPreliminary: part.value?.isPreliminary === true,
      awaitingApproval: awaitingApproval.value || awaitingAskUser.value,
    }),
  );
  const toolName = computed(() => part.value?.toolName ?? "");

  const duration = computed(() => {
    const timing = part.value?.timing;
    if (!timing) return undefined;
    const end = timing.completedAt ?? Date.now();
    return formatElapsedMs(end - timing.startedAt);
  });

  return {
    part,
    statusType,
    isRunning,
    isActive,
    isCancelled,
    isInterrupted,
    isError,
    args,
    argsText,
    resultText,
    hasResult,
    awaitingApproval,
    awaitingAskUser,
    toolName,
    duration,
  };
}

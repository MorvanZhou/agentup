import { isLocalAgentId } from "../../../local/agents/local-agent.js";
import { PERSONAL_ASSISTANT_ID } from "../../../local/assistant/personal-assistant.js";
import { deliveryDirName } from "../../tools/deliver-artifacts.js";
import type { AsyncWakeItem } from "../../wake/index.js";
import type { DelegationStore } from "../store.js";
import { DELEGATION_RESULT_CUSTOM_TYPE, type DelegationTask } from "../types.js";
import { isTerminalStatus } from "./helpers.js";

/**
 * 异步结果 → 空闲唤醒队列（Pi display:false + triggerTurn）。
 * 不再 appendCustomMessageEntry 进可见历史。
 * sync（wait=true）结果已作 tool result，不走 wake。
 */
export function notifyParent(
  store: DelegationStore,
  enqueueWake: ((item: AsyncWakeItem) => void) | undefined,
  task: DelegationTask,
): void {
  if (task.wait || task.notified) return;
  if (
    task.status !== "completed" &&
    task.status !== "failed" &&
    task.status !== "cancelled"
  ) {
    return;
  }
  if (!enqueueWake) return;
  const personal = task.fromAgentId === PERSONAL_ASSISTANT_ID;
  const kind: AsyncWakeItem["kind"] = personal
    ? "personal"
    : isLocalAgentId(task.fromAgentId)
      ? "local"
      : "recruited";
  const artifactNote =
    task.artifacts && task.artifacts.length > 0
      ? `\n\n已确认投递 ${task.artifacts.length} 个产物到你的 ARTIFACT/${deliveryDirName(task.toAgentId, task.toAgentName)}/。`
      : task.artifacts
        ? "\n\n专家确认本次无产物需要投递。"
        : "";
  const body =
    task.status === "completed"
      ? `【委托完成】专家「${task.toAgentName}」（${task.toAgentId}）已完成子任务。\n\n` +
        `任务：${task.brief}\n\n结果：\n${task.resultSummary ?? ""}${artifactNote}`
      : task.status === "cancelled"
        ? `【委托已取消】专家「${task.toAgentName}」（${task.toAgentId}）的子任务已停止。\n\n` +
          `任务：${task.brief}` +
          (task.resultSummary ? `\n\n部分输出：\n${task.resultSummary}` : "") +
          artifactNote
        : `【委托失败】专家「${task.toAgentName}」（${task.toAgentId}）未能完成子任务。\n\n` +
          `任务：${task.brief}\n\n原因：${task.error ?? "未知错误"}` +
          (task.resultSummary ? `\n\n部分输出：\n${task.resultSummary}` : "") +
          artifactNote;
  enqueueWake({
    id: `delegation:${task.id}`,
    userId: task.userId,
    agentId: task.fromAgentId,
    kind,
    urgency: task.status === "completed" ? "batch" : "immediate",
    body,
    details: {
      customType: DELEGATION_RESULT_CUSTOM_TYPE,
      taskId: task.id,
      toAgentId: task.toAgentId,
      toAgentName: task.toAgentName,
      status: task.status,
      artifactCount: task.artifacts?.length ?? 0,
    },
    markDelivered: () => {
      store.update(task.id, { notified: true });
    },
  });
}

/** sync 委托结果已交付给父 turn，勿再占 unseen 或触发 wake。 */
export function settleIfSync(store: DelegationStore, task: DelegationTask): DelegationTask {
  if (!task.wait || !isTerminalStatus(task.status)) return task;
  if (task.seen && task.notified) return task;
  return store.update(task.id, { seen: true, notified: true }) ?? task;
}

/**
 * 终态收尾：async → wake；sync → 直接标 seen/notified（结果已在 tool result）。
 */
export function afterTerminal(
  store: DelegationStore,
  enqueueWake: ((item: AsyncWakeItem) => void) | undefined,
  task: DelegationTask | undefined,
): void {
  if (!task || !isTerminalStatus(task.status)) return;
  if (task.wait) {
    settleIfSync(store, task);
    return;
  }
  notifyParent(store, enqueueWake, task);
}

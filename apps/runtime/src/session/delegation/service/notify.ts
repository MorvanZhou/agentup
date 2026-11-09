import { isLocalAgentId } from "../../../local/agents/local-agent.js";
import { PERSONAL_ASSISTANT_ID } from "../../../local/assistant/personal-assistant.js";
import { deliveryDirName, mapStagedToParentPaths } from "../../tools/deliver-artifacts.js";
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
  onGroup?: (task: DelegationTask) => void,
): void {
  if (task.wait || task.notified) return;
  if (task.groupId) {
    onGroup?.(task);
    // 群活回群执掌会话，不进一对一 wake；同时标 seen，避免桌面 unseen 轮询当成私聊完成。
    store.update(task.id, { notified: true, seen: true });
    return;
  }
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
  const delivered = resolveWakeDeliveredPaths(task);
  const artifactNote = delivered
    ? `\n\n已确认投递 ${delivered.length} 个产物到你的 ARTIFACT/${deliveryDirName(task.toAgentId, task.toAgentName)}/：\n` +
      delivered.map((item) => `- ${item.path}`).join("\n") +
      `\n它们会自动出现在你这轮回复下方的交付网格；若要增删展示，调用 present_artifacts。`
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
 * 旧盘：群终态曾只标 notified、未标 seen，会反复进桌面一对一 unseen。
 * 已回群（notified）的才愈合；未 notified 的仍走 notifyParent → onGroup。
 */
export function settleGroupIfNotified(
  store: DelegationStore,
  task: DelegationTask,
): DelegationTask {
  if (!task.groupId || !isTerminalStatus(task.status)) return task;
  if (!task.notified || task.seen) return task;
  return store.update(task.id, { seen: true }) ?? task;
}

/** wake 文案用的父侧路径：已落盘优先，否则按 staging 预测。 */
export function resolveWakeDeliveredPaths(
  task: DelegationTask,
): { path: string; size?: number }[] | undefined {
  if (task.deliveredPaths && task.deliveredPaths.length > 0) return task.deliveredPaths;
  if (!task.artifacts || task.artifacts.length === 0) return undefined;
  if (task.groupId) {
    return task.artifacts.filter((item) => item.path.startsWith("ARTIFACT/"));
  }
  try {
    return mapStagedToParentPaths({
      toAgentId: task.toAgentId,
      toAgentName: task.toAgentName,
      staged: task.artifacts,
    });
  } catch {
    return task.artifacts;
  }
}

/**
 * 终态收尾：async → wake；sync → 直接标 seen/notified（结果已在 tool result）。
 */
export function afterTerminal(
  store: DelegationStore,
  enqueueWake: ((item: AsyncWakeItem) => void) | undefined,
  task: DelegationTask | undefined,
  onGroup?: (task: DelegationTask) => void,
): void {
  if (!task || !isTerminalStatus(task.status)) return;
  if (task.wait) {
    settleIfSync(store, task);
    return;
  }
  notifyParent(store, enqueueWake, task, onGroup);
}

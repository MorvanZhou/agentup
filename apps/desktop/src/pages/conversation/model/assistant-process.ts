import { tf } from "../../../shared/model/ui-locale";
import { formatElapsedMs } from "./elapsed";
import { isPartProgressActive, type TurnProgressPart } from "./turn-progress";
import { isTodoPart, todoPlacement } from "./todo-list";

/** 混合时间线：text / HITL 外露，连续非 text 收成折叠段。 */
export type AssistantTimelineItem =
  | { kind: "text"; index: number }
  | { kind: "hitl"; index: number }
  | {
      kind: "group";
      /** 以段首 part 下标稳定标识，便于开合缓存。 */
      id: string;
      indices: number[];
      stepCount: number;
    };

export type AssistantTimeline = {
  items: AssistantTimelineItem[];
};

export type AssistantProcessPart = {
  type: string;
  toolName?: string;
  toolCallId?: string;
  result?: unknown;
  status?: { type: string; reason?: string };
  isError?: boolean;
  isPreliminary?: boolean;
  timing?: { startedAt: number; completedAt?: number };
};

export type BuildAssistantTimelineOptions = {
  pendingAskUserToolCallId?: string;
  pendingApprovalToolCallId?: string;
};

/** 待答 ask_user / 待批审批：打断时间线，单独外露。 */
export function isPendingHitlPart(
  part: AssistantProcessPart | undefined,
  options: BuildAssistantTimelineOptions = {},
): boolean {
  if (!part || part.type !== "tool-call" || !part.toolCallId) return false;
  const { pendingAskUserToolCallId, pendingApprovalToolCallId } = options;
  if (
    pendingAskUserToolCallId &&
    part.toolCallId === pendingAskUserToolCallId
  ) {
    return true;
  }
  if (
    pendingApprovalToolCallId &&
    part.toolCallId === pendingApprovalToolCallId
  ) {
    return true;
  }
  return false;
}

/**
 * 须打断折叠、单独外露的 part：HITL，以及仍在推进的工具
 *（折叠默认关闭时，Write 等流式进度仍要看得见）。
 */
export function isTimelineExposedPart(
  part: AssistantProcessPart | undefined,
  options: BuildAssistantTimelineOptions = {},
): boolean {
  if (!part || part.type !== "tool-call") return false;
  if (isPendingHitlPart(part, options)) return true;
  return isPartProgressActive(part as TurnProgressPart);
}

/**
 * 多次 todo 只保留第一次调用那一张在时间线里；后续快照隐藏
 *（结束后 TodoPanel / dock 另展示）。
 */
export function hiddenTodoIndices(parts: readonly AssistantProcessPart[]): Set<number> {
  const place = todoPlacement(parts);
  const hidden = new Set<number>();
  if (!place) return hidden;
  parts.forEach((part, index) => {
    if (isTodoPart(part) && index !== place.anchorIndex) hidden.add(index);
  });
  return hidden;
}

/** 从 message.parts 切出混合时间线；无过程段时 items 可仅含 text。 */
export function buildAssistantTimeline(
  parts: readonly AssistantProcessPart[],
  options: BuildAssistantTimelineOptions = {},
): AssistantTimeline {
  const hidden = hiddenTodoIndices(parts);
  const items: AssistantTimelineItem[] = [];
  let groupIndices: number[] = [];

  const flushGroup = () => {
    if (groupIndices.length === 0) return;
    const indices = groupIndices;
    groupIndices = [];
    items.push({
      kind: "group",
      id: `g-${indices[0]}`,
      indices,
      stepCount: indices.length,
    });
  };

  parts.forEach((part, index) => {
    if (hidden.has(index)) return;
    if (part.type === "text") {
      flushGroup();
      items.push({ kind: "text", index });
      return;
    }
    if (isTimelineExposedPart(part, options)) {
      flushGroup();
      items.push({ kind: "hitl", index });
      return;
    }
    groupIndices.push(index);
  });
  flushGroup();

  return { items };
}

/** 是否存在至少一个折叠段（需要过程 UI）。 */
export function hasProcessGroups(timeline: AssistantTimeline): boolean {
  return timeline.items.some((item) => item.kind === "group");
}

/** 段内是否有仍在推进的 part（用于 stream 中整段打开）。 */
export function groupHasRunningPart(
  parts: readonly AssistantProcessPart[],
  indices: readonly number[],
): boolean {
  return indices.some((index) => {
    const part = parts[index];
    if (!part) return false;
    return isPartProgressActive(part as TurnProgressPart);
  });
}

/**
 * 过程段默认是否展开。
 * 默认关闭；进行中的工具已由时间线外露，不必靠整段自动打开。
 */
export function isProcessGroupDefaultOpen(
  _streaming: boolean,
  _hasRunningPart: boolean,
): boolean {
  return false;
}

/** 折叠触发旁的段耗时；任一段内 part 未完成则不展示。 */
export function formatGroupDuration(
  parts: readonly AssistantProcessPart[],
  indices: readonly number[],
): string | undefined {
  let startedAt = Infinity;
  let completedAt = -Infinity;
  let found = false;
  for (const index of indices) {
    const part = parts[index];
    if (!part?.timing) continue;
    const end = part.timing.completedAt;
    if (typeof end !== "number") return undefined;
    found = true;
    startedAt = Math.min(startedAt, part.timing.startedAt);
    completedAt = Math.max(completedAt, end);
  }
  if (!found) return undefined;
  return formatElapsedMs(completedAt - startedAt);
}

/** 折叠触发文案；有耗时时并入同一可读标签（如 `3 个步骤 · 2.0s`）。 */
export function processGroupTriggerLabel(
  stepCount: number,
  duration?: string,
): string {
  const elapsed = duration?.trim();
  return elapsed
    ? tf("processStepsWithDuration", { n: stepCount, duration: elapsed })
    : tf("processSteps", { n: stepCount });
}

/**
 * Assistant 气泡副产物 tabs：主产物 summary + 可注册副产物。
 * 副产物从 parts / metadata 加工；summary 边界来自 runtime agentUpSummary。
 */

import { t } from "../../../shared/model/ui-locale";
import { extractAssistAgents, type AssistAgentRef } from "./message-assistants";
import {
  isPlanComplete,
  planFromTodoParts,
  type TodoListItem,
  type TodoPartRef,
  type TodoPlan,
} from "./todo-list";

export type ByproductTabId = "summary" | "todo" | "process" | "subagents";

export type AgentUpSummaryRef = {
  textPartId?: string;
  textPartIndex: number;
};

export type ByproductTabModel = {
  id: ByproductTabId;
  /** 文字 tab 文案；subagents 用叠放头像作 trigger，可为空。 */
  label: string;
  order: number;
};

export type AssistantByproductState = {
  tabs: ByproductTabModel[];
  /** 可见 tab ≤1 时不展示顶栏。 */
  showTabBar: boolean;
  defaultTabId: ByproductTabId;
  summary: AgentUpSummaryRef | null;
  /** 主产物对应的 parts 绝对下标。 */
  summaryPartIndex: number | undefined;
  todoPlan: TodoPlan | undefined;
  todoItems: TodoListItem[];
  assists: AssistAgentRef[];
};

type PartLike = {
  type?: string;
  text?: string;
  id?: string;
  toolName?: string;
};

export type BuildByproductOptions = {
  parts: readonly PartLike[];
  metadata?: unknown;
  streaming: boolean;
};

const TAB_ORDER: Record<ByproductTabId, number> = {
  summary: 1,
  todo: 2,
  process: 3,
  subagents: 4,
};

function tabLabel(id: ByproductTabId): string {
  if (id === "summary") return t("tabSummary");
  if (id === "todo") return t("tabTodo");
  if (id === "process") return t("tabProcess");
  return "";
}

/** 从 UIMessage.metadata 读出主产物引用。 */
export function readAgentUpSummary(metadata: unknown): AgentUpSummaryRef | null {
  if (!metadata || typeof metadata !== "object") return null;
  const custom = (metadata as { custom?: unknown }).custom;
  const raw =
    custom && typeof custom === "object"
      ? (custom as { agentUpSummary?: unknown }).agentUpSummary
      : (metadata as { agentUpSummary?: unknown }).agentUpSummary;
  if (!raw || typeof raw !== "object") return null;
  const index = (raw as { textPartIndex?: unknown }).textPartIndex;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0) return null;
  const textPartId = (raw as { textPartId?: unknown }).textPartId;
  return {
    textPartIndex: index,
    ...(typeof textPartId === "string" && textPartId ? { textPartId } : {}),
  };
}

/** 非空 text part 的绝对下标列表（与 runtime 序数对齐）。 */
export function nonEmptyTextPartIndices(parts: readonly PartLike[]): number[] {
  const indices: number[] = [];
  parts.forEach((part, index) => {
    if (part.type === "text" && typeof part.text === "string" && part.text) {
      indices.push(index);
    }
  });
  return indices;
}

/** 解析主产物在 parts 中的绝对下标。 */
export function resolveSummaryPartIndex(
  parts: readonly PartLike[],
  summary: AgentUpSummaryRef | null,
): number | undefined {
  if (!summary) return undefined;
  if (summary.textPartId) {
    const byId = parts.findIndex(
      (part) => part.type === "text" && part.id === summary.textPartId,
    );
    if (byId >= 0) return byId;
  }
  const texts = nonEmptyTextPartIndices(parts);
  return texts[summary.textPartIndex];
}

function hasProcessExtras(parts: readonly PartLike[], summaryPartIndex: number | undefined): boolean {
  if (parts.length === 0) return false;
  if (summaryPartIndex === undefined) return parts.length > 0;
  if (parts.length > 1) return true;
  return parts.some((part, index) => index !== summaryPartIndex || part.type !== "text");
}

function todoPlanFromParts(parts: readonly PartLike[]): TodoPlan | undefined {
  const refs: TodoPartRef[] = parts.map((part) => {
    if (part.type !== "tool-call" && part.type !== "dynamic-tool") {
      return { type: part.type ?? "" };
    }
    return {
      type: "tool-call",
      toolName: part.toolName,
      result: (part as { result?: unknown; output?: unknown }).result
        ?? (part as { output?: unknown }).output,
    };
  });
  return planFromTodoParts(refs);
}

/**
 * 无 runtime 标记时：结束后回退为最后一段非空 text（兼容直播漏 metadata / 旧消息）。
 */
export function resolveSummaryRef(
  parts: readonly PartLike[],
  metadata: unknown,
  streaming: boolean,
): AgentUpSummaryRef | null {
  if (streaming) return null;
  const fromMeta = readAgentUpSummary(metadata);
  if (fromMeta) return fromMeta;
  const texts = nonEmptyTextPartIndices(parts);
  if (texts.length === 0) return null;
  return { textPartIndex: texts.length - 1 };
}

/** 组装本条消息可见 tabs 与默认选中。 */
export function buildAssistantByproducts(options: BuildByproductOptions): AssistantByproductState {
  const { parts, metadata, streaming } = options;
  const summary = resolveSummaryRef(parts, metadata, streaming);
  const summaryPartIndex = resolveSummaryPartIndex(parts, summary);
  const todoPlan = todoPlanFromParts(parts);
  const showTodoTab =
    !streaming && Boolean(todoPlan) && isPlanComplete(todoPlan!, streaming);
  const assists = extractAssistAgents(parts);
  // 流式中始终有过程视角；结束后仅当还有总结之外的内容时保留过程 tab
  const processVisible =
    streaming || hasProcessExtras(parts, summaryPartIndex);

  const visible: ByproductTabId[] = [];
  if (summary && summaryPartIndex !== undefined) visible.push("summary");
  if (showTodoTab) visible.push("todo");
  if (processVisible) visible.push("process");
  if (assists.length > 0) visible.push("subagents");

  const tabs: ByproductTabModel[] = visible.map((id) => ({
    id,
    label: tabLabel(id),
    order: TAB_ORDER[id],
  }));
  tabs.sort((left, right) => left.order - right.order);

  const defaultTabId: ByproductTabId =
    tabs.some((tab) => tab.id === "summary")
      ? "summary"
      : tabs.some((tab) => tab.id === "process")
        ? "process"
        : (tabs[0]?.id ?? "process");

  return {
    tabs,
    showTabBar: tabs.length > 1,
    defaultTabId,
    summary,
    summaryPartIndex,
    todoPlan,
    todoItems: todoPlan?.items ?? [],
    assists,
  };
}

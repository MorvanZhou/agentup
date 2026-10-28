/**
 * 群委派气泡唯一一层 tab。
 * 简述来自群卡片；总结与副产物来自按需读取的子任务 history。
 */

import { t } from "../../../../shared/model/ui/ui-locale";
import type {
  AssistantByproductState,
  ByproductTabId,
  ByproductTabModel,
} from "../message/message-byproducts";

export type DelegationOuterTabId = "brief" | ByproductTabId;

export type DelegationOuterTab = {
  id: DelegationOuterTabId;
  label: string;
  badge?: string;
};

export type DelegationOuterTabState = {
  tabs: DelegationOuterTab[];
  /** 可见 tab ≤1 时不展示顶栏。 */
  showTabBar: boolean;
  defaultTabId: DelegationOuterTabId | null;
};

const OUTER_ORDER: DelegationOuterTabId[] = [
  "summary",
  "artifacts",
  "todo",
  "process",
  "subagents",
  "brief",
];

const TERMINAL_DELEGATION_STATUS = new Set(["completed", "failed", "cancelled"]);

/**
 * 切到「任务」会停掉旁路 SSE，本地 streaming 变成 false，子任务却可能还在跑。
 * 未终态时继续按直播处理，避免半截正文被回落成总结 tab。
 */
export function delegationByproductsAreLive(input: {
  streaming: boolean;
  taskStatus?: string | null;
}): boolean {
  if (input.streaming) return true;
  return !TERMINAL_DELEGATION_STATUS.has(input.taskStatus ?? "");
}

function outerLabel(id: DelegationOuterTabId): string {
  if (id === "brief") return t("groupTaskTabBrief");
  return "";
}

function productTab(id: ByproductTabId, byproducts: AssistantByproductState | null): ByproductTabModel | undefined {
  return byproducts?.tabs.find((tab) => tab.id === id);
}

/** 初次展示优先可打开的过程；history 到达后不强制改写宿主当前选项。 */
export function buildDelegationOuterTabs(input: {
  brief: string;
  canOpenProcess: boolean;
  byproducts: AssistantByproductState | null;
}): DelegationOuterTabState {
  const visible = new Set<DelegationOuterTabId>();
  if (input.brief.trim()) visible.add("brief");
  if (input.canOpenProcess) visible.add("process");
  for (const tab of input.byproducts?.tabs ?? []) {
    if (tab.id !== "process") visible.add(tab.id);
  }

  const tabs = OUTER_ORDER.filter((id) => visible.has(id)).map((id) => {
    const product = id === "brief" ? undefined : productTab(id, input.byproducts);
    return {
      id,
      label: id === "brief" ? outerLabel(id) : (product?.label ?? t("tabProcess")),
      ...(product?.badge ? { badge: product.badge } : {}),
    };
  });
  const defaultTabId: DelegationOuterTabId | null = visible.has("process")
      ? "process"
      : visible.has("brief")
        ? "brief"
        : null;

  return {
    tabs,
    showTabBar: tabs.length > 1,
    defaultTabId,
  };
}

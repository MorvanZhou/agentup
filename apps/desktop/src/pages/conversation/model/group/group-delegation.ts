import type { ComputedRef, InjectionKey } from "vue";

/** 群时间线里的一张子 Agent 卡片。过程正文不在这里，按 taskId 再取。 */
export type GroupDelegationCard = {
  id: string;
  taskId: string;
  authorId: string;
  authorName: string;
  avatarUrl?: string;
  role?: string;
  brief: string;
  summary: string;
  activity: "queued" | "running";
  handoff: "pending" | "consumed";
  outcome?: "completed" | "failed" | "cancelled";
};

export type GroupDelegationPhase =
  | "queued"
  | "running"
  | "waiting"
  | "pending_summary"
  | "completed"
  | "failed"
  | "cancelled";

/** 执行态在任务上，是否已汇总在群消息上，等人处理由当前 HITL 决定。 */
export function groupDelegationPhase(
  card: Pick<GroupDelegationCard, "activity" | "handoff" | "outcome">,
  waiting: boolean,
): GroupDelegationPhase {
  if (!card.outcome) {
    if (waiting) return "waiting";
    return card.activity === "queued" ? "queued" : "running";
  }
  if (card.outcome === "completed" && card.handoff !== "consumed") return "pending_summary";
  if (card.outcome === "failed" || card.outcome === "cancelled") return card.outcome;
  return "completed";
}

export const groupDelegationCardsKey = Symbol("groupDelegationCards") as InjectionKey<
  ComputedRef<GroupDelegationCard[]>
>;

export const groupWaitingTaskIdsKey = Symbol("groupWaitingTaskIds") as InjectionKey<
  ComputedRef<string[]>
>;

export const groupDelegationRuntimeKey = Symbol("groupDelegationRuntime") as InjectionKey<
  ComputedRef<{ token: string; userId: string; baseUrl?: string }>
>;

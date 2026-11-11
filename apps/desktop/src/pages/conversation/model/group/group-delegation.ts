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
  /** complete_group_task.user_summary：给人看的短结果；旧卡可缺。 */
  userSummary?: string;
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

/**
 * 从消息 metadata.custom.delegation 收成卡片。
 * 必须保留 userSummary：总结 tab 靠它，丢掉会回落到 history 长自述。
 */
export function readGroupDelegationCard(value: unknown): GroupDelegationCard | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<GroupDelegationCard>;
  const userSummary =
    typeof raw.userSummary === "string" && raw.userSummary.trim()
      ? raw.userSummary.trim()
      : undefined;
  return {
    id: typeof raw.id === "string" ? raw.id : "",
    taskId: typeof raw.taskId === "string" ? raw.taskId : "",
    authorId: typeof raw.authorId === "string" ? raw.authorId : "",
    authorName: typeof raw.authorName === "string" ? raw.authorName : "",
    avatarUrl: typeof raw.avatarUrl === "string" ? raw.avatarUrl : undefined,
    role: typeof raw.role === "string" ? raw.role : undefined,
    brief: typeof raw.brief === "string" ? raw.brief : "",
    summary: typeof raw.summary === "string" ? raw.summary : "",
    ...(userSummary ? { userSummary } : {}),
    activity: raw.activity === "queued" ? "queued" : "running",
    handoff: raw.handoff === "consumed" ? "consumed" : "pending",
    outcome:
      raw.outcome === "completed" || raw.outcome === "failed" || raw.outcome === "cancelled"
        ? raw.outcome
        : undefined,
  };
}

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

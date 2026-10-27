import type { AgentCard } from "../../../../shared/model/runtime/runtime";
import { t, tf } from "../../../../shared/model/ui/ui-locale";
import type { DelegationPresence } from "./delegation-presence";

/** 会话侧栏一行：展示与检索所需字段已在此收齐。 */
export interface ConversationRow {
  agent: AgentCard;
  preview: string;
  selected: boolean;
  busy: boolean;
  /** 该会话正等待本机用户审批工具。 */
  awaitingApproval: boolean;
  /** 该会话正等待本机用户回答 ask_user。 */
  awaitingAskUser: boolean;
  /**
   * 委托出去的子 Agent 正等待授权 / 回答（本会话无 Dock，仅侧栏提醒）。
   * 异步委托时 HITL 挂在子会话，主 Agent 靠此置顶提示。
   */
  awaitingChildHitl: boolean;
  /** 子 Agent 展示名（备注 / 原名），供提醒文案。 */
  childHitlName: string;
  /** 子 HITL 是审批还是提问（影响文案）。 */
  childHitlKind: "approval" | "ask" | "";
  /** 该会话的 Agent 回合仍在进行（流式回复 / 工具执行中）。 */
  working: boolean;
  /** 别人派来、仍在进行的异步委托条数。0 表示没有。 */
  incomingCount: number;
  /** 仅一笔时的派出方展示名；多笔或未知为空。 */
  incomingFromName: string;
  /** 本会话作为委托方，已派出的不同专家人数。0 表示没有。 */
  dispatchedCount: number;
  unread: number;
  hasUpdate: boolean;
  /** 最近一轮对话结束时间（毫秒）；无消息为 0。 */
  lastActiveAt: number;
  /** 备注名 / 原名 / 简介 / 最新消息，已小写，供本地搜索。 */
  searchText: string;
}

/** 默认中文文案；界面展示请用 conversationPreviewLabel / t()。 */
export const AWAITING_APPROVAL_PREVIEW = "等待你的批准";
export const AWAITING_ASK_USER_PREVIEW = "等待你的回答";

export type ChildHitlHint = {
  /** 子 Agent 展示名。 */
  name: string;
  kind: "approval" | "ask";
};

export function buildConversationRows(input: {
  conversations: AgentCard[];
  previews: Record<string, string>;
  lastActiveAt: Record<string, number>;
  selectedId: string;
  busyAgent: string;
  unread: Record<string, number>;
  /** 有待审批的 agentId 集合。 */
  awaitingApproval?: ReadonlySet<string> | readonly string[];
  /** 有待回答 ask_user 的 agentId 集合。 */
  awaitingAskUser?: ReadonlySet<string> | readonly string[];
  /** 父会话 → 子 HITL 提醒（异步委托挂在子、主 Agent 需置顶提示）。 */
  childHitlByParent?: ReadonlyMap<string, ChildHitlHint> | Record<string, ChildHitlHint>;
  /** 回合进行中的 agentId 集合。 */
  working?: ReadonlySet<string> | readonly string[];
  /** 全用户异步委托在场感；不参与置顶。 */
  delegationPresence?: DelegationPresence;
  /** 派出方展示名。空串时副文案改用「在做派来的活」。 */
  resolveAgentName?: (agentId: string) => string;
}): ConversationRow[] {
  const awaiting =
    input.awaitingApproval instanceof Set
      ? input.awaitingApproval
      : new Set(input.awaitingApproval ?? []);
  const awaitingAsk =
    input.awaitingAskUser instanceof Set
      ? input.awaitingAskUser
      : new Set(input.awaitingAskUser ?? []);
  const working =
    input.working instanceof Set ? input.working : new Set(input.working ?? []);
  const childHitl =
    input.childHitlByParent instanceof Map
      ? input.childHitlByParent
      : new Map(Object.entries(input.childHitlByParent ?? {}));
  const presence = input.delegationPresence;
  const resolveName = input.resolveAgentName ?? (() => "");
  const ranked = input.conversations.map((agent, index) => {
    const preview = input.previews[agent.agentId] ?? "";
    const child = childHitl.get(agent.agentId);
    const incoming = presence?.incoming[agent.agentId] ?? [];
    const fromNames = incoming
      .map((task) => resolveName(task.fromAgentId).trim())
      .filter(Boolean);
    return {
      index,
      row: {
        agent,
        preview,
        selected: agent.agentId === input.selectedId,
        busy: input.busyAgent === agent.agentId,
        awaitingApproval: awaiting.has(agent.agentId),
        awaitingAskUser: awaitingAsk.has(agent.agentId),
        awaitingChildHitl: Boolean(child),
        childHitlName: child?.name ?? "",
        childHitlKind: child?.kind ?? "",
        working: working.has(agent.agentId),
        incomingCount: incoming.length,
        incomingFromName: incoming.length === 1 ? (fromNames[0] ?? "") : "",
        dispatchedCount: presence?.dispatchedCount[agent.agentId] ?? 0,
        unread: input.unread[agent.agentId] ?? 0,
        hasUpdate: agent.latestVersion > agent.localVersion,
        lastActiveAt: input.lastActiveAt[agent.agentId] ?? 0,
        searchText: `${agent.remark}\n${agent.name}\n${agent.role}\n${agent.background}\n${preview}\n${fromNames.join("\n")}`.toLowerCase(),
      } satisfies ConversationRow,
    };
  });
  // 私人助理永远第一；其后：待授权/提问/子 HITL/未读 → 最近活跃。
  ranked.sort((left, right) => {
    if (left.row.agent.kind === "personal" && right.row.agent.kind !== "personal") return -1;
    if (right.row.agent.kind === "personal" && left.row.agent.kind !== "personal") return 1;
    const leftPin = attentionPinRank(left.row);
    const rightPin = attentionPinRank(right.row);
    if (leftPin !== rightPin) return leftPin - rightPin;
    const delta = right.row.lastActiveAt - left.row.lastActiveAt;
    return delta !== 0 ? delta : left.index - right.index;
  });
  return ranked.map((entry) => entry.row);
}

/** 越小越靠前；无注意力需求为 99。 */
function attentionPinRank(
  row: Pick<
    ConversationRow,
    "awaitingApproval" | "awaitingAskUser" | "awaitingChildHitl" | "unread"
  >,
): number {
  if (row.awaitingApproval || row.awaitingAskUser) return 0;
  if (row.awaitingChildHitl) return 1;
  if (row.unread > 0) return 2;
  return 99;
}

export function filterConversationRows(rows: ConversationRow[], query: string): ConversationRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) => row.searchText.includes(q));
}

/** 是否已有第三方已招募 Agent（私人助理不算）。用于侧栏「去市场招募」引导。 */
export function hasRecruitedMarketAgent(
  conversations: ReadonlyArray<Pick<AgentCard, "kind" | "agentId">>,
): boolean {
  return conversations.some((agent) => agent.kind !== "personal");
}

export function unreadLabel(count: number): string {
  if (count <= 0) return "";
  return count > 9 ? "9+" : String(count);
}

/**
 * 侧栏头像角标：未读 + 本会话 HITL（待批准 / 待回答）合成计数。
 * 父会话的子 HITL 提醒不计入；同一行审批与提问并存仍只 +1。
 */
export function attentionBadgeCount(
  row: Pick<ConversationRow, "unread" | "awaitingApproval" | "awaitingAskUser">,
): number {
  const unread =
    typeof row.unread === "number" && Number.isFinite(row.unread)
      ? Math.max(0, Math.floor(row.unread))
      : 0;
  const hitl = row.awaitingApproval || row.awaitingAskUser ? 1 : 0;
  return unread + hitl;
}

/** 各 agent 未读条数之和。 */
export function totalUnread(unread: Record<string, number>): number {
  let sum = 0;
  for (const count of Object.values(unread)) {
    if (typeof count === "number" && Number.isFinite(count) && count > 0) {
      sum += Math.floor(count);
    }
  }
  return sum;
}

/** Dock / 导航角标：有待审批或 ask_user 的 Agent 个数（含子 HITL 提醒的父会话）。 */
export function totalBlocked(
  awaitingApproval: ReadonlySet<string> | readonly string[],
  awaitingAskUser: ReadonlySet<string> | readonly string[] = [],
  childHitlParents: ReadonlySet<string> | readonly string[] = [],
): number {
  const ids = new Set<string>(
    awaitingApproval instanceof Set ? awaitingApproval : awaitingApproval,
  );
  for (const id of awaitingAskUser instanceof Set ? awaitingAskUser : awaitingAskUser) {
    ids.add(id);
  }
  for (const id of childHitlParents instanceof Set ? childHitlParents : childHitlParents) {
    ids.add(id);
  }
  return ids.size;
}

/**
 * 菜单栏图标右侧的数字：待审批/待回答的会话数，加上未读条数。
 * 只有其中一类时也要显示出数字。
 */
export function menuBarAttentionCount(blocked: number, unread: number): number {
  const whole = (count: number) =>
    typeof count === "number" && Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  return whole(blocked) + whole(unread);
}

/**
 * 主导航「消息」角标：与侧栏各行 `attentionBadgeCount` 之和一致。
 * 未读条数 + 有本会话 HITL（审批/提问）的 agent 数；不含仅子 HITL 提醒的父会话。
 */
export function totalAttentionBadge(
  unread: Record<string, number>,
  awaitingApproval: ReadonlySet<string> | readonly string[],
  awaitingAskUser: ReadonlySet<string> | readonly string[] = [],
): number {
  return totalUnread(unread) + totalBlocked(awaitingApproval, awaitingAskUser);
}

/** 侧栏副文案里的委托在场感。接活优先于派出；都没有则空串。 */
export function delegationPreviewText(input: {
  incomingCount?: number;
  incomingFromName?: string;
  dispatchedCount?: number;
}): string {
  const incomingCount = input.incomingCount ?? 0;
  if (incomingCount > 1) return tf("sideDelegatedMany", { count: incomingCount });
  if (incomingCount === 1) {
    const name = input.incomingFromName?.trim() ?? "";
    return name ? tf("sideDelegatedBy", { name }) : t("sideDelegatedGeneric");
  }
  const dispatchedCount = input.dispatchedCount ?? 0;
  if (dispatchedCount > 0) return tf("sideDispatched", { count: dispatchedCount });
  return "";
}

/** 侧栏副文案：待审批 / 待回答 / 子 HITL 提醒优先于委托在场感，再优先于消息预览。 */
export function conversationPreviewLabel(
  row: Pick<
    ConversationRow,
    | "awaitingApproval"
    | "awaitingAskUser"
    | "awaitingChildHitl"
    | "childHitlName"
    | "childHitlKind"
    | "preview"
  > & {
    incomingCount?: number;
    incomingFromName?: string;
    dispatchedCount?: number;
  },
): string {
  if (row.awaitingApproval) {
    if (row.childHitlKind === "approval" && row.childHitlName.trim()) {
      return tf("sideAwaitChildApproval", { name: row.childHitlName.trim() });
    }
    return t("sideAwaitApproval");
  }
  if (row.awaitingAskUser) {
    if (row.childHitlKind === "ask" && row.childHitlName.trim()) {
      return tf("sideAwaitChildAsk", { name: row.childHitlName.trim() });
    }
    return t("sideAwaitAsk");
  }
  if (row.awaitingChildHitl) {
    const name = row.childHitlName.trim();
    if (row.childHitlKind === "ask") {
      return name
        ? tf("sideAwaitChildAsk", { name })
        : t("sideAwaitChildAskGeneric");
    }
    return name
      ? tf("sideAwaitChildApproval", { name })
      : t("sideAwaitChildApprovalGeneric");
  }
  const delegation = delegationPreviewText(row);
  if (delegation) return delegation;
  return row.preview || t("sideNoMessages");
}

/** 侧栏与顶栏主标题：有备注名用备注名，否则用原名。 */
export function conversationDisplayName(row: Pick<ConversationRow, "agent">): string {
  return row.agent.remark || row.agent.name;
}

/**
 * 委托 HITL 已挂在跟进会话上时，用发起专家的名字标注该会话。
 * 直聊（展示归属就是发起方）不产生这条提醒。
 */
export function childHitlHintsFromAttention(input: {
  approvals: ReadonlyArray<{
    agentId: string;
    originAgentId?: string;
    parentAgentId?: string;
    askedByName?: string;
  }>;
  askUsers: ReadonlyArray<{
    agentId: string;
    originAgentId?: string;
    parentAgentId?: string;
    askedByName?: string;
  }>;
  resolveName: (agentId: string) => string;
}): Map<string, ChildHitlHint> {
  const hints = new Map<string, ChildHitlHint>();
  const consider = (
    item: {
      agentId: string;
      originAgentId?: string;
      askedByName?: string;
    },
    kind: "approval" | "ask",
  ) => {
    const origin = item.originAgentId?.trim();
    if (!origin || origin === item.agentId) return;
    if (hints.has(item.agentId) && hints.get(item.agentId)!.kind === "approval") return;
    if (kind === "ask" && hints.has(item.agentId)) return;
    const name = item.askedByName?.trim() || input.resolveName(origin) || origin;
    hints.set(item.agentId, { kind, name });
  };
  for (const item of input.approvals) consider(item, "approval");
  for (const item of input.askUsers) consider(item, "ask");
  return hints;
}

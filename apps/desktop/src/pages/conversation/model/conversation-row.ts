import type { AgentCard } from "../../../shared/model/runtime";
import { t } from "../../../shared/model/ui-locale";

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
  /** 该会话的 Agent 回合仍在进行（流式回复 / 工具执行中）。 */
  working: boolean;
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
  /** 回合进行中的 agentId 集合。 */
  working?: ReadonlySet<string> | readonly string[];
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
  const ranked = input.conversations.map((agent, index) => {
    const preview = input.previews[agent.agentId] ?? "";
    return {
      index,
      row: {
        agent,
        preview,
        selected: agent.agentId === input.selectedId,
        busy: input.busyAgent === agent.agentId,
        awaitingApproval: awaiting.has(agent.agentId),
        awaitingAskUser: awaitingAsk.has(agent.agentId),
        working: working.has(agent.agentId),
        unread: input.unread[agent.agentId] ?? 0,
        hasUpdate: agent.latestVersion > agent.localVersion,
        lastActiveAt: input.lastActiveAt[agent.agentId] ?? 0,
        searchText: `${agent.remark}\n${agent.name}\n${agent.role}\n${agent.background}\n${preview}`.toLowerCase(),
      } satisfies ConversationRow,
    };
  });
  // 微信会话列表：最近有消息的置顶；同时间保持原相对顺序。
  ranked.sort((left, right) => {
    if (left.row.agent.kind === "personal" && right.row.agent.kind !== "personal") return -1;
    if (right.row.agent.kind === "personal" && left.row.agent.kind !== "personal") return 1;
    const delta = right.row.lastActiveAt - left.row.lastActiveAt;
    return delta !== 0 ? delta : left.index - right.index;
  });
  return ranked.map((entry) => entry.row);
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

/** 导航 / Dock 用：各 agent 未读条数之和（侧栏红点仍用；Dock 改用 totalBlocked）。 */
export function totalUnread(unread: Record<string, number>): number {
  let sum = 0;
  for (const count of Object.values(unread)) {
    if (typeof count === "number" && Number.isFinite(count) && count > 0) {
      sum += Math.floor(count);
    }
  }
  return sum;
}

/** Dock / 导航角标：有待审批或 ask_user 的 Agent 个数。 */
export function totalBlocked(
  awaitingApproval: ReadonlySet<string> | readonly string[],
  awaitingAskUser: ReadonlySet<string> | readonly string[] = [],
): number {
  const ids = new Set<string>(
    awaitingApproval instanceof Set ? awaitingApproval : awaitingApproval,
  );
  for (const id of awaitingAskUser instanceof Set ? awaitingAskUser : awaitingAskUser) {
    ids.add(id);
  }
  return ids.size;
}

/** 侧栏副文案：待审批 / 待回答优先于消息预览。 */
export function conversationPreviewLabel(
  row: Pick<ConversationRow, "awaitingApproval" | "awaitingAskUser" | "preview">,
): string {
  if (row.awaitingApproval) return t("sideAwaitApproval");
  if (row.awaitingAskUser) return t("sideAwaitAsk");
  return row.preview || t("sideNoMessages");
}

/** 侧栏与顶栏主标题：有备注名用备注名，否则用原名。 */
export function conversationDisplayName(row: Pick<ConversationRow, "agent">): string {
  return row.agent.remark || row.agent.name;
}

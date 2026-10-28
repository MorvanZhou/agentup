import type { GroupLine, GroupRoom } from "../../../../shared/api/runtime/groups";
import { t } from "../../../../shared/model/ui/ui-locale";

import {
  attentionBadgeCount,
  filterConversationRows,
  unreadLabel,
  type ConversationRow,
} from "./conversation-row";

/** 群侧栏 HITL：attention 里带 groupId 的审批 / 提问（含 shell hang 并入审批）。 */
export type GroupSidebarAttention = {
  awaitingApproval: ReadonlySet<string>;
  awaitingAskUser: ReadonlySet<string>;
};

/** 群侧栏一行：展示态已收齐，和单聊 ConversationRow 对齐。 */
export type GroupSidebarRow = {
  room: GroupRoom;
  preview: string;
  selected: boolean;
  /** phase 为 holding / task：执掌或子任务进行中。 */
  working: boolean;
  awaitingApproval: boolean;
  awaitingAskUser: boolean;
  /** 不在该群时回合结束累加；与单聊共用 state.unread，键为 groupUnreadKey。 */
  unread: number;
};

/**
 * 与 agentId 共用 unread 表时加前缀，避免短 ID 撞车。
 * 须符合 runtime state.json 的 AGENT_ID（`group:` 冒号会让 POST /state 400）。
 */
export function groupUnreadKey(groupId: string): string {
  return `group-${groupId}`;
}

export function readGroupUnread(
  unread: Record<string, number> | undefined,
  groupId: string,
): number {
  // 旧会话内存里可能仍是 group: 前缀；落盘只会是 group-。
  const raw = unread?.[groupUnreadKey(groupId)] ?? unread?.[`group:${groupId}`];
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
  return Math.max(0, Math.floor(raw));
}

/**
 * 群从 holding/task 落到 idle，且当前没打开该群 → 应 +1 未读。
 * 首见（无 prev）不记，避免冷启动把已有空闲群刷成未读。
 */
export function shouldBumpGroupUnread(input: {
  prevPhase: GroupRoom["phase"] | undefined;
  nextPhase: GroupRoom["phase"];
  groupId: string;
  selectedGroupId: string | null | undefined;
}): boolean {
  if (input.prevPhase === undefined) return false;
  if (input.selectedGroupId === input.groupId) return false;
  if (input.nextPhase !== "idle") return false;
  return input.prevPhase === "holding" || input.prevPhase === "task";
}

/**
 * 对照上一帧 phase，收集本帧该累加未读的群 id，并返回下一帧 phase 表。
 * `replace`：完整列表拉取，丢掉已不存在的群；`merge`：单群 live 更新，保留其它群。
 */
export function collectGroupUnreadBumps(
  prevPhases: Readonly<Record<string, GroupRoom["phase"]>>,
  rooms: ReadonlyArray<Pick<GroupRoom, "id" | "phase">>,
  selectedGroupId: string | null | undefined,
  mode: "merge" | "replace" = "merge",
): { phases: Record<string, GroupRoom["phase"]>; bumpIds: string[] } {
  const phases: Record<string, GroupRoom["phase"]> =
    mode === "replace" ? {} : { ...prevPhases };
  const bumpIds: string[] = [];
  const seen = new Set<string>();
  for (const room of rooms) {
    if (seen.has(room.id)) continue;
    seen.add(room.id);
    const prev = prevPhases[room.id];
    if (
      shouldBumpGroupUnread({
        prevPhase: prev,
        nextPhase: room.phase,
        groupId: room.id,
        selectedGroupId,
      })
    ) {
      bumpIds.push(room.id);
    }
    phases[room.id] = room.phase;
  }
  return { phases, bumpIds };
}

export type SidebarSlot =
  | { kind: "agent"; row: ConversationRow }
  | { kind: "group"; row: GroupSidebarRow };

/** 群在侧栏里的时间：最后一条可见消息。没有消息时沉到列表后部。 */
export function groupActivityAt(room: Pick<GroupRoom, "lines" | "updatedAt">): number {
  let at = 0;
  for (const line of room.lines ?? []) {
    if (line.role === "tool") continue;
    if (line.at > at) at = line.at;
  }
  return at || room.updatedAt || 0;
}

/** 执掌中或子任务中视为「对话进行中」。 */
export function groupIsWorking(room: Pick<GroupRoom, "phase">): boolean {
  return room.phase === "holding" || room.phase === "task";
}

export function buildGroupSidebarRow(input: {
  room: GroupRoom;
  selected: boolean;
  attention?: GroupSidebarAttention;
  unread?: Record<string, number>;
}): GroupSidebarRow {
  const awaitingApproval = input.attention?.awaitingApproval.has(input.room.id) === true;
  const awaitingAskUser = input.attention?.awaitingAskUser.has(input.room.id) === true;
  return {
    room: input.room,
    preview: groupSidebarPreview(input.room),
    selected: input.selected,
    working: groupIsWorking(input.room),
    awaitingApproval,
    awaitingAskUser,
    unread: readGroupUnread(input.unread, input.room.id),
  };
}

/** 侧栏副文案：最后一条已经发出的话，不含子任务工具过程。 */
export function groupSidebarPreview(room: Pick<GroupRoom, "lines">): string {
  const visible = (room.lines ?? []).filter((line) => line.role !== "tool");
  const last = visible[visible.length - 1];
  return last ? linePreview(last) : "";
}

/** 群侧栏副文案：待批准 / 待回答优先于消息预览。 */
export function groupSidebarPreviewLabel(
  row: Pick<GroupSidebarRow, "awaitingApproval" | "awaitingAskUser" | "preview">,
): string {
  if (row.awaitingApproval) return t("sideAwaitApproval");
  if (row.awaitingAskUser) return t("sideAwaitAsk");
  return row.preview || t("groupNoLines");
}

/** 群头像角标：未读 + 待批准 / 待回答合成计数。 */
export function groupAttentionBadgeCount(
  row: Pick<GroupSidebarRow, "unread" | "awaitingApproval" | "awaitingAskUser">,
): number {
  return attentionBadgeCount({
    unread: row.unread,
    awaitingApproval: row.awaitingApproval,
    awaitingAskUser: row.awaitingAskUser,
  });
}

export function groupUnreadLabel(
  row: Pick<GroupSidebarRow, "unread" | "awaitingApproval" | "awaitingAskUser" | "working">,
): string {
  const awaiting = row.awaitingApproval || row.awaitingAskUser;
  if (row.working && !awaiting) return "";
  return unreadLabel(groupAttentionBadgeCount(row));
}

/** 主导航角标：群 HITL 按「有待处理的群」个数计入（与侧栏角标一致）。 */
export function groupAttentionBlockedCount(attention: GroupSidebarAttention): number {
  const ids = new Set<string>([...attention.awaitingApproval, ...attention.awaitingAskUser]);
  return ids.size;
}

/**
 * 从 attention 快照抽出群 HITL 集合；shell hang 与审批同属「需用户点一下」。
 */
export function groupAttentionFromSnapshot(snap: {
  approvals?: ReadonlyArray<{ groupId?: string }>;
  askUsers?: ReadonlyArray<{ groupId?: string }>;
  shellHangs?: ReadonlyArray<{ groupId?: string }>;
}): GroupSidebarAttention {
  const awaitingApproval = new Set<string>();
  const awaitingAskUser = new Set<string>();
  for (const item of snap.approvals ?? []) {
    const id = item.groupId?.trim();
    if (id) awaitingApproval.add(id);
  }
  for (const item of snap.shellHangs ?? []) {
    const id = item.groupId?.trim();
    if (id) awaitingApproval.add(id);
  }
  for (const item of snap.askUsers ?? []) {
    const id = item.groupId?.trim();
    if (id) awaitingAskUser.add(id);
  }
  return { awaitingApproval, awaitingAskUser };
}

/**
 * 私人助理钉在最上。其余单聊和群按最近一条消息混排，和微信会话列表一样。
 * 待用户操作的群 / 单聊再按注意力置顶（在最近活跃之上）。
 */
export function mergeSidebarSlots(
  rows: ConversationRow[],
  groups: GroupRoom[],
  query: string,
  options?: {
    selectedGroupId?: string | null;
    attention?: GroupSidebarAttention;
    unread?: Record<string, number>;
  },
): SidebarSlot[] {
  const agents = filterConversationRows(rows, query);
  const q = query.trim().toLowerCase();
  const rooms = groups.filter((room) => !q || groupSearchText(room).includes(q));
  const personal = agents.filter((row) => row.agent.kind === "personal");
  const selectedGroupId = options?.selectedGroupId ?? null;
  const attention = options?.attention;
  const unread = options?.unread;
  const rest: Array<{ at: number; pin: number; slot: SidebarSlot }> = [
    ...agents
      .filter((row) => row.agent.kind !== "personal")
      .map((row) => ({
        at: row.lastActiveAt,
        pin: agentAttentionPin(row),
        slot: { kind: "agent" as const, row },
      })),
    ...rooms.map((room) => {
      const row = buildGroupSidebarRow({
        room,
        selected: room.id === selectedGroupId,
        attention,
        unread,
      });
      return {
        at: groupActivityAt(room),
        pin: groupAttentionPin(row),
        slot: { kind: "group" as const, row },
      };
    }),
  ];
  rest.sort((left, right) => {
    if (left.pin !== right.pin) return left.pin - right.pin;
    return right.at - left.at;
  });
  return [...personal.map((row) => ({ kind: "agent" as const, row })), ...rest.map((item) => item.slot)];
}

/** 越小越靠前；无注意力需求为 99。与单聊 attentionPinRank 同级。 */
function groupAttentionPin(
  row: Pick<GroupSidebarRow, "awaitingApproval" | "awaitingAskUser" | "unread">,
): number {
  if (row.awaitingApproval || row.awaitingAskUser) return 0;
  if (row.unread > 0) return 2;
  return 99;
}

function agentAttentionPin(
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

function groupSearchText(room: GroupRoom): string {
  return [room.title, groupSidebarPreview(room), ...room.members.map((member) => member.name)]
    .join("\n")
    .toLowerCase();
}

function linePreview(line: GroupLine): string {
  if (line.role === "delegation") return (line.summary || line.brief || line.authorName || line.text).trim();
  return line.text.trim();
}

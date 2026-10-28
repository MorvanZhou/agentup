import { computed, onScopeDispose, ref, watch } from "vue";

import { useDesktop } from "../../../app/desktop";
import { DesktopApi, DesktopApiError, runtimeBaseUrl } from "../../../shared/api/runtime";
import type {
  AttentionApproval,
  AttentionAskUser,
  AttentionShellHang,
  AttentionSnapshot,
} from "../../../shared/api/runtime/chat";
import type { GroupLive, GroupMember, GroupRoom } from "../../../shared/api/runtime/groups";
import type {
  AgentUpApprovalData,
  AgentUpAskUserData,
  AgentUpShellHangData,
  ApprovalScope,
  AskUserAnswer,
  ShellHangAction,
} from "../../../shared/model/chat/chat";
import { t, tf } from "../../../shared/model/ui/ui-locale";
import { showToast } from "../../../shared/model/ui/toast";
import { GROUP_MEMBER_MAX, GROUP_MEMBER_MIN } from "../model/group/group-limits";
import {
  collectGroupUnreadBumps,
  groupUnreadKey,
} from "../model/sidebar/group-sidebar";
import { THREAD_WINDOW_PAGE } from "../model/thread/thread-window";
import { useGroupHolderStream } from "./useGroupHolderStream";

function queueBehind<T extends { id: string; groupId?: string }>(
  items: ReadonlyArray<T>,
  item: T,
): number {
  const same = items.filter((entry) => entry.groupId === item.groupId);
  const index = same.findIndex((entry) => entry.id === item.id);
  if (index < 0) return 0;
  return same.length - index - 1;
}

/** 会话页侧栏里的群：和单聊同一列，点开后占右侧主区。 */
export function useConversationGroups() {
  const {
    session,
    conversations,
    attention,
    pulseGroups,
    pullAttention,
    bumpUnread,
    clearUnread,
  } = useDesktop();
  const api = new DesktopApi();
  const groups = ref<GroupRoom[]>([]);
  const earlier = ref<Record<string, boolean>>({});
  /** 上一帧各群 phase；首见只记不 bump，避免冷启动刷未读。 */
  const knownPhases = ref<Record<string, GroupRoom["phase"]>>({});
  const selectedGroupId = ref<string | null>(null);
  const liveTurnId = ref("");
  const creating = ref(false);
  /** 删除进行中时，直播结束不要再把已删的群拉回来。 */
  const deletingId = ref<string | null>(null);
  const title = ref("");
  const picked = ref<string[]>([]);
  const busy = ref(false);
  const askUser = ref<AgentUpAskUserData | undefined>();
  const approval = ref<AgentUpApprovalData | undefined>();
  const shellHang = ref<AgentUpShellHangData | undefined>();

  const roster = computed(() => conversations.value.filter((agent) => agent.kind !== "personal"));
  const openRoom = computed(
    () => groups.value.find((room) => room.id === selectedGroupId.value) ?? null,
  );
  const historyHasMore = computed(() => {
    const groupId = selectedGroupId.value;
    return groupId ? earlier.value[groupId] === true : false;
  });

  function applyRoom(prev: GroupRoom | undefined, next: GroupRoom): GroupRoom {
    if (!prev || next.lines.length === 0) {
      earlier.value = { ...earlier.value, [next.id]: next.lines.length === 0 ? false : next.linesHasMore === true };
      return next;
    }
    const anchor = next.lines[0]?.id;
    const index = anchor ? prev.lines.findIndex((line) => line.id === anchor) : -1;
    if (index < 0) {
      earlier.value = { ...earlier.value, [next.id]: next.linesHasMore === true };
      return next;
    }
    if (index === 0) {
      earlier.value = { ...earlier.value, [next.id]: next.linesHasMore === true };
    }
    return { ...next, lines: [...prev.lines.slice(0, index), ...next.lines] };
  }

  /** 对照 knownPhases：你不在的群从进行中落到 idle 则 +1；并刷新 phase 表。 */
  function notePhases(
    rooms: ReadonlyArray<Pick<GroupRoom, "id" | "phase">>,
    mode: "merge" | "replace",
  ): void {
    const { phases, bumpIds } = collectGroupUnreadBumps(
      knownPhases.value,
      rooms,
      selectedGroupId.value,
      mode,
    );
    knownPhases.value = phases;
    for (const groupId of bumpIds) void bumpUnread(groupUnreadKey(groupId));
  }

  /** 列表拉取后合并进侧栏；当前打开的群保留已翻历史。 */
  function mergeListedRooms(rooms: GroupRoom[]): void {
    notePhases(rooms, "replace");
    const prevById = new Map(groups.value.map((room) => [room.id, room]));
    const openId = selectedGroupId.value;
    groups.value = rooms.map((room) => {
      if (deletingId.value === room.id) return prevById.get(room.id) ?? room;
      const prev = prevById.get(room.id);
      if (prev && room.id === openId) return applyRoom(prev, room);
      return room;
    });
    const flags: Record<string, boolean> = { ...earlier.value };
    for (const room of rooms) {
      if (room.id === openId && prevById.has(room.id)) continue;
      flags[room.id] = room.linesHasMore === true;
    }
    earlier.value = flags;
  }

  function clearHitl(): void {
    askUser.value = undefined;
    approval.value = undefined;
    shellHang.value = undefined;
  }

  function setAskUser(value: AgentUpAskUserData | undefined): void {
    askUser.value = value;
  }

  function setApproval(value: AgentUpApprovalData | undefined): void {
    approval.value = value;
  }

  function setShellHang(value: AgentUpShellHangData | undefined): void {
    shellHang.value = value;
  }

  /** attention 里带 group_id 的 HITL 落到当前打开的群 Dock；切群或关闭时清掉。 */
  function syncHitlFromAttention(snap: AttentionSnapshot): void {
    const groupId = selectedGroupId.value;
    if (!groupId) {
      clearHitl();
      return;
    }
    applyGroupAsk(snap.askUsers.filter((item) => item.groupId === groupId));
    applyGroupApproval(snap.approvals.filter((item) => item.groupId === groupId));
    applyGroupShellHang(snap.shellHangs.filter((item) => item.groupId === groupId));
  }

  function applyGroupAsk(items: AttentionAskUser[]): void {
    const head = items[0];
    if (!head) {
      askUser.value = undefined;
      return;
    }
    const behind = queueBehind(items, head);
    const next: AgentUpAskUserData = {
      id: head.id,
      toolCallId: head.toolCallId,
      questions: head.questions,
      askedByName: head.askedByName,
      askedByAgentId: head.originAgentId,
      taskLabel: head.taskLabel,
      taskId: head.taskId,
      queueBehind: behind,
    };
    const current = askUser.value;
    if (
      current?.id === next.id &&
      current.askedByName === next.askedByName &&
      current.askedByAgentId === next.askedByAgentId &&
      current.taskLabel === next.taskLabel &&
      current.taskId === next.taskId &&
      current.queueBehind === next.queueBehind
    ) {
      return;
    }
    askUser.value = current?.id === next.id ? { ...current, ...next } : next;
  }

  function applyGroupApproval(items: AttentionApproval[]): void {
    const head = items[0];
    if (!head) {
      approval.value = undefined;
      return;
    }
    const behind = queueBehind(items, head);
    const next: AgentUpApprovalData = {
      id: head.id,
      toolCallId: head.toolCallId,
      toolName: head.toolName,
      args: head.args,
      askedByName: head.askedByName,
      askedByAgentId: head.originAgentId,
      taskLabel: head.taskLabel,
      taskId: head.taskId,
      queueBehind: behind,
    };
    const current = approval.value;
    if (
      current?.id === next.id &&
      current.askedByName === next.askedByName &&
      current.askedByAgentId === next.askedByAgentId &&
      current.taskLabel === next.taskLabel &&
      current.taskId === next.taskId &&
      current.queueBehind === next.queueBehind
    ) {
      return;
    }
    approval.value = current?.id === next.id ? { ...current, ...next } : next;
  }

  function applyGroupShellHang(items: AttentionShellHang[]): void {
    const head = items[0];
    if (!head) {
      shellHang.value = undefined;
      return;
    }
    const behind = queueBehind(items, head);
    const next: AgentUpShellHangData = {
      id: head.id,
      toolCallId: head.toolCallId,
      toolName: head.toolName,
      command: head.command,
      elapsedMs: head.elapsedMs,
      askedByName: head.askedByName,
      askedByAgentId: head.originAgentId,
      taskLabel: head.taskLabel,
      taskId: head.taskId,
      queueBehind: behind,
    };
    const current = shellHang.value;
    if (
      current?.id === next.id &&
      current.askedByName === next.askedByName &&
      current.askedByAgentId === next.askedByAgentId &&
      current.taskLabel === next.taskLabel &&
      current.taskId === next.taskId &&
      current.queueBehind === next.queueBehind &&
      current.elapsedMs === next.elapsedMs
    ) {
      return;
    }
    shellHang.value = current?.id === next.id ? { ...current, ...next } : next;
  }

  async function load(): Promise<void> {
    const current = session.value;
    if (!current) {
      groups.value = [];
      knownPhases.value = {};
      return;
    }
    try {
      const rooms = await api.listGroups(current.token, current.userId);
      mergeListedRooms(rooms);
      if (selectedGroupId.value && !groups.value.some((room) => room.id === selectedGroupId.value)) {
        selectedGroupId.value = null;
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("groupEmpty"), "error");
    }
  }

  function selectGroup(groupId: string): void {
    creating.value = false;
    if (selectedGroupId.value !== groupId) {
      liveTurnId.value = "";
      clearHitl();
    }
    selectedGroupId.value = groupId;
    void clearUnread(groupUnreadKey(groupId));
    syncHitlFromAttention(attention.value);
  }

  function beginCreate(): void {
    selectedGroupId.value = null;
    creating.value = true;
    clearHitl();
  }

  function closeSurface(): void {
    selectedGroupId.value = null;
    creating.value = false;
    liveTurnId.value = "";
    clearHitl();
  }

  function toggle(agentId: string): void {
    if (picked.value.includes(agentId)) {
      picked.value = picked.value.filter((id) => id !== agentId);
      return;
    }
    if (picked.value.length >= GROUP_MEMBER_MAX) {
      showToast(needMembersMessage(), "error");
      return;
    }
    picked.value = [...picked.value, agentId];
  }

  function needMembersMessage(): string {
    return tf("groupNeedMembers", { min: GROUP_MEMBER_MIN, max: GROUP_MEMBER_MAX });
  }

  async function create(): Promise<void> {
    const current = session.value;
    if (!current) return;
    const members: GroupMember[] = roster.value
      .filter((agent) => picked.value.includes(agent.agentId))
      .map((agent) => ({ agentId: agent.agentId, name: agent.name }));
    if (members.length < GROUP_MEMBER_MIN || members.length > GROUP_MEMBER_MAX) {
      showToast(needMembersMessage(), "error");
      return;
    }
    busy.value = true;
    try {
      const room = await api.createGroup(current.token, current.userId, title.value, members);
      groups.value = [applyRoom(undefined, room), ...groups.value.filter((item) => item.id !== room.id)];
      creating.value = false;
      selectedGroupId.value = room.id;
      notePhases([room], "merge");
      void clearUnread(groupUnreadKey(room.id));
      picked.value = [];
      title.value = "";
      clearHitl();
    } catch (error) {
      showToast(error instanceof Error ? error.message : needMembersMessage(), "error");
    } finally {
      busy.value = false;
    }
  }

  async function send(text: string): Promise<void> {
    await mutateLive((token, userId, room) => api.postGroupMessage(token, userId, room.id, text));
  }

  async function edit(messageId: string, text: string): Promise<void> {
    await mutateLive((token, userId, room) =>
      api.editGroupMessage(token, userId, room.id, messageId, text),
    );
  }

  async function cancelQueue(queueId: string): Promise<void> {
    await mutate((token, userId, room) =>
      api.cancelGroupQueue(token, userId, room.id, queueId),
    );
  }

  async function stop(): Promise<void> {
    clearHitl();
    await mutateLive((token, userId, room) => api.stopGroup(token, userId, room.id));
  }

  async function clearWorkspace(includeWork: boolean): Promise<void> {
    const current = session.value;
    const room = openRoom.value;
    if (!current || !room) return;
    try {
      await api.clearGroupWorkspace(current.token, current.userId, room.id, includeWork);
    } catch (error) {
      showToast(
        error instanceof Error && error.message ? error.message : t("groupClearWorkspaceFailed"),
        "error",
      );
      throw error;
    }
  }

  async function clearContext(): Promise<void> {
    clearHitl();
    await mutateLive((token, userId, room) => api.clearGroupContext(token, userId, room.id));
  }

  /** 改群名；响应可能不带会话行，只合并 title。 */
  async function rename(title: string): Promise<void> {
    const current = session.value;
    const room = openRoom.value;
    if (!current || !room) return;
    const next = await api.renameGroup(current.token, current.userId, room.id, title);
    groups.value = groups.value.map((item) =>
      item.id === next.id ? { ...item, title: next.title } : item,
    );
  }

  async function remove(): Promise<void> {
    const current = session.value;
    const room = openRoom.value;
    if (!current || !room || deletingId.value) return;
    const groupId = room.id;
    deletingId.value = groupId;
    busy.value = true;
    try {
      await api.deleteGroup(current.token, current.userId, groupId);
      groups.value = groups.value.filter((item) => item.id !== groupId);
      const nextEarlier = { ...earlier.value };
      delete nextEarlier[groupId];
      earlier.value = nextEarlier;
      const nextPhases = { ...knownPhases.value };
      delete nextPhases[groupId];
      knownPhases.value = nextPhases;
      void clearUnread(groupUnreadKey(groupId));
      if (selectedGroupId.value === groupId) closeSurface();
    } catch (error) {
      showToast(
        error instanceof Error && error.message ? error.message : t("groupDeleteFailed"),
        "error",
      );
    } finally {
      busy.value = false;
      if (deletingId.value === groupId) deletingId.value = null;
    }
  }

  async function answerAsk(answer: AskUserAnswer): Promise<void> {
    const current = session.value;
    const pending = askUser.value;
    if (!current || !pending) return;
    await api.answerAskUser(current.token, pending.id, answer);
    askUser.value = undefined;
    void pullAttention();
  }

  async function decideApproval(allow: boolean, scope: ApprovalScope = "once"): Promise<void> {
    const current = session.value;
    const pending = approval.value;
    if (!current || !pending) return;
    await api.decideApproval(current.token, pending.id, allow, scope);
    approval.value = undefined;
    void pullAttention();
  }

  async function decideShellHang(action: ShellHangAction): Promise<void> {
    const current = session.value;
    const pending = shellHang.value;
    if (!current || !pending) return;
    try {
      await api.decideShellHang(current.token, pending.id, action);
      shellHang.value = undefined;
      void pullAttention();
    } catch (error) {
      showToast(
        error instanceof DesktopApiError && error.message
          ? error.message
          : t("shellHangDecideFailed"),
        "error",
      );
    }
  }

  async function loadEarlier(): Promise<number> {
    const current = session.value;
    const room = openRoom.value;
    if (!current || !room || earlier.value[room.id] !== true) return 0;
    const before = room.lines[0]?.id;
    if (!before) return 0;
    try {
      const page = await api.groupLines(current.token, current.userId, room.id, {
        limit: THREAD_WINDOW_PAGE,
        before,
      });
      const known = new Set(room.lines.map((line) => line.id));
      const prepended = page.lines.filter((line) => line.id && !known.has(line.id));
      groups.value = groups.value.map((item) =>
        item.id === room.id ? { ...item, lines: [...prepended, ...item.lines] } : item,
      );
      earlier.value = { ...earlier.value, [room.id]: page.hasMore };
      return prepended.length;
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("groupEmpty"), "error");
      return 0;
    }
  }

  async function reloadOpen(): Promise<void> {
    const current = session.value;
    const room = openRoom.value;
    if (!current || !room || deletingId.value === room.id) return;
    try {
      const next = await api.getGroup(current.token, current.userId, room.id);
      applyLive(next);
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("groupEmpty"), "error");
    }
  }

  function applyLive(next: GroupLive): void {
    notePhases([next.room], "merge");
    groups.value = groups.value.map((item) =>
      item.id === next.room.id ? applyRoom(item, next.room) : item,
    );
    if (next.room.id === selectedGroupId.value) liveTurnId.value = next.liveTurnId ?? "";
  }

  async function mutate(
    run: (token: string, userId: string, room: GroupRoom) => Promise<GroupRoom>,
  ): Promise<void> {
    const current = session.value;
    const room = openRoom.value;
    if (!current || !room) return;
    busy.value = true;
    try {
      const next = await run(current.token, current.userId, room);
      groups.value = groups.value.map((item) => (item.id === next.id ? applyRoom(item, next) : item));
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("groupEmpty"), "error");
    } finally {
      busy.value = false;
    }
  }

  async function mutateLive(
    run: (token: string, userId: string, room: GroupRoom) => Promise<GroupLive>,
  ): Promise<void> {
    const current = session.value;
    const room = openRoom.value;
    if (!current || !room) return;
    busy.value = true;
    try {
      applyLive(await run(current.token, current.userId, room));
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("groupEmpty"), "error");
    } finally {
      busy.value = false;
    }
  }

  const holderStream = useGroupHolderStream({
    baseUrl: computed(() => runtimeBaseUrl()),
    token: computed(() => session.value?.token ?? ""),
    userId: computed(() => session.value?.userId ?? ""),
    groupId: computed(() => openRoom.value?.id ?? ""),
    turnId: liveTurnId,
    enabled: computed(() => openRoom.value?.holderSpeaking === true),
    handlers: {
      onAskUser: (data) => setAskUser(data),
      onApproval: (data) => setApproval(data),
      onShellHang: (data) => setShellHang(data),
    },
    onDone: () => reloadOpen(),
  });

  watch(
    attention,
    (snap) => {
      if (!selectedGroupId.value) return;
      syncHitlFromAttention(snap);
    },
    { deep: true },
  );

  let refreshing = false;
  const pollTimer = setInterval(() => {
    const room = openRoom.value;
    if (!room || refreshing) return;
    const active =
      room.holderSpeaking ||
      room.taskIds.length > 0 ||
      (room.pendingDelegations?.length ?? 0) > 0 ||
      room.lines.some((line) => line.role === "delegation" && line.handoff === "pending");
    if (!active) return;
    refreshing = true;
    void reloadOpen().finally(() => {
      refreshing = false;
    });
  }, 1000);

  /** 群列表 phase / 侧栏：吃桌面 pulse（无云 backfill）；显式 load 仍走 GET /groups。 */
  watch(
    pulseGroups,
    (rooms) => {
      if (!session.value) return;
      if (deletingId.value) {
        mergeListedRooms(rooms.filter((room) => room.id !== deletingId.value));
        return;
      }
      mergeListedRooms(rooms);
    },
    { deep: true },
  );

  onScopeDispose(() => {
    clearInterval(pollTimer);
  });

  return {
    groups,
    selectedGroupId,
    creating,
    title,
    picked,
    busy,
    roster,
    openRoom,
    historyHasMore,
    askUser,
    approval,
    shellHang,
    load,
    loadEarlier,
    selectGroup,
    beginCreate,
    closeSurface,
    toggle,
    create,
    send,
    edit,
    cancelQueue,
    stop,
    clearWorkspace,
    clearContext,
    rename,
    remove,
    reloadOpen,
    setAskUser,
    setApproval,
    setShellHang,
    answerAsk,
    decideApproval,
    decideShellHang,
    syncHitlFromAttention,
    liveMessage: holderStream.liveMessage,
  };
}

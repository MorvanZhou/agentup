<script setup lang="ts">
import { AuiConfig, AuiProvider } from "@assistant-ui/vue";
import { ExternalThread, type ExternalThreadMessage } from "@assistant-ui/core/store";
import type { AppendMessage } from "@assistant-ui/core";
import type { UIMessage } from "ai";
import { computed, onBeforeUnmount, provide, ref, shallowRef, toRef, watch } from "vue";

import { DesktopApi, runtimeBaseUrl as defaultRuntimeBaseUrl } from "../../../../../shared/api/runtime";
import type { GroupMember } from "../../../../../shared/api/runtime/groups";
import {
  createGroupImageAttachmentAdapter,
  groupOutgoingText,
} from "../../../model/composer/group-image-attachment";
import type {
  AgentUpApprovalData,
  AgentUpAskUserData,
  AgentUpShellHangData,
  ApprovalScope,
  AskUserAnswer,
  ShellHangAction,
} from "../../../../../shared/model/chat/chat";
import type { AgentCard } from "../../../../../shared/model/runtime/runtime";
import { t, tf } from "../../../../../shared/model/ui/ui-locale";
import { useWorkspacePaneWidth } from "../../../composables/usePaneWidth";
import { clampWorkspaceWidth } from "../../../model/layout/pane-width";
import {
  groupDelegationCardsKey,
  groupDelegationRuntimeKey,
  groupWaitingTaskIdsKey,
} from "../../../model/group/group-delegation";
import {
  groupLinesToUiMessages,
  pendingDelegationCards,
  resolveGroupReloadEdit,
  resolveGroupWakeLive,
  uiMessagePlainText,
} from "../../../model/group/group-ui-messages";
import { lastUserMessageMatchingText } from "../../../model/thread/thread-insert-cue";
import {
  roomHolder,
  roomMembers,
  roomTaskIds,
  type GroupRoomView,
} from "../../../model/group/group-view";
import {
  chatDelegationMessageKey,
  chatDelegationTrailKey,
  chatMessageFooterKey,
  chatQueueBusyKey,
  chatQueueCancelKey,
  chatSurfaceKey,
  chatWaveBusyKey,
  chatModelModeKey,
  groupChatCapabilities,
} from "../../../model/thread/chat-surface";
import {
  composerAttachKey,
  type ComposerAttachApi,
} from "../../../model/composer/composer-attach";
import { threadActionsKey, type ThreadActions } from "../../../model/thread/thread-actions";
import { threadAgentIdKey } from "../../../model/thread/thread-agent-id";
import { threadApprovalKey } from "../../../model/thread/thread-approval";
import { threadAskUserKey } from "../../../model/thread/thread-ask-user";
import {
  createThreadInsertCueApi,
  threadInsertCueKey,
  type ThreadInsertCue,
} from "../../../model/thread/thread-insert-cue";
import {
  threadDelegationKey,
  type DelegationProcessTarget,
  type ThreadDelegationApi,
} from "../../../model/thread/thread-delegation";
import { threadExtrasKey, type ThreadExtras } from "../../../model/thread/thread-extras";
import { threadEarlierKey, type ThreadEarlier } from "../../../model/thread/thread-earlier";
import { threadRosterKey, type ThreadRoster } from "../../../model/thread/thread-roster";
import { threadWakeLiveKey } from "../../../model/thread/thread-wake-live";
import {
  readonlyToolAutoExpandRef,
  toolAutoExpandKey,
} from "../../../model/thread/tool-auto-expand";
import { AISDKMessageConverter } from "../../../model/thread/ui-to-thread-messages";
import ChatPane from "../shared/ChatPane.vue";
import WorkspacePanel from "../shared/workspace/WorkspacePanel.vue";
import DelegationProcessDialog from "../shared/thread/assistant-ui/byproducts/DelegationProcessDialog.vue";
import ApprovalDock from "../shared/thread/dock/ApprovalDock.vue";
import AskUserDock from "../shared/thread/dock/AskUserDock.vue";
import Composer from "../shared/thread/composer/Composer.vue";
import PlanDock from "../shared/thread/dock/PlanDock.vue";
import ShellHangDock from "../shared/thread/dock/ShellHangDock.vue";
import Thread from "../shared/thread/Thread.vue";
import GroupDelegationMessage from "./GroupDelegationMessage.vue";
import GroupDelegationTrail from "./GroupDelegationTrail.vue";
import GroupHeader from "./GroupHeader.vue";
import GroupMessageFooter from "./GroupMessageFooter.vue";
import GroupSettingsPanel from "./GroupSettingsPanel.vue";

const props = defineProps<{
  room: GroupRoomView;
  token: string;
  userId: string;
  /** 侧栏名片 + 打开会话，供协助头像 / 去对话。 */
  roster?: ThreadRoster;
  /** 当前会话名单上的岗位 / 头像；群记录本身不保存这些名片字段。 */
  memberRoles?: ReadonlyArray<{ agentId: string; role: string; avatarUrl?: string }>;
  busy?: boolean;
  /** 执掌者正在跑的这一轮。工具和正文边写边出，结束后由房间记录接上。 */
  liveMessage?: UIMessage | null;
  askUser?: AgentUpAskUserData;
  approval?: AgentUpApprovalData;
  shellHang?: AgentUpShellHangData;
  runtimeBaseUrl?: string;
  clearContext?: () => Promise<void>;
  deleteGroup?: () => Promise<void>;
  clearWorkspace?: (includeWork: boolean) => Promise<void>;
  renameTitle?: (title: string) => Promise<void>;
  setModelMode?: (mode: "unified" | "perAgent") => Promise<void>;
  setGroupModel?: (ref: { templateId: string; modelId: string }) => Promise<void>;
  setMembers?: (members: GroupMember[], defaultHolderId?: string) => Promise<void>;
  /** 可加入群的本机名单（已招募，不含私人助理）。 */
  agents?: AgentCard[];
  historyHasMore?: boolean;
  loadOlder?: () => Promise<number>;
}>();

const emit = defineEmits<{
  send: [text: string];
  edit: [messageId: string, text: string];
  cancelQueue: [queueId: string];
  stop: [];
  answer: [answer: AskUserAnswer];
  decide: [allow: boolean, scope?: ApprovalScope];
  "shell-hang-decide": [action: ShellHangAction];
}>();

const holder = computed(() => roomHolder(props.room));
const clearing = ref(false);
const deleting = ref(false);
const clearingWorkspace = ref(false);
/** 右侧抽屉：工作空间 / 对话配置 互斥。 */
type RightPane = "closed" | "workspace" | "chat-settings";
const rightPane = ref<RightPane>("closed");
const rightPaneOpen = computed(() => rightPane.value !== "closed");
const workspaceOpen = computed(() => rightPane.value === "workspace");
const chatSettingsOpen = computed(() => rightPane.value === "chat-settings");
const workspaceGeneration = ref(0);
const bodyEl = ref<HTMLElement | null>(null);
const { width: rightPaneWidth, startResize: startRightPaneResize } = useWorkspacePaneWidth();
let bodyResizeObserver: ResizeObserver | null = null;

function setBodyRow(el: HTMLElement | null): void {
  bodyEl.value = el;
}

function fitWorkspaceToBody(): void {
  if (!rightPaneOpen.value || !bodyEl.value) return;
  rightPaneWidth.value = clampWorkspaceWidth(rightPaneWidth.value, bodyEl.value.clientWidth);
}

function toggleWorkspace(): void {
  rightPane.value = rightPane.value === "workspace" ? "closed" : "workspace";
}

function openChatSettings(): void {
  rightPane.value = "chat-settings";
}

function closeRightPane(): void {
  rightPane.value = "closed";
}

async function renameRoomTitle(title: string): Promise<void> {
  if (!props.renameTitle) return;
  await props.renameTitle(title);
}

async function setRoomMembers(
  members: GroupMember[],
  defaultHolderId?: string,
): Promise<void> {
  if (!props.setMembers) return;
  await props.setMembers(members, defaultHolderId);
}

async function clearRoomWorkspace(includeWork: boolean): Promise<void> {
  if (!props.clearWorkspace || clearingWorkspace.value) return;
  clearingWorkspace.value = true;
  try {
    await props.clearWorkspace(includeWork);
    workspaceGeneration.value += 1;
  } catch {
    // 失败提示由会话层弹出，这里不刷新仍开着的工作区。
  } finally {
    clearingWorkspace.value = false;
  }
}

async function deleteRoom(): Promise<void> {
  if (!props.deleteGroup || deleting.value) return;
  deleting.value = true;
  try {
    await props.deleteGroup();
  } finally {
    deleting.value = false;
  }
}

function onThreadResize(event: PointerEvent): void {
  if (bodyEl.value) startRightPaneResize(event, bodyEl.value, "from-right");
}

watch([bodyEl, rightPaneOpen], ([el, open]) => {
  bodyResizeObserver?.disconnect();
  bodyResizeObserver = null;
  if (!el || !open) return;
  fitWorkspaceToBody();
  bodyResizeObserver = new ResizeObserver(fitWorkspaceToBody);
  bodyResizeObserver.observe(el);
}, { flush: "post" });

watch(
  () => props.room.updatedAt,
  () => { workspaceGeneration.value += 1; },
);

onBeforeUnmount(() => bodyResizeObserver?.disconnect());
const taskIds = computed(() => roomTaskIds(props.room));
const speaking = computed(() => props.room.holderSpeaking === true);
const resolvedRuntimeBaseUrl = computed(
  () => props.runtimeBaseUrl ?? defaultRuntimeBaseUrl(),
);
const profileByAgent = computed(() => {
  const map: Record<string, { avatarUrl?: string; role?: string }> = {};
  for (const profile of props.memberRoles ?? []) {
    map[profile.agentId] = {
      ...(profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
      ...(profile.role ? { role: profile.role } : {}),
    };
  }
  return map;
});
const avatarByAgent = computed(() => {
  const map: Record<string, string> = {};
  for (const [agentId, profile] of Object.entries(profileByAgent.value)) {
    if (profile.avatarUrl) map[agentId] = profile.avatarUrl;
  }
  return map;
});
const waveBusy = computed(
  () => taskIds.value.length > 0 || (props.room.pendingDelegations?.length ?? 0) > 0,
);
const waitingTaskIds = computed(() =>
  [props.askUser?.taskId, props.approval?.taskId, props.shellHang?.taskId].filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  ),
);
const trailCards = computed(() =>
  pendingDelegationCards(props.room.pendingDelegations, roomMembers(props.room), profileByAgent.value),
);
const placeholder = computed(() => {
  if (!holder.value) {
    // 尚无执掌者：提示将交给默认应答者
    const fallback =
      roomMembers(props.room).find((member) => member.agentId === props.room.defaultHolderId)?.name ??
      roomMembers(props.room)[0]?.name ??
      "";
    return tf("groupComposerIdle", { name: fallback });
  }
  if (taskIds.value.length > 0) return tf("groupComposerBusy", { name: holder.value.name });
  return tf("groupComposerHolder", { name: holder.value.name });
});

const extras = computed<ThreadExtras>(() => ({
  personal: false,
  kind: "",
  name: "",
  role: "",
  remark: "",
  background: "",
  recruited: false,
  syncedVersion: "group",
  busy: Boolean(props.busy),
  modelConfigured: true,
  modelLoaded: true,
}));

const actions = computed<ThreadActions>(() => ({
  clearContext: async () => {
    if (!props.clearContext || clearing.value) return;
    clearing.value = true;
    try {
      await props.clearContext();
    } finally {
      clearing.value = false;
    }
  },
  clearHistory: async () => undefined,
  clearing: false,
  clearingHistory: false,
  setRemark: async () => undefined,
  dismiss: async () => undefined,
  stopTurn: async () => {
    emit("stop");
  },
  // 群会话本期不接 followUp 队列：群发言本来就按行排队，不需要再叠一层
  enqueueFollowUp: async () => undefined,
  // 同上：群也不接 steer（返回 false → Composer 退回停止后重发）
  steerTurn: async () => false,
}));

const liveAuthor = computed(() => {
  if (!holder.value) return null;
  const profile = profileByAgent.value[holder.value.agentId];
  return {
    id: holder.value.agentId,
    name: holder.value.name,
    avatarUrl: profile?.avatarUrl,
    role: profile?.role,
  };
});

/** 发送后、POST 落盘前先占位的用户正文；与历史行撞上就清掉，避免双气泡。 */
const pendingUserText = ref("");
/** 发出 pending 时已有的用户行 id；对账时跳过，避免同文命中旧行。 */
const pendingPriorUserIds = ref<readonly string[]>([]);
/**
 * 发出时执掌者已经在说话 → 才是中途插入（需要滚到中段 + 闪）。
 * 开局第一条 / 交回后再说的正常发言不闪。
 */
const pendingMidInsert = ref(false);
/** 中途插入：从贴底乐观气泡落到历史中段时，滚过去并闪一下 */
const insertCue = ref<ThreadInsertCue | null>(null);
const insertCueApi = createThreadInsertCueApi(insertCue);
provide(threadInsertCueKey, insertCueApi);

const messages = computed(() => groupLinesToUiMessages(props.room, profileByAgent.value));
const threadMessages = computed(
  () =>
    AISDKMessageConverter.toThreadMessages(messages.value, speaking.value) as ExternalThreadMessage[],
);

const wakeLive = computed(() =>
  resolveGroupWakeLive({
    speaking: speaking.value,
    liveMessage: props.liveMessage ?? null,
    author: liveAuthor.value,
    pendingUserText: pendingUserText.value,
  }),
);

// 历史已有同一条用户发言 → 撤掉乐观气泡；执掌中途插入时再 cue 高亮
watch(
  messages,
  (list) => {
    const pending = pendingUserText.value.trim();
    if (!pending) return;
    // 跳过发出前已有的同文行，再取最后一条新行
    const hit = lastUserMessageMatchingText(
      list,
      pending,
      uiMessagePlainText,
      pendingPriorUserIds.value,
    );
    if (!hit) return;
    const midInsert = pendingMidInsert.value;
    pendingUserText.value = "";
    pendingPriorUserIds.value = [];
    pendingMidInsert.value = false;
    // 仅中途插入闪缩；开局/空闲发言不闪
    if (midInsert) insertCueApi.flashById(hit.id);
  },
);

// 发送失败 / 未写入：busy 落下且仍对不上历史行，撤乐观占位
watch(
  () => props.busy,
  (busy, wasBusy) => {
    if (wasBusy !== true || busy) return;
    const pending = pendingUserText.value.trim();
    if (!pending) return;
    if (
      !lastUserMessageMatchingText(
        messages.value,
        pending,
        uiMessagePlainText,
        pendingPriorUserIds.value,
      )
    ) {
      pendingUserText.value = "";
      pendingPriorUserIds.value = [];
      pendingMidInsert.value = false;
    }
  },
);

function appendText(message: AppendMessage): string {
  return message.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();
}

/** 附件条里的图片 id 就是 staged 路径；发出去时拼进正文，输入框本身不放芯片。 */
function outgoingText(message: AppendMessage): string {
  const ids =
    message.role === "user" ? (message.attachments ?? []).map((item) => item.id) : [];
  return groupOutgoingText(appendText(message), ids);
}

const groupImageAttachments = createGroupImageAttachmentAdapter({
  api: new DesktopApi(),
  auth: () => ({
    token: props.token,
    userId: props.userId,
    groupId: props.room.id ?? "",
  }),
});

const config = computed(() =>
  AuiConfig({
    thread: ExternalThread({
      messages: threadMessages.value,
      isRunning: speaking.value,
      isSendDisabled: Boolean(props.busy),
      attachmentAdapter: groupImageAttachments,
      onNew: (message) => {
        const text = outgoingText(message);
        if (!text) return;
        // 先亮用户气泡，再等 mutateLive；避免 POST/首包前空白像没发出去
        pendingPriorUserIds.value = messages.value
          .filter((row) => row.role === "user")
          .map((row) => row.id);
        // 发出瞬间已在执掌中 → 中途插入；否则是开局/换人后的正常发言
        pendingMidInsert.value = speaking.value;
        pendingUserText.value = text;
        emit("send", text);
      },
      onEdit: (message) => {
        const text = outgoingText(message);
        const messageId = message.sourceId?.trim() ?? "";
        if (text && messageId) emit("edit", messageId, text);
      },
      // 助手「重新生成」：找触发它的用户行，原样 edit（与编辑重发同一 rewind 路径）
      onReload: (parentId) => {
        const target = resolveGroupReloadEdit(messages.value, parentId);
        if (target) emit("edit", target.messageId, target.text);
      },
    }),
  }),
);

provide(threadExtrasKey, extras);
provide(
  threadEarlierKey,
  computed<ThreadEarlier>(() => ({
    hasMore: props.historyHasMore === true,
    loadOlder: props.loadOlder ?? (async () => 0),
  })),
);
provide(threadActionsKey, actions);
provide(threadAgentIdKey, "");
provide(
  threadRosterKey,
  computed(
    () =>
      props.roster ?? {
        agents: [],
        openAgent: () => "dismissed" as const,
      },
  ),
);
provide(threadAskUserKey, toRef(props, "askUser"));
provide(threadApprovalKey, toRef(props, "approval"));
// Composer 挂载后写入；工作区侧栏据此把文件插成 @ATTACHMENTS 芯片
provide(composerAttachKey, shallowRef<ComposerAttachApi | null>(null));

/** toolCallId → taskId；过程弹窗旁路打开（与单聊同一套注入）。 */
const taskIdByToolCall = ref(new Map<string, string>());
const processOpen = ref(false);
const processTarget = ref<DelegationProcessTarget | null>(null);
const delegationApi = computed<ThreadDelegationApi>(() => ({
  registerStarted(data) {
    if (data.toolCallId) {
      const next = new Map(taskIdByToolCall.value);
      next.set(data.toolCallId, data.taskId);
      taskIdByToolCall.value = next;
    }
  },
  resolveTaskId(toolCallId) {
    return taskIdByToolCall.value.get(toolCallId);
  },
  openProcess(target) {
    processTarget.value = target;
    processOpen.value = true;
  },
}));
provide(threadDelegationKey, delegationApi);

provide(chatModelModeKey, {
  mode: computed(() => (props.room.modelMode === "perAgent" ? "perAgent" : "unified")),
  setMode: (mode) => props.setModelMode?.(mode),
  roomModel: computed(() => props.room.model ?? null),
  setRoomModel: (ref) => props.setGroupModel?.(ref),
});
provide(
  chatSurfaceKey,
  computed(() =>
    groupChatCapabilities({
      placeholder: placeholder.value,
      members: roomMembers(props.room).map((member) => {
        const profile = props.memberRoles?.find((item) => item.agentId === member.agentId);
        return {
          id: member.agentId,
          name: member.name,
          role: profile?.role ?? "",
          avatarUrl: profile?.avatarUrl,
        };
      }),
      defaultResourceAgentId: holder.value?.agentId ?? "",
      groupId: props.room.id ?? "",
    }),
  ),
);
/** 群聊执掌者回合：tool 执行中也默认折叠，避免大块输出占屏。 */
provide(toolAutoExpandKey, readonlyToolAutoExpandRef());
provide(threadWakeLiveKey, wakeLive);
provide(chatMessageFooterKey, GroupMessageFooter);
provide(chatDelegationMessageKey, GroupDelegationMessage);
provide(chatDelegationTrailKey, GroupDelegationTrail);
provide(chatWaveBusyKey, waveBusy);
provide(groupDelegationCardsKey, trailCards);
provide(groupWaitingTaskIdsKey, waitingTaskIds);
provide(
  groupDelegationRuntimeKey,
  computed(() => ({
    token: props.token,
    userId: props.userId,
    ...(props.runtimeBaseUrl ? { baseUrl: props.runtimeBaseUrl } : {}),
  })),
);
provide(chatQueueCancelKey, (queueId: string) => emit("cancelQueue", queueId));
provide(chatQueueBusyKey, computed(() => Boolean(props.busy)));
</script>

<template>
  <AuiProvider :config="config" :extends="null">
    <DelegationProcessDialog
      :open="processOpen"
      :target="processTarget"
      :token="token"
      :user-id="userId"
      :runtime-base-url="resolvedRuntimeBaseUrl"
      @update:open="processOpen = $event"
    />
    <ChatPane :side-open="rightPaneOpen" @row="setBodyRow">
      <template #header>
        <GroupHeader
          :room="room"
          :avatars="avatarByAgent"
          :workspace-open="workspaceOpen"
          :chat-settings-open="chatSettingsOpen"
          :clearing="clearing"
          @toggle-workspace="toggleWorkspace"
          @open-chat-settings="openChatSettings"
          @clear-context="() => void actions.clearContext()"
        />
      </template>
      <template #process />
      <template #body>
        <Thread />
      </template>
      <template #dock>
        <PlanDock :suppressed="Boolean(approval || askUser || shellHang)" />
        <ShellHangDock :hang="shellHang" @decide="(action) => emit('shell-hang-decide', action)" />
        <ApprovalDock :approval="approval" @decide="(allow, scope) => emit('decide', allow, scope)" />
        <AskUserDock :ask-user="askUser" @answer="(answer) => emit('answer', answer)" />
      </template>
      <template #composer>
        <Composer />
      </template>
      <template #resize>
        <button
          v-if="rightPaneOpen && token && userId"
          type="button"
          class="app-no-drag absolute inset-y-0 right-0 z-10 hidden w-1.5 translate-x-1/2 cursor-col-resize border-0 bg-transparent p-0 min-[730px]:block"
          aria-label="调整对话区宽度"
          @pointerdown="onThreadResize"
        />
      </template>
      <template #side>
        <button
          v-if="rightPaneOpen"
          type="button"
          class="absolute inset-0 z-10 bg-black/40 min-[730px]:hidden"
          :aria-label="chatSettingsOpen ? t('chatSettingsClose') : t('wsClose')"
          @click="closeRightPane"
        />
        <div
          v-if="rightPaneOpen && token && userId && room.id"
          class="absolute inset-y-0 right-0 z-20 flex h-full shrink-0 min-[730px]:static"
          :style="{ width: `${rightPaneWidth}px` }"
        >
          <WorkspacePanel
            v-if="workspaceOpen"
            :token="token"
            :user-id="userId"
            :agent-id="`group:${room.id}`"
            :personal="false"
            :generation="workspaceGeneration"
            :group="true"
            class="h-full w-full"
            @close="closeRightPane"
          />
          <GroupSettingsPanel
            v-else-if="chatSettingsOpen"
            :title="room.title ?? ''"
            :members="roomMembers(room)"
            :default-holder-id="room.defaultHolderId ?? roomMembers(room)[0]?.agentId ?? ''"
            :agents="agents ?? []"
            :avatars="avatarByAgent"
            :busy="room.holderSpeaking === true || (room.taskIds?.length ?? 0) > 0"
            :deleting="deleting"
            :clearing-workspace="clearingWorkspace"
            :rename-title="renameRoomTitle"
            :set-members="setRoomMembers"
            :clear-workspace="clearRoomWorkspace"
            :delete-group="deleteRoom"
            class="h-full w-full"
            @close="closeRightPane"
          />
        </div>
      </template>
    </ChatPane>
  </AuiProvider>
</template>

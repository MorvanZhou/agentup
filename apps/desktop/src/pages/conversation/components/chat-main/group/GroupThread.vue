<script setup lang="ts">
import { AuiConfig, AuiProvider } from "@assistant-ui/vue";
import { ExternalThread, type ExternalThreadMessage } from "@assistant-ui/core/store";
import type { AppendMessage } from "@assistant-ui/core";
import type { UIMessage } from "ai";
import { computed, onBeforeUnmount, provide, ref, shallowRef, toRef, watch } from "vue";

import { useThreadPreview } from "../../../composables/useThreadPreview";
import { provideThreadPreview } from "../../../model/thread/thread-preview";
import PreviewPortConflictDialog from "../shared/preview/PreviewPortConflictDialog.vue";
import EmbeddedPreviewPanel from "../shared/preview/EmbeddedPreviewPanel.vue";
import RightPaneResizeHandle from "../shared/RightPaneResizeHandle.vue";
import { RIGHT_PANE_SHELL_CLASS } from "../shared/right-pane-shell";
import { DesktopApi, runtimeBaseUrl as defaultRuntimeBaseUrl } from "../../../../../shared/api/runtime";
import type { GroupMember } from "../../../../../shared/api/runtime/groups";
import {
  createGroupImageAttachmentAdapter,
  groupOutgoingText,
} from "../../../model/composer/group-image-attachment";
import type {
  AgentUpApprovalData,
  AgentUpAskUserData,
  AgentUpDelegationStartedData,
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
  profilesByAgentFromMemberRoles,
  resolveGroupReloadEdit,
  resolveGroupWakeLive,
  reuseAgentUiProfiles,
  uiMessagePlainText,
  type GroupUiProfile,
} from "../../../model/group/group-ui-messages";
import { lastUserMessageMatchingText } from "../../../model/thread/thread-insert-cue";
import {
  previewJobAgentId,
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
/** 右侧抽屉：工作空间 / 群设置 / 浏览器预览 互斥（同槽同宽）。 */
type RightPane = "closed" | "workspace" | "chat-settings" | "preview";
const rightPane = ref<RightPane>("closed");
const rightPaneOpen = computed(() => rightPane.value !== "closed");
const workspaceOpen = computed(() => rightPane.value === "workspace");
const chatSettingsOpen = computed(() => rightPane.value === "chat-settings");
const previewPaneOpen = computed(() => rightPane.value === "preview");
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

/** 群设置抽屉：已开则再点顶栏按钮收起，与工作区互斥。 */
function openChatSettings(): void {
  rightPane.value = rightPane.value === "chat-settings" ? "closed" : "chat-settings";
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
/**
 * 名片表按内容复用旧引用：父级即使每次传入新 memberRoles 数组，
 * 也不要因流式 chunk 重建历史 messages / ExternalThread。
 */
const profileByAgent = shallowRef<Record<string, GroupUiProfile>>({});
watch(
  () => props.memberRoles,
  (roles) => {
    profileByAgent.value = reuseAgentUiProfiles(
      profileByAgent.value,
      profilesByAgentFromMemberRoles(roles),
    );
  },
  { immediate: true },
);
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
/**
 * 历史线程不做 streaming 转换：直播在 WakeLiveMessage 隔离树里。
 * 若跟 speaking 绑定，开跑瞬间会整表 toThreadMessages，放大重绘。
 */
const threadMessages = computed(
  () => AISDKMessageConverter.toThreadMessages(messages.value, false) as ExternalThreadMessage[],
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
/** 群共享工作区 Launch Recipe / 内嵌预览 */
const groupPreviewAgentId = computed(() =>
  props.room.id ? `group:${props.room.id}` : "",
);
// 空闲时 holderId 常为空：回落 defaultHolder / 首位，否则 start 会 400「请求无效」
const groupHolderAgentId = computed(() => previewJobAgentId(props.room) || undefined);
const threadPreview = useThreadPreview({
  agentId: groupPreviewAgentId,
  personal: computed(() => false),
  holderAgentId: groupHolderAgentId,
});
provideThreadPreview(threadPreview);
const previewActive = threadPreview.active;
const previewOpen = threadPreview.open;
const previewBusy = threadPreview.busy;
// 群记录增行后配方可能刚写入 workspace.json，刷新顶栏入口
watch(
  () => props.room.lines?.length ?? 0,
  () => {
    void threadPreview.refresh();
  },
);
watch(
  () => threadPreview.open.value,
  (isOpen) => {
    if (isOpen) {
      rightPane.value = "preview";
      return;
    }
    if (rightPane.value === "preview") rightPane.value = "closed";
  },
);
watch(
  () => rightPane.value,
  (pane, prev) => {
    if (prev === "preview" && pane !== "preview" && threadPreview.open.value) {
      const recipe = threadPreview.active.value;
      if (recipe) void threadPreview.stop(recipe);
    }
  },
);
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
/** toolCallId / taskId → 派出时模型快照（协助面板状态旁标形）。 */
const replyModelByKey = ref(
  new Map<string, NonNullable<AgentUpDelegationStartedData["replyModel"]>>(),
);
const processOpen = ref(false);
const processTarget = ref<DelegationProcessTarget | null>(null);
const delegationApi = computed<ThreadDelegationApi>(() => ({
  registerStarted(data) {
    if (data.toolCallId) {
      const next = new Map(taskIdByToolCall.value);
      next.set(data.toolCallId, data.taskId);
      taskIdByToolCall.value = next;
    }
    if (data.replyModel) {
      const models = new Map(replyModelByKey.value);
      models.set(data.taskId, data.replyModel);
      if (data.toolCallId) models.set(data.toolCallId, data.replyModel);
      replyModelByKey.value = models;
    }
  },
  resolveTaskId(toolCallId) {
    return taskIdByToolCall.value.get(toolCallId);
  },
  resolveReplyModel(toolCallIdOrTaskId) {
    return replyModelByKey.value.get(toolCallIdOrTaskId);
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
  <!-- 外层 h-full：AuiProvider 无 DOM 壳，须自填 absolute inset-0 会话格 -->
  <div class="flex h-full min-h-0 min-w-0 w-full flex-col">
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
      <template #resize />
      <template #side>
        <button
          v-if="rightPaneOpen"
          type="button"
          class="absolute inset-0 z-10 bg-black/40 min-[730px]:hidden"
          :aria-label="chatSettingsOpen ? t('chatSettingsClose') : t('wsClose')"
          @click="closeRightPane"
        />
        <!-- 壳 class 见 RIGHT_PANE_SHELL_CLASS：relative 锚定拖条，z-40 压过对话列 -->
        <div
          v-if="rightPaneOpen && token && userId && room.id"
          :class="RIGHT_PANE_SHELL_CLASS"
          :style="{ width: `${rightPaneWidth}px` }"
        >
          <!-- 工作区 / 设置 / 预览共用左缘拖宽 -->
          <RightPaneResizeHandle :start-resize="onThreadResize" />
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
          <!-- 浏览器预览：复用工作区侧栏槽位与宽度 -->
          <EmbeddedPreviewPanel
            v-else-if="previewPaneOpen"
            class="h-full w-full"
            :recipe="previewActive"
            :open="previewOpen"
            :busy="previewBusy"
            @close="previewActive ? void threadPreview.stop(previewActive) : undefined"
          />
        </div>
      </template>
    </ChatPane>
  </AuiProvider>
  <!-- 预览端口被其它进程占用时确认是否结束并重启 -->
  <PreviewPortConflictDialog />
  </div>
</template>

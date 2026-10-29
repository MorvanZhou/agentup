<script setup lang="ts">
import { AuiConfig, AuiProvider } from "@assistant-ui/vue";
import { ExternalThread, type ExternalThreadMessage } from "@assistant-ui/core/store";
import type { AppendMessage } from "@assistant-ui/core";
import type { UIMessage } from "ai";
import { computed, onBeforeUnmount, provide, ref, shallowRef, toRef, watch } from "vue";

import { DesktopApi, runtimeBaseUrl as defaultRuntimeBaseUrl } from "../../../../../shared/api/runtime";
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
import { t, tf } from "../../../../../shared/model/ui/ui-locale";
import { useWorkspacePaneWidth } from "../../../composables/usePaneWidth";
import { clampWorkspaceWidth } from "../../../model/layout/pane-width";
import {
  groupDelegationCardsKey,
  groupDelegationRuntimeKey,
  groupWaitingTaskIdsKey,
} from "../../../model/group/group-delegation";
import { groupLinesToUiMessages, pendingDelegationCards, withHolderAuthor } from "../../../model/group/group-ui-messages";
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
  if (!holder.value) return t("groupComposerIdle");
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
const live = computed(() => {
  const message = props.liveMessage ?? null;
  if (!message) return null;
  const author = liveAuthor.value;
  return author ? withHolderAuthor(message, author) : message;
});

const messages = computed(() => groupLinesToUiMessages(props.room, profileByAgent.value));
const threadMessages = computed(
  () =>
    AISDKMessageConverter.toThreadMessages(messages.value, speaking.value) as ExternalThreadMessage[],
);

function appendText(message: AppendMessage): string {
  return message.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();
}

/** 附件条里的图片 id 就是 staged 路径；发出去时拼进正文，输入框本身不放芯片。 */
function outgoingText(message: AppendMessage): string {
  const ids = message.role === "user" ? message.attachments.map((item) => item.id) : [];
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
        if (text) emit("send", text);
      },
      onEdit: (message) => {
        const text = outgoingText(message);
        const messageId = message.sourceId?.trim() ?? "";
        if (text && messageId) emit("edit", messageId, text);
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
provide(
  threadWakeLiveKey,
  computed(() => ({
    streaming: Boolean(live.value) && speaking.value,
    message: live.value,
  })),
);
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
          :deleting="deleting"
          :clearing-workspace="clearingWorkspace"
          @toggle-workspace="toggleWorkspace"
          @open-chat-settings="openChatSettings"
          @clear-context="() => void actions.clearContext()"
          @delete="() => void deleteRoom()"
          @clear-workspace="(includeWork) => void clearRoomWorkspace(includeWork)"
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
            :rename-title="renameRoomTitle"
            class="h-full w-full"
            @close="closeRightPane"
          />
        </div>
      </template>
    </ChatPane>
  </AuiProvider>
</template>

<script setup lang="ts">
import { AISDKChat } from "@assistant-ui/ai-sdk";
import { SimpleImageAttachmentAdapter } from "@assistant-ui/core";
import { AuiConfig, AuiProvider } from "@assistant-ui/vue";
import type { UIMessage } from "ai";
import { computed, onBeforeUnmount, provide, ref, toRef, watch } from "vue";

import ChatSettingsPanel from "./ChatSettingsPanel.vue";
import WorkspacePanel from "./workspace/WorkspacePanel.vue";

import { createAgentUpTransport } from "../../../../shared/api/agent-transport";
import { DesktopApi, runtimeBaseUrl as defaultRuntimeBaseUrl } from "../../../../shared/api/runtime";
import {
  isAgentUpApproval,
  isAgentUpAskUser,
  isAgentUpDelegationStarted,
  isAgentUpModelUnavailable,
  lastMessagePreview,
  type AgentUpApprovalData,
  type AgentUpAskUserData,
  type ApprovalScope,
  type AskUserAnswer,
} from "../../../../shared/model/chat";
import { showToast } from "../../../../shared/model/toast";
import { t } from "../../../../shared/model/ui-locale";
import { useDelegationFleet } from "../../composables/useDelegationFleet";
import { useWorkspacePaneWidth } from "../../composables/usePaneWidth";
import { clampWorkspaceWidth } from "../../model/layout/pane-width";
import { clearProcessFoldState } from "../../model/message/process-fold-state";
import { threadActionsKey, type ThreadActions } from "../../model/thread/thread-actions";
import { threadActiveKey } from "../../model/thread/thread-active";
import { threadAgentIdKey } from "../../model/thread/thread-agent-id";
import { threadApprovalKey } from "../../model/thread/thread-approval";
import { threadAskUserKey } from "../../model/thread/thread-ask-user";
import {
  threadDelegationKey,
  type DelegationProcessTarget,
  type ThreadDelegationApi,
} from "../../model/thread/thread-delegation";
import { threadExtrasKey, type ThreadExtras } from "../../model/thread/thread-extras";
import { threadRosterKey, type ThreadRoster } from "../../model/thread/thread-roster";
import DelegationFleetBar from "./thread/assistant-ui/byproducts/DelegationFleetBar.vue";
import DelegationProcessDialog from "./thread/assistant-ui/byproducts/DelegationProcessDialog.vue";
import Thread from "./thread/Thread.vue";
import ConversationHeader from "./ConversationHeader.vue";
import ThreadRunningBridge from "./thread/ThreadRunningBridge.vue";

const props = withDefaults(
  defineProps<{
    agentId: string;
    token: string;
    userId: string;
    messages: UIMessage[];
    extras: ThreadExtras;
    /** 侧栏名片 + 打开会话，供协助头像解析与跳转。 */
    roster?: ThreadRoster;
    /** 主区当前是否显示本线程（切走再进时清空过程折叠记忆）。 */
    active?: boolean;
    approval?: AgentUpApprovalData;
    askUser?: AgentUpAskUserData;
    runtimeBaseUrl?: string;
    abortTurn?: () => Promise<void>;
    clearContext?: () => Promise<void>;
    clearHistory?: () => Promise<void>;
    setRemark?: (remark: string) => Promise<void>;
    dismiss?: () => Promise<void>;
  }>(),
  { active: true },
);
const emit = defineEmits<{
  decide: [allow: boolean, scope?: ApprovalScope];
  approval: [value: AgentUpApprovalData | undefined];
  askUser: [value: AgentUpAskUserData | undefined];
  answer: [answer: AskUserAnswer];
  "turn-end": [preview: string, messages: UIMessage[]];
  running: [running: boolean];
}>();

provide(threadExtrasKey, toRef(props, "extras"));
provide(threadAgentIdKey, props.agentId);
provide(threadActiveKey, toRef(props, "active"));
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
// 顶栏与 Thread 内 Composer 都能读到 pending HITL
provide(threadAskUserKey, toRef(props, "askUser"));
provide(threadApprovalKey, toRef(props, "approval"));

/** toolCallId → taskId（transient started）；过程弹窗旁路打开。 */
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

const resolvedRuntimeBaseUrl = computed(
  () => props.runtimeBaseUrl ?? defaultRuntimeBaseUrl(),
);

const fleetApi = new DesktopApi();
const {
  items: fleetItems,
  noteStarted: noteFleetStarted,
  noteCancelled: noteFleetCancelled,
} = useDelegationFleet({
  api: fleetApi,
  agentId: toRef(props, "agentId"),
  token: toRef(props, "token"),
  userId: toRef(props, "userId"),
  active: toRef(props, "active"),
});

// 重新进入本对话：清空过程折叠缓存（组件常驻 v-show，不能靠卸载）
watch(
  () => props.active,
  (active, prev) => {
    if (active && prev === false) clearProcessFoldState(props.agentId);
  },
);
const clearing = ref(false);
const clearingHistory = ref(false);
/** 立刻收起 AskUser / 审批浮层（不依赖 SSE）。 */
function dismissHitl(): void {
  if (props.askUser) emit("askUser", undefined);
  if (props.approval) emit("approval", undefined);
}

const threadActions = computed<ThreadActions>(() => ({
  clearing: clearing.value,
  clearingHistory: clearingHistory.value,
  async clearContext() {
    if (!props.clearContext || clearing.value || clearingHistory.value) return;
    clearing.value = true;
    try {
      dismissHitl();
      await props.clearContext();
    } finally {
      clearing.value = false;
    }
  },
  async clearHistory() {
    if (!props.clearHistory || clearing.value || clearingHistory.value) return;
    clearingHistory.value = true;
    try {
      dismissHitl();
      await props.clearHistory();
    } finally {
      clearingHistory.value = false;
    }
  },
  async setRemark(remark: string) {
    if (!props.setRemark) return;
    await props.setRemark(remark);
  },
  async dismiss() {
    if (!props.dismiss) return;
    await props.dismiss();
  },
  async stopTurn() {
    dismissHitl();
    if (!props.abortTurn) return;
    try {
      await props.abortTurn();
    } catch {
      // 停止失败不挡 UI；重发时 transport 仍会 409→abort→重试。
    }
  },
}));
provide(threadActionsKey, threadActions);

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

function onThreadResize(event: PointerEvent): void {
  if (!bodyEl.value) return;
  // 拖 thread 右缘：右移缩小右侧栏，左移放大右侧栏
  startRightPaneResize(event, bodyEl.value, "from-right");
}

watch(
  [bodyEl, rightPaneOpen],
  ([el, open]) => {
    bodyResizeObserver?.disconnect();
    bodyResizeObserver = null;
    if (!el || !open) return;
    fitWorkspaceToBody();
    bodyResizeObserver = new ResizeObserver(() => fitWorkspaceToBody());
    bodyResizeObserver.observe(el);
  },
  { flush: "post" },
);

onBeforeUnmount(() => {
  bodyResizeObserver?.disconnect();
  bodyResizeObserver = null;
  clearProcessFoldState(props.agentId);
});

// 配置只在挂载时建一次：切走不销毁本组件，stream 状态留在 AISDKChat 内。
// 换 agent / 新对话靠父级 :key 整树重建。
const config = AuiConfig({
  threads: AISDKChat({
    id: props.agentId,
    messages: props.messages,
    // 默认同轮多条 assistant 会并成一个气泡。空闲同步是下一条独立 assistant，不能并进去。
    joinStrategy: "none",
    // 附件条只收图片；非图片在 Composer 插 @ATTACHMENTS 芯片并即时落盘。
    adapters: {
      attachments: new SimpleImageAttachmentAdapter(),
    },
    transport: createAgentUpTransport({
      baseUrl: props.runtimeBaseUrl ?? defaultRuntimeBaseUrl(),
      token: props.token,
      userId: props.userId,
      agentId: props.agentId,
    }),
    onData(part: { type: string; data?: unknown }) {
      if (part.type === "data-agentup-approval" && isAgentUpApproval(part.data)) {
        emit("approval", part.data);
      }
      if (part.type === "data-agentup-ask-user" && isAgentUpAskUser(part.data)) {
        emit("askUser", part.data);
      }
      if (
        part.type === "data-agentup-delegation-started" &&
        isAgentUpDelegationStarted(part.data)
      ) {
        delegationApi.value.registerStarted(part.data);
        noteFleetStarted(part.data);
      }
      if (
        part.type === "data-agentup-model-unavailable" &&
        isAgentUpModelUnavailable(part.data)
      ) {
        showToast(part.data.message || t("modelUnavailable"), "error");
      }
    },
    onFinish({ messages }) {
      workspaceGeneration.value += 1;
      emit("turn-end", lastMessagePreview(messages), messages);
    },
  }),
});
</script>

<template>
  <AuiProvider :config="config">
    <ThreadRunningBridge @change="emit('running', $event)" @dismiss-hitl="dismissHitl" />
    <DelegationProcessDialog
      :open="processOpen"
      :target="processTarget"
      :token="token"
      :user-id="userId"
      :runtime-base-url="resolvedRuntimeBaseUrl"
      @update:open="processOpen = $event"
      @cancelled="noteFleetCancelled"
    />
    <!-- 会话线程 -->
    <div class="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-paper text-foreground">
      <!-- 顶栏 -->
      <ConversationHeader
        :workspace-open="workspaceOpen"
        :chat-settings-open="chatSettingsOpen"
        @toggle-workspace="toggleWorkspace"
        @open-chat-settings="openChatSettings"
      />
      <!-- 异步委托进行中：顶栏下常驻 Fleet -->
      <DelegationFleetBar
        :items="fleetItems"
        :token="token"
        :user-id="userId"
        @cancelled="noteFleetCancelled"
      />
      <div ref="bodyEl" class="relative flex min-h-0 min-w-0 flex-1">
        <!-- 对话区；右缘可拖，给右侧功能栏（工作空间等）让宽 -->
        <div
          class="relative min-h-0 min-w-80 flex-1"
          :class="rightPaneOpen ? 'z-30' : undefined"
        >
          <Thread
            :approval="approval"
            :ask-user="askUser"
            @decide="(allow, scope) => emit('decide', allow, scope)"
            @answer="(answer) => emit('answer', answer)"
          />
          <button
            v-if="rightPaneOpen && agentId && token && userId"
            type="button"
            class="app-no-drag absolute inset-y-0 right-0 z-10 hidden w-1.5 translate-x-1/2 cursor-col-resize border-0 bg-transparent p-0 outline-none transition duration-200 hover:bg-accent/30 focus-visible:bg-accent/40 min-[730px]:block"
            aria-label="调整对话区宽度"
            @pointerdown="onThreadResize"
          />
        </div>
        <button
          v-if="rightPaneOpen"
          type="button"
          class="absolute inset-0 z-10 bg-black/40 min-[730px]:hidden"
          :aria-label="chatSettingsOpen ? t('chatSettingsClose') : t('wsClose')"
          @click="closeRightPane"
        />
        <div
          v-if="rightPaneOpen && agentId && token && userId"
          class="absolute inset-y-0 right-0 z-20 flex h-full shrink-0 min-[730px]:static"
          :style="{ width: `${rightPaneWidth}px` }"
        >
          <WorkspacePanel
            v-if="workspaceOpen"
            :token="token"
            :user-id="userId"
            :agent-id="agentId"
            :personal="extras.personal"
            :generation="workspaceGeneration"
            class="h-full w-full"
            @close="closeRightPane"
          />
          <ChatSettingsPanel
            v-else-if="chatSettingsOpen"
            :token="token"
            :user-id="userId"
            :agent-id="agentId"
            class="h-full w-full"
            @close="closeRightPane"
          />
        </div>
      </div>
    </div>
  </AuiProvider>
</template>

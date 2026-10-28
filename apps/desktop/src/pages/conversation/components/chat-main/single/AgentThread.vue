<script setup lang="ts">
import { AISDKChat } from "@assistant-ui/ai-sdk";
import { SimpleImageAttachmentAdapter } from "@assistant-ui/core";
import { AuiConfig, AuiProvider } from "@assistant-ui/vue";
import type { UIMessage } from "ai";
import { computed, onBeforeUnmount, provide, ref, toRef, watch } from "vue";

import ChatSettingsPanel from "./ChatSettingsPanel.vue";
import WorkspacePanel from "../shared/workspace/WorkspacePanel.vue";

import { useDesktop } from "../../../../../app/desktop";
import { createAgentUpTransport } from "../../../../../shared/api/agent-transport";
import { runtimeBaseUrl as defaultRuntimeBaseUrl } from "../../../../../shared/api/runtime";
import type { BusyTurn } from "../../../../../shared/api/runtime/chat";
import {
  isAgentUpApproval,
  isAgentUpAskUser,
  isAgentUpDelegationStarted,
  isAgentUpModelUnavailable,
  isAgentUpShellHang,
  lastMessagePreview,
  type AgentUpApprovalData,
  type AgentUpAskUserData,
  type AgentUpShellHangData,
  type ApprovalScope,
  type AskUserAnswer,
  type ShellHangAction,
} from "../../../../../shared/model/chat/chat";
import { showToast } from "../../../../../shared/model/ui/toast";
import { t } from "../../../../../shared/model/ui/ui-locale";
import { useDelegationFleet } from "../../../composables/useDelegationFleet";
import { useWakeTurnStream } from "../../../composables/useWakeTurnStream";
import { useWorkspacePaneWidth } from "../../../composables/usePaneWidth";
import { clampWorkspaceWidth } from "../../../model/layout/pane-width";
import { clearProcessFoldState } from "../../../model/message/process-fold-state";
import { threadActionsKey, type ThreadActions } from "../../../model/thread/thread-actions";
import { threadActiveKey } from "../../../model/thread/thread-active";
import { threadAgentIdKey } from "../../../model/thread/thread-agent-id";
import { threadApprovalKey } from "../../../model/thread/thread-approval";
import { threadAskUserKey } from "../../../model/thread/thread-ask-user";
import { threadBusyTurnKey } from "../../../model/thread/thread-busy-turn";
import { threadWakeLiveKey } from "../../../model/thread/thread-wake-live";
import {
  threadDelegationKey,
  type DelegationProcessTarget,
  type ThreadDelegationApi,
} from "../../../model/thread/thread-delegation";
import { threadExtrasKey, type ThreadExtras } from "../../../model/thread/thread-extras";
import {
  threadEarlierKey,
  threadRevealConsumedKey,
  threadRevealEarlierKey,
  type ThreadEarlier,
} from "../../../model/thread/thread-earlier";
import { threadRosterKey, type ThreadRoster } from "../../../model/thread/thread-roster";
import type { IncomingDelegation } from "../../../model/sidebar/delegation-presence";
import OrchestrationBar from "../shared/thread/assistant-ui/byproducts/OrchestrationBar.vue";
import DelegationProcessDialog from "../shared/thread/assistant-ui/byproducts/DelegationProcessDialog.vue";
import Thread from "../shared/thread/Thread.vue";
import Composer from "../shared/thread/composer/Composer.vue";
import ApprovalDock from "../shared/thread/dock/ApprovalDock.vue";
import AskUserDock from "../shared/thread/dock/AskUserDock.vue";
import PlanDock from "../shared/thread/dock/PlanDock.vue";
import ShellHangDock from "../shared/thread/dock/ShellHangDock.vue";
import ConversationHeader from "./ConversationHeader.vue";
import DelegationOccupancyBanner from "./DelegationOccupancyBanner.vue";
import ThreadRunningBridge from "./ThreadRunningBridge.vue";
import ChatPane from "../shared/ChatPane.vue";

const props = withDefaults(
  defineProps<{
    agentId: string;
    token: string;
    userId: string;
    messages: UIMessage[];
    extras: ThreadExtras;
    /** 侧栏名片 + 打开会话，供协助头像解析与跳转。 */
    roster?: ThreadRoster;
    /** attention 本会话 busy turn（wake 编排可见）。 */
    busyTurn?: BusyTurn | null;
    /** 主区当前是否显示本线程（切走再进时清空过程折叠记忆）。 */
    active?: boolean;
    /** 别人派给本 Agent、仍在进行的异步委托。直聊横幅用，不进历史。 */
    incomingDelegations?: IncomingDelegation[];
    approval?: AgentUpApprovalData;
    askUser?: AgentUpAskUserData;
    shellHang?: AgentUpShellHangData;
    runtimeBaseUrl?: string;
    abortTurn?: () => Promise<void>;
    /** wake 流结束后重载历史，并入 AISDKChat（流式过程走 /turn-stream 直播）。 */
    reloadHistory?: () => Promise<void>;
    historyHasMore?: boolean;
    loadOlder?: () => Promise<number>;
    revealEarlier?: number;
    consumeReveal?: () => void;
    clearContext?: () => Promise<void>;
    clearHistory?: () => Promise<void>;
    setRemark?: (remark: string) => Promise<void>;
    dismiss?: () => Promise<void>;
  }>(),
  { active: true, busyTurn: null, incomingDelegations: () => [] },
);
const emit = defineEmits<{
  decide: [allow: boolean, scope?: ApprovalScope];
  approval: [value: AgentUpApprovalData | undefined];
  askUser: [value: AgentUpAskUserData | undefined];
  shellHang: [value: AgentUpShellHangData | undefined];
  answer: [answer: AskUserAnswer];
  "shell-hang-decide": [action: ShellHangAction];
  "turn-end": [preview: string, messages: UIMessage[]];
  running: [running: boolean];
}>();

provide(threadExtrasKey, toRef(props, "extras"));
provide(
  threadEarlierKey,
  computed<ThreadEarlier>(() => ({
    hasMore: props.historyHasMore === true,
    loadOlder: props.loadOlder ?? (async () => 0),
  })),
);
provide(
  threadRevealEarlierKey,
  computed(() => props.revealEarlier ?? 0),
);
provide(threadRevealConsumedKey, () => {
  props.consumeReveal?.();
});
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
// 顶栏与 Thread 内 Composer 都能读到 pending HITL / wake
provide(threadAskUserKey, toRef(props, "askUser"));
provide(threadApprovalKey, toRef(props, "approval"));
provide(threadBusyTurnKey, toRef(props, "busyTurn"));

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

const { pulseFleets } = useDesktop();
const runningDelegations = computed(() => pulseFleets.value.runningDelegations);
const runningJobs = computed(() => pulseFleets.value.runningJobs);
const {
  items: fleetItems,
  noteStarted: noteFleetStarted,
  noteCancelled: noteFleetCancelled,
} = useDelegationFleet({
  agentId: toRef(props, "agentId"),
  active: toRef(props, "active"),
  runningDelegations,
  runningJobs,
});

const wakeEnabled = computed(
  () => Boolean(props.active && props.busyTurn?.phase === "wake"),
);
const streamRunning = ref(false);

const { streaming: wakeStreaming, liveMessage: wakeLiveMessage } = useWakeTurnStream({
  baseUrl: resolvedRuntimeBaseUrl,
  token: toRef(props, "token"),
  userId: toRef(props, "userId"),
  agentId: toRef(props, "agentId"),
  enabled: wakeEnabled,
  handlers: {
    onApproval: (data) => emit("approval", data),
    onAskUser: (data) => emit("askUser", data),
    onShellHang: (data) => emit("shellHang", data),
    onDelegationStarted: (data) => {
      delegationApi.value.registerStarted(data);
      noteFleetStarted(data);
    },
    onDone: () => {
      void props.reloadHistory?.();
    },
  },
});

provide(
  threadWakeLiveKey,
  computed(() => ({
    streaming: wakeStreaming.value,
    message:
      wakeEnabled.value || wakeStreaming.value ? wakeLiveMessage.value : null,
  })),
);

const orchestrating = computed(
  () =>
    wakeEnabled.value ||
    wakeStreaming.value ||
    fleetItems.value.length > 0 ||
    streamRunning.value,
);

watch(orchestrating, (value) => emit("running", value), { immediate: true });

// 重新进入本对话：清空过程折叠缓存（组件常驻 v-show，不能靠卸载）
watch(
  () => props.active,
  (active, prev) => {
    if (active && prev === false) clearProcessFoldState(props.agentId);
  },
);
const clearing = ref(false);
const clearingHistory = ref(false);
/** 立刻收起 AskUser / 审批 / 命令超时浮层（不依赖 SSE）。 */
function dismissHitl(): void {
  if (props.askUser) emit("askUser", undefined);
  if (props.approval) emit("approval", undefined);
  if (props.shellHang) emit("shellHang", undefined);
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
      if (part.type === "data-agentup-shell-hang" && isAgentUpShellHang(part.data)) {
        emit("shellHang", part.data);
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
    <ThreadRunningBridge @change="streamRunning = $event" @dismiss-hitl="dismissHitl" />
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
    <ChatPane :side-open="rightPaneOpen" @row="setBodyRow">
      <template #header>
        <ConversationHeader
          :workspace-open="workspaceOpen"
          :chat-settings-open="chatSettingsOpen"
          @toggle-workspace="toggleWorkspace"
          @open-chat-settings="openChatSettings"
        />
      </template>
      <template #banner>
        <DelegationOccupancyBanner
          v-if="incomingDelegations.length > 0"
          :tasks="incomingDelegations"
        />
      </template>
      <template #process>
        <OrchestrationBar
          :items="fleetItems"
          :busy-turn="busyTurn"
          :token="token"
          :user-id="userId"
          @cancelled="noteFleetCancelled"
          @stop-turn="void threadActions.stopTurn()"
        />
      </template>
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
          v-if="rightPaneOpen && agentId && token && userId"
          type="button"
          class="app-no-drag absolute inset-y-0 right-0 z-10 hidden w-1.5 translate-x-1/2 cursor-col-resize border-0 bg-transparent p-0 outline-none transition duration-200 hover:bg-accent/30 focus-visible:bg-accent/40 min-[730px]:block"
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
      </template>
    </ChatPane>
  </AuiProvider>
</template>

<script setup lang="ts">
import type { UIMessage } from "ai";
import { computed, onActivated, ref, watch } from "vue";

import { useDesktop } from "../../app/desktop";
import type { ApprovalScope, AskUserAnswer } from "../../shared/model/chat";
import AgentSidebar from "./components/agent-sidebar/AgentSidebar.vue";
import AgentThread from "./components/agent-main/AgentThread.vue";
import { useAgentChat } from "./composables/useAgentChat";
import { useSidebarPaneWidth } from "./composables/usePaneWidth";
import { buildConversationRows, hasRecruitedMarketAgent } from "./model/conversation-row";
import type { ThreadExtras } from "./model/thread-extras";
import type { ThreadRoster } from "./model/thread-roster";
import { mountedThreads, pruneVisited, rememberVisited } from "./model/visited-threads";
import { useProviderSettings } from "../settings/composables/useProviderSettings";

defineOptions({ name: "ConversationPage" });

const emptyMessages: UIMessage[] = [];
const layoutEl = ref<HTMLElement | null>(null);
const { width: sidebarWidth, startResize: startSidebarResize } = useSidebarPaneWidth();

function onSidebarResize(event: PointerEvent): void {
  if (!layoutEl.value) return;
  startSidebarResize(event, layoutEl.value, "from-left");
}

const {
  conversations,
  selectedId,
  synced,
  unread,
  previews,
  lastActiveAt,
  session,
  selected,
  busyAgent,
  select,
  start,
  recordTurnEnd,
  setRemark,
  dismiss,
  refresh,
} = useDesktop();
const chat = useAgentChat(undefined, {
  onTurnEnd(agentId, preview) {
    void recordTurnEnd(agentId, preview);
  },
});
const providerSettings = useProviderSettings();
/** KeepAlive 首次激活会紧跟 onMounted，避免重复拉配置。 */
let providerSettingsActivated = false;
onActivated(() => {
  if (!providerSettingsActivated) {
    providerSettingsActivated = true;
    return;
  }
  void providerSettings.load();
});
const visitedAgentIds = ref<string[]>([]);
/** 各已挂载线程的 isRunning；侧栏用此替代未读角标。 */
const workingAgents = ref<Record<string, true>>({});

const rows = computed(() =>
  buildConversationRows({
    conversations: conversations.value,
    previews: previews.value,
    lastActiveAt: lastActiveAt.value,
    selectedId: selectedId.value,
    busyAgent: busyAgent.value,
    unread: unread.value,
    awaitingApproval: Object.keys(chat.approvals.value),
    awaitingAskUser: Object.keys(chat.askUsers.value),
    working: Object.keys(workingAgents.value),
  }),
);
/** 尚无第三方招募时，侧栏展示去市场引导。 */
const showRecruitNudge = computed(() => !hasRecruitedMarketAgent(conversations.value));
const threads = computed(() => mountedThreads(visitedAgentIds.value, chat.loadEpoch.value));

watch(
  conversations,
  (list) => {
    const ids = new Set(list.map((agent) => agent.agentId));
    for (const agentId of Object.keys(chat.histories.value)) {
      if (!ids.has(agentId)) chat.forget(agentId);
    }
    visitedAgentIds.value = pruneVisited(visitedAgentIds.value, ids);
    const nextWorking = { ...workingAgents.value };
    let changed = false;
    for (const agentId of Object.keys(nextWorking)) {
      if (!ids.has(agentId)) {
        delete nextWorking[agentId];
        changed = true;
      }
    }
    if (changed) workingAgents.value = nextWorking;
  },
  { deep: true },
);

function setWorking(agentId: string, running: boolean): void {
  if (!agentId) return;
  if (running) {
    if (workingAgents.value[agentId]) return;
    workingAgents.value = { ...workingAgents.value, [agentId]: true };
    return;
  }
  if (!workingAgents.value[agentId]) return;
  const next = { ...workingAgents.value };
  delete next[agentId];
  workingAgents.value = next;
}

// 先拉完历史再挂载线程，避免 AISDKChat 带着空 messages 起了又收不到 history。
watch(
  [
    () => session.value?.token,
    () => session.value?.userId,
    () => selected.value?.agentId,
    () => selected.value?.recruited,
  ],
  ([token, userId, agentId, recruited]: [
    string | undefined,
    string | undefined,
    string | undefined,
    boolean | undefined,
  ]) => {
    if (!token || !userId || !agentId || !recruited) return;
    chat.watchDelegations(agentId, token, userId);
    void chat.load(agentId, token, userId).then(() => {
      if (chat.isLoaded(agentId, userId)) {
        visitedAgentIds.value = rememberVisited(visitedAgentIds.value, agentId);
      }
    });
  },
  { immediate: true },
);

function extrasFor(agentId: string): ThreadExtras {
  const agent = conversations.value.find((item) => item.agentId === agentId);
  return {
    personal: agent?.kind === "personal",
    name: agent?.name ?? "",
    role: agent?.role ?? "",
    remark: agent?.remark ?? "",
    summary: agent?.summary ?? "",
    avatarUrl: agent?.avatarUrl,
    recruited: agent?.recruited ?? false,
    syncedVersion: agent ? synced.value[agent.agentId] ?? "" : "",
    busy: busyAgent.value === agentId,
    modelConfigured: providerSettings.configured.value,
    modelLoaded: providerSettings.loaded.value,
  };
}

const emptyExtras = computed<ThreadExtras>(() => ({
  personal: false,
  name: "",
  role: "",
  remark: "",
  summary: "",
  recruited: false,
  syncedVersion: "",
  busy: false,
  modelConfigured: providerSettings.configured.value,
  modelLoaded: providerSettings.loaded.value,
}));

function decide(agentId: string, allow: boolean, scope: ApprovalScope = "once"): void {
  if (session.value) void chat.decide(agentId, session.value.token, allow, scope);
}

function answerAsk(agentId: string, answer: AskUserAnswer): void {
  if (session.value) void chat.answerAsk(agentId, session.value.token, answer);
}

async function clearContext(agentId: string): Promise<void> {
  if (!session.value) return;
  await chat.clearContext(agentId, session.value.token, session.value.userId);
}

async function clearHistory(agentId: string): Promise<void> {
  if (!session.value) return;
  await chat.clearHistory(agentId, session.value.token, session.value.userId);
  await refresh();
}

function onTurnEnd(agentId: string, preview: string, messages: UIMessage[]): void {
  chat.syncMessages(agentId, messages);
  chat.turnEnded(agentId, preview);
}

const threadRoster = computed((): ThreadRoster => ({
  agents: conversations.value.map((agent) => ({
    agentId: agent.agentId,
    name: agent.name,
    remark: agent.remark,
    avatarUrl: agent.avatarUrl,
    available: agent.recruited === true || agent.kind === "personal",
  })),
  openAgent(agentId: string) {
    const agent = conversations.value.find((item) => item.agentId === agentId);
    if (!agent || (agent.kind !== "personal" && !agent.recruited)) {
      return "dismissed";
    }
    select(agent);
    return "opened";
  },
}));
</script>

<template>
  <div
    ref="layoutEl"
    class="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-paper min-[730px]:grid-cols-[var(--conversation-sidebar)_minmax(0,1fr)] min-[730px]:grid-rows-1"
    :style="{ '--conversation-sidebar': `${sidebarWidth}px` }"
  >
    <!-- 会话侧栏（微信列表面） -->
    <aside class="relative flex min-h-0 min-w-0 flex-col border-r border-rule bg-paper text-foreground">
      <AgentSidebar :rows="rows" :show-recruit-nudge="showRecruitNudge" @select="select" @start="start" />
      <button
        type="button"
        class="app-no-drag absolute inset-y-0 right-0 z-10 hidden w-1.5 translate-x-1/2 cursor-col-resize border-0 bg-transparent p-0 outline-none transition duration-200 hover:bg-accent/30 focus-visible:bg-accent/40 min-[730px]:block"
        aria-label="调整会话列表宽度"
        @pointerdown="onSidebarResize"
      />
    </aside>

    <!-- 会话主区：已访问线程叠放常驻，切走 v-show 隐藏以保留 stream -->
    <main class="relative min-h-0 min-w-0 overflow-hidden bg-background">
      <div
        v-for="thread in threads"
        v-show="selected?.agentId === thread.agentId"
        :key="`${thread.agentId}:${thread.epoch}`"
        class="absolute inset-0 min-h-0 min-w-0 overflow-hidden"
      >
        <AgentThread
          :agent-id="thread.agentId"
          :token="session?.token ?? ''"
          :user-id="session?.userId ?? ''"
          :messages="chat.histories.value[thread.agentId] ?? emptyMessages"
          :extras="extrasFor(thread.agentId)"
          :roster="threadRoster"
          :active="selected?.agentId === thread.agentId"
          :approval="chat.approvals.value[thread.agentId]"
          :ask-user="chat.askUsers.value[thread.agentId]"
          :clear-context="() => clearContext(thread.agentId)"
          :clear-history="() => clearHistory(thread.agentId)"
          :set-remark="(remark) => setRemark(thread.agentId, remark)"
          :dismiss="() => dismiss(thread.agentId)"
          @decide="(allow, scope) => decide(thread.agentId, allow, scope)"
          @approval="chat.setApproval(thread.agentId, $event)"
          @ask-user="chat.setAskUser(thread.agentId, $event)"
          @answer="(answer) => answerAsk(thread.agentId, answer)"
          @turn-end="(preview, messages) => onTurnEnd(thread.agentId, preview, messages)"
          @running="setWorking(thread.agentId, $event)"
        />
      </div>
      <div
        v-if="!selected || !session"
        key="empty"
        class="absolute inset-0 min-h-0 min-w-0 overflow-hidden"
      >
        <AgentThread
          agent-id=""
          token=""
          user-id=""
          :messages="[]"
          :extras="emptyExtras"
        />
      </div>
    </main>
  </div>
</template>

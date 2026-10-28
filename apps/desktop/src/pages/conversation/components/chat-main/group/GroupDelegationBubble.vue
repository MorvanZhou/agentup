<script setup lang="ts">
import {
  BanIcon,
  CircleCheckIcon,
  CircleXIcon,
  ClockIcon,
  HourglassIcon,
  InboxIcon,
  LoaderCircleIcon,
  type LucideIcon,
} from "@lucide/vue";
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from "reka-ui";
import { computed, inject, ref, watch } from "vue";

import AgentAvatar from "../../../../../shared/components/avatar/AgentAvatar.vue";
import { useTabScrollPin } from "../../../composables/tab-scroll-pin";
import { useDelegationProcess } from "../../../composables/useDelegationProcess";
import {
  buildDelegationOuterTabs,
  delegationByproductsAreLive,
  type DelegationOuterTabId,
} from "../../../model/group/delegation-bubble-tabs";
import { delegationWorkspaceAgentId } from "../../../model/message/message-artifacts";
import { buildLatestAssistantByproducts } from "../../../model/message/message-byproducts";
import {
  groupDelegationPhase,
  groupDelegationRuntimeKey,
  groupWaitingTaskIdsKey,
  type GroupDelegationCard,
  type GroupDelegationPhase,
} from "../../../model/group/group-delegation";
import { t } from "../../../../../shared/model/ui/ui-locale";
import DelegationProcessProducts from "../shared/thread/assistant-ui/byproducts/DelegationProcessProducts.vue";
import ChatBubble from "../shared/ChatBubble.vue";

const props = defineProps<{ card: GroupDelegationCard }>();

// 群委派气泡：waiting 只看当前 HITL 是否还挂着这张卡的 taskId。
const waitingIds = inject(groupWaitingTaskIdsKey, null);
// 展开过程需要 runtime 票；正文按 taskId 旁路再取，不进群线程。
const runtime = inject(groupDelegationRuntimeKey, null);
const bubble = ref<{ surfaceEl: HTMLElement | null } | null>(null);
const { pin } = useTabScrollPin();

const {
  loading,
  streaming,
  error,
  messages,
  task,
  open: loadProcess,
  stop,
} = useDelegationProcess();

// 群产物在共享工作区；history 未回前先用专员 id，避免空 agentId。
const workspaceAgentId = computed(() =>
  delegationWorkspaceAgentId({
    groupId: task.value?.groupId,
    toAgentId: task.value?.toAgentId || props.card.authorId,
    fallback: props.card.taskId || "delegation",
  }),
);

const phase = computed<GroupDelegationPhase>(() =>
  groupDelegationPhase(
    props.card,
    // 委派阶段：该 taskId 仍在群 HITL 等待列表里才标 waiting。
    Boolean(props.card.taskId && waitingIds?.value.includes(props.card.taskId)),
  ),
);

// 图标旁无文案，词条只进 aria-label / title。
const phaseLabel = computed(() => {
  const labels: Record<GroupDelegationPhase, string> = {
    queued: t("groupTaskQueued"),
    running: t("groupTaskRunning"),
    waiting: t("groupTaskWaiting"),
    pending_summary: t("groupTaskPendingSummary"),
    completed: t("groupTaskCompleted"),
    failed: t("groupTaskFailed"),
    cancelled: t("groupTaskCancelled"),
  };
  return labels[phase.value];
});

const phaseIcon = computed(() => {
  const icons: Record<GroupDelegationPhase, LucideIcon> = {
    queued: ClockIcon,
    running: LoaderCircleIcon,
    waiting: HourglassIcon,
    pending_summary: InboxIcon,
    completed: CircleCheckIcon,
    failed: CircleXIcon,
    cancelled: BanIcon,
  };
  return icons[phase.value];
});

// 默认只出图标；点击展开阶段文案，再点收起。
const phaseLabelOpen = ref(false);

function togglePhaseLabel(): void {
  phaseLabelOpen.value = !phaseLabelOpen.value;
}

watch(phase, () => {
  phaseLabelOpen.value = false;
});

const canOpen = computed(
  // 缺 taskId 或 runtime 票时拉不到委派过程，过程 tab 不出现。
  () => Boolean(props.card.taskId && runtime?.value.token && runtime.value.userId),
);

const outer = computed(() =>
  buildDelegationOuterTabs({
    brief: props.card.brief,
    canOpenProcess: canOpen.value,
    // 停 SSE 只代表不再看过程，不代表子任务已经写出总结。
    byproducts: buildLatestAssistantByproducts(
      messages.value,
      delegationByproductsAreLive({
        streaming: streaming.value,
        taskStatus: task.value?.status,
      }),
    ),
  }),
);

const activeTab = ref<DelegationOuterTabId | null>(null);

function selectTab(next: DelegationOuterTabId | null): void {
  if (next === activeTab.value) return;
  pin(bubble.value?.surfaceEl ?? null);
  activeTab.value = next;
}

function onActiveTabChange(id: string | number): void {
  const next = String(id) as DelegationOuterTabId;
  if (!outer.value.tabs.some((tab) => tab.id === next)) return;
  selectTab(next);
}

function startProcess(): void {
  const current = runtime?.value;
  if (!current?.token || !current.userId || !props.card.taskId) return;
  void loadProcess({
    token: current.token,
    userId: current.userId,
    taskId: props.card.taskId,
    baseUrl: current.baseUrl,
  });
}

function isHistoryTab(id: DelegationOuterTabId | null): boolean {
  return id !== null && id !== "brief";
}

// 首次进入 history 副产物才拉旁路；在这些 tab 内切换时不断 SSE。
watch(activeTab, (next, prev) => {
  if (isHistoryTab(prev) && !isHistoryTab(next)) stop();
  if (isHistoryTab(next) && !isHistoryTab(prev)) startProcess();
});

watch(
  () => outer.value.defaultTabId,
  (id) => {
    // history 回来后新增总结 / 产物，不抢走用户正在查看的过程。
    if (!activeTab.value || !outer.value.tabs.some((tab) => tab.id === activeTab.value)) {
      selectTab(id);
    }
  },
  { immediate: true },
);
watch(
  () => outer.value.tabs.map((tab) => tab.id).join(","),
  () => {
    if (activeTab.value && !outer.value.tabs.some((tab) => tab.id === activeTab.value)) {
      selectTab(outer.value.defaultTabId);
    }
  },
);

const taskError = computed(() =>
  task.value?.status === "failed" && task.value.error ? task.value.error : "",
);
</script>

<template>
  <!-- 群委派气泡 -->
  <ChatBubble ref="bubble" side="agent" tag="li" :padded="false">
    <template #avatar>
      <!-- 子 Agent 头像 -->
      <AgentAvatar :name="card.authorName || 'A'" :avatar-url="card.avatarUrl" size="lg" />
    </template>
    <template #header>
      <!-- 子 Agent 名称与角色 -->
      <div class="flex min-w-0 items-baseline gap-1.5 px-0.5">
        <span class="truncate text-xs font-medium text-foreground">{{ card.authorName }}</span>
        <span v-if="card.role" class="min-w-0 truncate text-xs text-muted-foreground">{{ card.role }}</span>
      </div>
    </template>
    <div class="flex min-w-0 flex-col">
      <!-- 无 tab 时：阶段图标单独一行靠右 -->
      <div v-if="!activeTab" class="flex justify-end px-3 py-3">
        <!-- 委派阶段：点图标展开文案 -->
        <button
          type="button"
          class="inline-flex items-center gap-1 rounded-md text-accent outline-none hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-accent/15 dark:hover:bg-white/5"
          :aria-label="phaseLabel"
          :aria-expanded="phaseLabelOpen"
          @click="togglePhaseLabel"
        >
          <component
            :is="phaseIcon"
            class="size-3.5 shrink-0"
            :class="phase === 'running' ? 'animate-spin motion-reduce:animate-none' : ''"
            aria-hidden="true"
          />
          <span v-if="phaseLabelOpen" class="text-xs font-medium whitespace-nowrap">{{ phaseLabel }}</span>
        </button>
      </div>
      <TabsRoot
        v-else
        :model-value="activeTab"
        class="flex w-full min-w-0 flex-col"
        @update:model-value="onActiveTabChange"
      >
        <!-- 外层顶栏：左侧 tab，右侧委派阶段图标垂直居中 -->
        <div
          class="flex min-w-0 gap-2"
          :class="
            outer.showTabBar
              ? 'items-stretch border-b border-rule/70 bg-paper/70 px-2 pt-1.5'
              : 'items-center justify-end px-3 pt-3'
          "
        >
          <TabsList
            v-if="outer.showTabBar"
            class="flex min-w-0 flex-1 flex-wrap items-end gap-0.5"
            :aria-label="t('groupTaskTabs')"
          >
            <TabsTrigger
              v-for="tab in outer.tabs"
              :key="tab.id"
              :value="tab.id"
              :data-testid="`delegation-tab-${tab.id}`"
              class="relative -mb-px inline-flex min-h-8 max-w-[9rem] items-center gap-1 truncate rounded-t-lg border border-transparent px-3 text-xs font-medium text-muted-foreground transition duration-200 hover:text-foreground data-[state=active]:border-rule/70 data-[state=active]:border-b-muted data-[state=active]:bg-muted data-[state=active]:text-foreground data-[state=inactive]:hover:bg-black/5 dark:data-[state=inactive]:hover:bg-white/5"
            >
              <span class="truncate">{{ tab.label }}</span>
              <span
                v-if="tab.badge"
                class="inline-flex min-w-4 shrink-0 items-center justify-center rounded-md bg-accent/15 px-1 text-[10px] font-semibold tabular-nums leading-4 text-accent"
              >
                {{ tab.badge }}
              </span>
            </TabsTrigger>
          </TabsList>
          <!-- 委派阶段：顶栏最右，垂直居中；点图标展开文案 -->
          <button
            type="button"
            class="inline-flex shrink-0 items-center gap-1 self-center rounded-md px-1 text-accent outline-none hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-accent/15 dark:hover:bg-white/5"
            :aria-label="phaseLabel"
            :aria-expanded="phaseLabelOpen"
            @click="togglePhaseLabel"
          >
            <component
              :is="phaseIcon"
              class="size-3.5 shrink-0"
              :class="phase === 'running' ? 'animate-spin motion-reduce:animate-none' : ''"
              aria-hidden="true"
            />
            <span v-if="phaseLabelOpen" class="text-xs font-medium whitespace-nowrap">{{ phaseLabel }}</span>
          </button>
        </div>

        <div :class="outer.showTabBar ? 'px-3 py-3' : 'px-3 pb-3 pt-1.5'">
          <!-- 委派简述 -->
          <TabsContent
            v-if="outer.tabs.some((tab) => tab.id === 'brief')"
            value="brief"
            class="min-w-0 outline-none"
          >
            <p class="m-0 text-xs leading-snug text-pretty text-muted-foreground opacity-80">{{ card.brief }}</p>
          </TabsContent>
          <!-- 子任务 history 的总结 -->
          <TabsContent
            v-if="outer.tabs.some((tab) => tab.id === 'summary')"
            value="summary"
            class="min-w-0 outline-none"
          >
            <DelegationProcessProducts
              :messages="messages"
              :streaming="streaming"
              :loading="loading"
              :error="error"
              :task-error="taskError"
              :agent-id="workspaceAgentId"
              tab="summary"
            />
          </TabsContent>
          <!-- 子任务 ARTIFACT 产物 -->
          <TabsContent
            v-if="outer.tabs.some((tab) => tab.id === 'artifacts')"
            value="artifacts"
            class="min-w-0 outline-none"
          >
            <DelegationProcessProducts
              :messages="messages"
              :streaming="streaming"
              :loading="loading"
              :error="error"
              :task-error="taskError"
              :agent-id="workspaceAgentId"
              tab="artifacts"
            />
          </TabsContent>
          <!-- 子任务待办 -->
          <TabsContent
            v-if="outer.tabs.some((tab) => tab.id === 'todo')"
            value="todo"
            class="min-w-0 outline-none"
          >
            <DelegationProcessProducts
              :messages="messages"
              :streaming="streaming"
              :loading="loading"
              :error="error"
              :task-error="taskError"
              :agent-id="workspaceAgentId"
              tab="todo"
            />
          </TabsContent>
          <!-- 子任务过程：只显示时间线 -->
          <TabsContent
            v-if="outer.tabs.some((tab) => tab.id === 'process')"
            value="process"
            class="min-w-0 outline-none"
          >
            <DelegationProcessProducts
              :messages="messages"
              :streaming="streaming"
              :loading="loading"
              :error="error"
              :task-error="taskError"
              :agent-id="workspaceAgentId"
              tab="process"
            />
          </TabsContent>
          <!-- 子任务继续委派的 Agent 产物 -->
          <TabsContent
            v-if="outer.tabs.some((tab) => tab.id === 'subagents')"
            value="subagents"
            class="min-w-0 outline-none"
          >
            <DelegationProcessProducts
              :messages="messages"
              :streaming="streaming"
              :loading="loading"
              :error="error"
              :task-error="taskError"
              :agent-id="workspaceAgentId"
              tab="subagents"
            />
          </TabsContent>
        </div>
      </TabsRoot>
    </div>
  </ChatBubble>
</template>

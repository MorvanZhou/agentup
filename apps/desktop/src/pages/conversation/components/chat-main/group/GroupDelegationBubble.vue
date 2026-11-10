<script setup lang="ts">
import { LoaderCircleIcon } from "@lucide/vue";
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from "reka-ui";
import { computed, inject, ref, watch } from "vue";

import { stubAgentCard } from "../../../../../shared/components/agent/agent-profile";
import { agentProfileHostKey } from "../../../../../shared/components/agent/agent-profile-host";
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
import { replyModelFromMessages } from "../../../model/message/message-reply-model";
import {
  groupDelegationPhase,
  groupDelegationRuntimeKey,
  groupWaitingTaskIdsKey,
  type GroupDelegationCard,
} from "../../../model/group/group-delegation";
import { t, tf } from "../../../../../shared/model/ui/ui-locale";
import { selectionToPlainText } from "../../../model/composer/copy-text";
import DelegationProcessProducts from "../shared/thread/assistant-ui/byproducts/DelegationProcessProducts.vue";
import ReplyModelMark from "../shared/thread/assistant-ui/ReplyModelMark.vue";
import ChatBubble from "../shared/ChatBubble.vue";

const props = defineProps<{ card: GroupDelegationCard }>();
const profileHost = inject(agentProfileHostKey, null);
const waitingTaskIds = inject(groupWaitingTaskIdsKey, null);
/** 有专员 id 就可点开资料（host 缺失时点了无响应，仍保留按钮态）。 */
const canOpenProfile = computed(() => Boolean(props.card.authorId));

function openAgentProfile(): void {
  if (!profileHost || !props.card.authorId) return;
  profileHost.open({
    agent: stubAgentCard({
      agentId: props.card.authorId,
      name: props.card.authorName || props.card.authorId,
      role: props.card.role,
      avatarUrl: props.card.avatarUrl,
      kind: "recruited",
      recruited: true,
    }),
  });
}

/** 选区复制：与主 Agent 气泡同一套清洗，去掉 chrome / 尾部空行。 */
function onBubbleCopy(event: ClipboardEvent): void {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
  const cleaned = selectionToPlainText(selection.getRangeAt(0));
  if (!cleaned) return;
  event.clipboardData?.setData("text/plain", cleaned);
  event.preventDefault();
}

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

/** 子任务 history 里最近一条助手的本轮模型；与一对一同形标形。 */
const replyModel = computed(() => replyModelFromMessages(messages.value));

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

/** 顶栏：有 tab，或已拿到模型标时也铺右对齐区。 */
const showChromeBar = computed(
  () => outer.value.showTabBar || Boolean(replyModel.value),
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

const waiting = computed(
  () =>
    Boolean(props.card.taskId) &&
    Boolean(waitingTaskIds?.value.includes(props.card.taskId)),
);
const phase = computed(() => groupDelegationPhase(props.card, waiting.value));
/**
 * 左下角「工作中」：对齐主 Agent AssistantMessage。
 * 卡片仍在排队/执行，或旁路 SSE 仍在推，就给稳定反馈；等人处理或已终态不显示。
 * 旁路已读到终态时以 task.status 为准，避免卡片 activity 滞后仍亮着。
 */
const showWorking = computed(() => {
  const status = task.value?.status;
  if (status === "completed" || status === "failed" || status === "cancelled") {
    return false;
  }
  if (streaming.value) return true;
  return phase.value === "running" || phase.value === "queued";
});
</script>

<template>
  <!-- 群委派气泡 -->
  <ChatBubble ref="bubble" side="agent" tag="li" :padded="false" @copy="onBubbleCopy">
    <template #avatar>
      <!-- 子 Agent 头像：点开资料 -->
      <button
        v-if="canOpenProfile"
        type="button"
        class="cursor-pointer rounded-lg border-0 bg-transparent p-0 outline-none transition duration-150 hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent/40"
        :aria-label="tf('agentsViewProfile', { name: card.authorName || 'A' })"
        @click="openAgentProfile"
      >
        <AgentAvatar :name="card.authorName || 'A'" :avatar-url="card.avatarUrl" size="lg" />
      </button>
      <AgentAvatar
        v-else
        :name="card.authorName || 'A'"
        :avatar-url="card.avatarUrl"
        size="lg"
      />
    </template>
    <template #header>
      <!-- 子 Agent 名称与角色（不进拖选）；名称也可点开资料 -->
      <div
        class="flex min-w-0 items-baseline gap-1.5 px-0.5 select-none"
        data-copy-ignore
      >
        <button
          v-if="canOpenProfile"
          type="button"
          class="truncate border-0 bg-transparent p-0 text-left text-xs font-medium text-foreground outline-none hover:text-accent focus-visible:ring-2 focus-visible:ring-accent/40"
          :aria-label="tf('agentsViewProfile', { name: card.authorName || 'A' })"
          @click="openAgentProfile"
        >
          {{ card.authorName }}
        </button>
        <span v-else class="truncate text-xs font-medium text-foreground">{{ card.authorName }}</span>
        <span v-if="card.role" class="min-w-0 truncate text-xs text-muted-foreground">{{ card.role }}</span>
      </div>
    </template>
    <div class="flex min-w-0 flex-col">
      <TabsRoot
        v-if="activeTab"
        :model-value="activeTab"
        class="flex w-full min-w-0 flex-col"
        @update:model-value="onActiveTabChange"
      >
        <!-- 顶栏：左侧 tab，右侧本轮模型标（与一对一同形；不进拖选） -->
        <div
          v-if="showChromeBar"
          class="flex min-w-0 items-end gap-2 select-none"
          data-copy-ignore
          :class="
            outer.showTabBar
              ? 'border-b border-rule/60 bg-paper px-2 pt-1.5'
              : 'justify-end px-3 pt-3'
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
              class="relative -mb-px inline-flex min-h-8 max-w-[9rem] items-center gap-1 truncate rounded-t-lg border border-transparent px-3 text-xs font-medium text-muted-foreground transition duration-200 hover:text-foreground data-[state=active]:border-rule/70 data-[state=active]:border-b-bubble data-[state=active]:bg-bubble data-[state=active]:text-foreground data-[state=inactive]:hover:bg-black/5 dark:data-[state=inactive]:hover:bg-white/5"
            >
              <span class="truncate">{{ tab.label }}</span>
              <span
                v-if="tab.badge"
                class="inline-flex min-w-4 shrink-0 items-center justify-center rounded-md bg-muted px-1 text-[10px] font-semibold tabular-nums leading-4 text-muted-foreground"
              >
                {{ tab.badge }}
              </span>
            </TabsTrigger>
          </TabsList>
          <div v-else-if="replyModel" class="min-h-8 min-w-0 flex-1" aria-hidden="true" />
          <ReplyModelMark
            v-if="replyModel"
            class="mb-1.5 ml-auto shrink-0 self-center"
            :model="replyModel"
          />
        </div>

        <!-- 水平 padding 下沉到内容层，过程区滚动条可贴气泡右缘 -->
        <div class="py-3">
          <!-- 委派简述 -->
          <TabsContent
            v-if="outer.tabs.some((tab) => tab.id === 'brief')"
            value="brief"
            class="min-w-0 px-3 outline-none"
          >
            <p class="m-0 text-xs leading-snug text-pretty text-muted-foreground opacity-80">{{ card.brief }}</p>
          </TabsContent>
          <!-- 子任务 history 的总结 -->
          <TabsContent
            v-if="outer.tabs.some((tab) => tab.id === 'summary')"
            value="summary"
            class="min-w-0 px-3 outline-none"
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
            class="min-w-0 px-3 outline-none"
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
            class="min-w-0 px-3 outline-none"
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
          <!-- 子任务过程：勿加 px，padding 在滚动内层 -->
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
            class="min-w-0 px-3 outline-none"
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

          <!-- 左下角：子任务仍在跑时提示工作中（对齐主 Agent AssistantMessage） -->
          <div
            v-if="showWorking"
            class="mt-2 flex items-center gap-1.5 px-3 select-none"
            data-copy-ignore
            data-testid="delegation-working"
            role="status"
            aria-live="polite"
          >
            <LoaderCircleIcon
              class="size-3 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
              aria-hidden="true"
            />
            <span class="text-xs text-muted-foreground">{{ t("msgWorking") }}</span>
          </div>
        </div>
      </TabsRoot>
      <!-- 尚无 tab 壳时也要露工作中（排队/刚开工空卡片） -->
      <div
        v-else-if="showWorking"
        class="flex items-center gap-1.5 px-3 py-3 select-none"
        data-copy-ignore
        data-testid="delegation-working"
        role="status"
        aria-live="polite"
      >
        <LoaderCircleIcon
          class="size-3 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
          aria-hidden="true"
        />
        <span class="text-xs text-muted-foreground">{{ t("msgWorking") }}</span>
      </div>
    </div>
  </ChatBubble>
</template>

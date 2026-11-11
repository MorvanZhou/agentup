<script setup lang="ts">
import {
  ActionBarPrimitiveCopy,
  ActionBarPrimitiveReload,
  useAuiState,
} from "@assistant-ui/vue";
import type { } from "@assistant-ui/core/store";
import {
  CheckIcon,
  CopyIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
} from "@lucide/vue";
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from "reka-ui";
import { computed, inject, ref, watch } from "vue";

import { stubAgentCard } from "../../../../../../../shared/components/agent/agent-profile";
import { agentProfileHostKey } from "../../../../../../../shared/components/agent/agent-profile-host";
import AgentAvatar from "../../../../../../../shared/components/avatar/AgentAvatar.vue";
import { t, tf } from "../../../../../../../shared/model/ui/ui-locale";
import { useTabScrollPin } from "../../../../../composables/tab-scroll-pin";
import { selectionToPlainText } from "../../../../../model/composer/copy-text";
import { isOpenAskUserPart } from "../../../../../model/message/ask-user-summary";
import {
  buildAssistantByproducts,
  type ByproductTabId,
} from "../../../../../model/message/message-byproducts";
import { shouldShowAssistantReload } from "../../../../../model/message/assistant-reload";
import { readAgentUpReplyModel } from "../../../../../model/message/message-reply-model";
import { injectPendingAskUserToolCallId } from "../../../../../model/thread/thread-ask-user";
import { chatMessageAuthor } from "../../../../../model/thread/chat-surface";
import { injectThreadAgentId } from "../../../../../model/thread/thread-agent-id";
import { injectThreadExtras } from "../../../../../model/thread/thread-extras";
import { injectThreadWakeLive } from "../../../../../model/thread/thread-wake-live";
import { readAgentUpDeliverables } from "../../../../../model/message/message-deliverables";
import {
  resolveMessagePreviewRecipes,
  type AgentUpPreview,
} from "../../../../../model/message/message-preview";
import AssistAgentsPanel from "./byproducts/AssistAgentsPanel.vue";
import AssistantByproductContent from "./byproducts/AssistantByproductContent.vue";
import DeliverablesGrid from "./DeliverablesGrid.vue";
import PreviewRecipesCard from "./PreviewRecipesCard.vue";
import ReplyModelMark from "./ReplyModelMark.vue";
import ChatBubble from "../../ChatBubble.vue";

/** 选区复制：跳过 tab/操作栏等 chrome，压掉块级壳带来的尾部空行。 */
function onBubbleCopy(event: ClipboardEvent): void {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
  const cleaned = selectionToPlainText(selection.getRangeAt(0));
  if (!cleaned) return;
  event.clipboardData?.setData("text/plain", cleaned);
  event.preventDefault();
}

const extras = injectThreadExtras();
const threadAgentId = injectThreadAgentId();
const profileHost = inject(agentProfileHostKey, null);
const pendingAskUserToolCallId = injectPendingAskUserToolCallId();
const wakeLive = injectThreadWakeLive();
const copied = useAuiState((s) => s.message.isCopied);
const metadata = useAuiState((s) => s.message.metadata);
const messageId = useAuiState((s) => s.message.id);
const threadMessages = useAuiState((s) => s.thread.messages);
const canReload = useAuiState((s) => s.thread.capabilities.reload);
const threadRunning = useAuiState((s) => s.thread.isRunning);
const messageAuthor = computed(() => chatMessageAuthor(metadata.value));
const agentName = computed(() => messageAuthor.value?.name || extras.value.name);
const agentRole = computed(() => messageAuthor.value?.role || "");
/** 本轮回复所用 provider/模型（jsonl → metadata.custom.agentUpReplyModel）。 */
const replyModel = computed(() => readAgentUpReplyModel(metadata.value));
/** 群消息才带 author；单聊页头已有身份，气泡上不再重复。 */
const showAuthorByline = computed(() => Boolean(messageAuthor.value?.name));
const agentAvatar = computed(
  () => messageAuthor.value?.avatarUrl || extras.value.avatarUrl || "",
);
const profileAgentId = computed(() => messageAuthor.value?.id || threadAgentId || "");

/** 点头像开资料；缺 agentId 时不可点 */
function openAgentProfile(): void {
  if (!profileHost || !profileAgentId.value) return;
  const kind =
    extras.value.kind === "personal" ||
      extras.value.kind === "local" ||
      extras.value.kind === "recruited"
      ? extras.value.kind
      : undefined;
  profileHost.open({
    agent: stubAgentCard({
      agentId: profileAgentId.value,
      name: agentName.value || profileAgentId.value,
      role: agentRole.value || extras.value.role,
      remark: extras.value.remark,
      background: extras.value.background,
      avatarUrl: agentAvatar.value || undefined,
      kind,
      recruited: extras.value.recruited,
    }),
  });
}
const error = useAuiState((s) => {
  const message = s.message;
  if (
    message.role !== "assistant" ||
    message.status.type !== "incomplete" ||
    message.status.reason !== "error"
  ) {
    return null;
  }
  const value = message.status.error;
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "message" in value) {
    return String(value.message);
  }
  return t("msgError");
});

const streaming = useAuiState((s) => s.message.status?.type === "running");
/**
 * 只给最新已落定的助手气泡「重新生成」。
 * 本轮正在跑（含 wake 旁路直播）时最新条是生成中那条，历史气泡一律不显示。
 */
const showReload = computed(() => {
  const live = wakeLive?.value;
  return shouldShowAssistantReload({
    canReload: canReload.value,
    messageId: messageId.value,
    messages: threadMessages.value,
    threadRunning: threadRunning.value,
    messageRunning: streaming.value,
    wakeLiveActive: Boolean(live?.streaming || live?.message || live?.userText),
  });
});
const parts = useAuiState((s) => s.message.parts);
const messageCancelStatus = useAuiState((s) => {
  const message = s.message;
  if (message.role !== "assistant") return false;
  return message.status?.type === "incomplete" && message.status.reason === "cancelled";
});
const hasOpenAskUser = useAuiState(
  (s) =>
    s.message.role === "assistant" &&
    s.message.status?.type !== "running" &&
    s.message.parts.some((part) => isOpenAskUserPart(part)),
);
/** 停止后：消息被标 cancelled，或 AskUser 浮层已撤但工具仍无结果。 */
const terminated = computed(
  () =>
    messageCancelStatus.value || (hasOpenAskUser.value && !pendingAskUserToolCallId.value),
);
/** 气泡左下角：本条仍在生成时给稳定反馈（步骤折叠/正文静止时也看得见）。 */
const showWorking = computed(() => streaming.value && !terminated.value);

const byproducts = computed(() =>
  buildAssistantByproducts({
    parts: parts.value,
    metadata: metadata.value,
    streaming: streaming.value,
  }),
);
/** 顶栏：有副产物 tab，或仅有模型标时也铺一条右对齐区。 */
const showChromeBar = computed(
  () => byproducts.value.showTabBar || Boolean(replyModel.value),
);

const activeTab = ref<ByproductTabId>("process");
/**
 * 切 tab / 流式结束去限高：内容高度骤变会让 stick-to-bottom 或 scrollHeight 夹紧拽视口。
 * 用气泡顶边锚定；当帧按住，布局后再对齐。
 */
const bubble = ref<{ surfaceEl: HTMLElement | null } | null>(null);
const { pin: pinTabScroll } = useTabScrollPin();

function onActiveTabChange(id: string | number) {
  const next = String(id) as ByproductTabId;
  if (next === activeTab.value) return;
  // 先按住再换 tab，避免首帧闪一下对话区。
  pinTabScroll(bubble.value?.surfaceEl ?? null);
  activeTab.value = next;
}

watch(
  () => byproducts.value.defaultTabId,
  (id) => {
    activeTab.value = id;
  },
  { immediate: true },
);
watch(
  () => byproducts.value.tabs.map((tab) => tab.id).join(","),
  () => {
    if (!byproducts.value.tabs.some((tab) => tab.id === activeTab.value)) {
      activeTab.value = byproducts.value.defaultTabId;
    }
  },
);

/** 流式结束：过程区去掉 max-height（可能再切 summary），高度骤变时钉住视口。 */
watch(streaming, (now, was) => {
  if (was !== true || now) return;
  pinTabScroll(bubble.value?.surfaceEl ?? null);
});

const hasProcessTab = computed(() =>
  byproducts.value.tabs.some((tab) => tab.id === "process"),
);
const hasSummaryTab = computed(() =>
  byproducts.value.tabs.some((tab) => tab.id === "summary"),
);
const hasArtifactsTab = computed(
  () => (byproducts.value.artifacts?.files.length ?? 0) > 0,
);
/** 收口交付网格：metadata.custom.agentUpDeliverables（与产物 tab 分离）。 */
const deliverables = computed(() => readAgentUpDeliverables(metadata.value));
/** Launch Recipe 卡：仅本条 metadata / present_preview parts，不挂工作区回落。 */
const previewRecipes = computed((): AgentUpPreview | null =>
  resolveMessagePreviewRecipes(metadata.value, parts.value),
);
</script>

<template>
  <ChatBubble ref="bubble" side="agent" :padded="false" @copy="onBubbleCopy">
    <template #avatar>
      <div class="flex shrink-0 flex-col items-end" :class="showAuthorByline ? '' : 'mt-0.5'">
        <button v-if="profileHost && profileAgentId" type="button"
          class="cursor-pointer rounded-lg border-0 bg-transparent p-0 outline-none transition duration-150 hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent/40"
          :aria-label="tf('agentsViewProfile', { name: agentName || 'A' })" @click="openAgentProfile">
          <AgentAvatar :name="agentName || 'A'" :avatar-url="agentAvatar || undefined" size="lg" />
        </button>
        <AgentAvatar v-else :name="agentName || 'A'" :avatar-url="agentAvatar || undefined" size="lg" />
      </div>
    </template>
    <template v-if="showAuthorByline" #header>
      <!-- 署名不进拖选复制 -->
      <div class="flex min-w-0 items-baseline gap-1.5 px-0.5 select-none" data-copy-ignore>
        <span class="truncate text-xs font-medium text-foreground">{{ agentName }}</span>
        <span v-if="agentRole" class="min-w-0 truncate text-xs font-normal text-muted-foreground">{{ agentRole }}</span>
      </div>
    </template>
    <TabsRoot :model-value="activeTab" class="flex w-full min-w-0 flex-col" @update:model-value="onActiveTabChange">
      <!-- 顶栏：标签条 + 右上角本轮模型标（不进拖选） -->
      <!-- 标签条：灰阶顶栏 + 白底激活页签与正文衔接（勿用发黄/accent） -->
      <div v-if="showChromeBar"
        class="flex min-w-0 items-end gap-2 border-b border-rule/60 bg-paper px-2 pt-1.5 select-none" data-copy-ignore>
        <TabsList v-if="byproducts.showTabBar" class="flex min-w-0 flex-1 flex-wrap items-end gap-0.5"
          :aria-label="t('msgProducts')">
          <template v-for="tab in byproducts.tabs" :key="tab.id">
            <TabsTrigger v-if="tab.id !== 'subagents'" :value="tab.id"
              class="relative -mb-px inline-flex min-h-8 max-w-[9rem] items-center gap-1 truncate rounded-t-lg border border-transparent px-3 text-xs font-medium text-muted-foreground transition duration-200 hover:text-foreground data-[state=active]:border-rule/70 data-[state=active]:border-b-bubble data-[state=active]:bg-bubble data-[state=active]:text-foreground data-[state=inactive]:hover:bg-black/5 dark:data-[state=inactive]:hover:bg-white/5">
              <span class="truncate">{{ tab.label }}</span>
              <span v-if="tab.badge"
                class="inline-flex min-w-4 shrink-0 items-center justify-center rounded-md bg-muted px-1 text-[10px] font-semibold tabular-nums leading-4 text-muted-foreground">
                {{ tab.badge }}
              </span>
            </TabsTrigger>
            <TabsTrigger v-else :value="tab.id"
              class="relative -mb-px inline-flex min-h-8 items-center rounded-t-lg border border-transparent px-2 transition duration-200 data-[state=active]:border-rule/70 data-[state=active]:border-b-bubble data-[state=active]:bg-bubble data-[state=inactive]:hover:bg-black/5 dark:data-[state=inactive]:hover:bg-white/5"
              :aria-label="t('msgAssistAgents')">
              <AssistAgentsPanel :assists="byproducts.assists" variant="trigger" />
            </TabsTrigger>
          </template>
        </TabsList>
        <div v-else class="min-h-8 min-w-0 flex-1" aria-hidden="true" />
        <ReplyModelMark v-if="replyModel" class="mb-1.5 ml-auto shrink-0 self-center" :model="replyModel" />
      </div>

      <!-- 水平 padding 下沉到内容层，过程区滚动条可贴气泡右缘 -->
      <div class="py-3">
        <!-- 总结：仅主产物 text -->
        <TabsContent v-if="hasSummaryTab && byproducts.summaryPartIndex !== undefined" value="summary"
          class="min-w-0 px-3 outline-none">
          <AssistantByproductContent tab="summary" />
        </TabsContent>

        <!-- 本回合 ARTIFACT 差分 -->
        <TabsContent v-if="hasArtifactsTab && byproducts.artifacts" value="artifacts"
          class="min-w-0 px-3 outline-none">
          <AssistantByproductContent tab="artifacts" />
        </TabsContent>

        <!-- 待办：完整 checklist（结束后） -->
        <TabsContent v-if="byproducts.todoItems.length > 0" value="todo" class="min-w-0 px-3 outline-none">
          <AssistantByproductContent tab="todo" />
        </TabsContent>

        <!-- 过程：完整时间线；勿加 px，padding 在滚动内层 -->
        <TabsContent v-if="hasProcessTab" value="process" class="min-w-0 outline-none">
          <AssistantByproductContent tab="process" />
        </TabsContent>

        <!-- 协助 Agent -->
        <TabsContent v-if="byproducts.assists.length > 0" value="subagents" class="min-w-0 px-3 outline-none">
          <AssistantByproductContent tab="subagents" />
        </TabsContent>

        <!-- 无过程 tab 时（仅总结等）仍展示终止/错误 -->
        <template v-if="!hasProcessTab">
          <p v-if="terminated" class="text-muted-foreground mb-0 mt-2 px-3 text-xs select-none" data-copy-ignore
            role="status">
            {{ t("msgCancelled") }}
          </p>
          <span v-if="error" class="text-destructive px-3 text-sm select-none" data-copy-ignore>{{ error }}</span>
        </template>

        <!-- 左下角：流式中提示仍在工作（步骤折叠/正文静止时也看得见） -->
        <div v-if="showWorking" class="mt-2 flex items-center gap-1.5 px-3 select-none" data-copy-ignore role="status"
          aria-live="polite">
          <LoaderCircleIcon class="size-3 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
            aria-hidden="true" />
          <span class="text-xs text-muted-foreground">{{ t("msgWorking") }}</span>
        </div>
      </div>
    </TabsRoot>
    <template #footer>
      <!-- 操作栏不进拖选复制 -->
      <div
        class="text-muted-foreground flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 select-none"
        data-copy-ignore>
        <ActionBarPrimitiveCopy class="hover:text-foreground rounded p-1" :aria-label="t('msgCopy')">
          <CheckIcon v-if="copied" class="size-3.5" />
          <CopyIcon v-else class="size-3.5" />
        </ActionBarPrimitiveCopy>
        <ActionBarPrimitiveReload v-if="showReload" class="hover:text-foreground rounded p-1"
          :aria-label="t('msgReload')">
          <RefreshCwIcon class="size-3.5" />
        </ActionBarPrimitiveReload>
      </div>
      <!-- 交付附件网格：挂在复制/刷新下方 -->
      <DeliverablesGrid
        v-if="deliverables && deliverables.files.length > 0"
        :deliverables="deliverables"
      />
      <!-- 预览配方卡：启动 / 钉顶栏（开发场景主入口） -->
      <PreviewRecipesCard
        v-if="previewRecipes && previewRecipes.recipes.length > 0"
        :preview="previewRecipes"
      />
    </template>
  </ChatBubble>
</template>

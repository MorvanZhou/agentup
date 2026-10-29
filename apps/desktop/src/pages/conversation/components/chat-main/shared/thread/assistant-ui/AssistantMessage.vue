<script setup lang="ts">
import {
  ActionBarPrimitiveCopy,
  ActionBarPrimitiveReload,
  useAuiState,
} from "@assistant-ui/vue";
import type {} from "@assistant-ui/core/store";
import {
  CheckIcon,
  CopyIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
} from "@lucide/vue";
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from "reka-ui";
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";

import AgentAvatar from "../../../../../../../shared/components/avatar/AgentAvatar.vue";
import { t } from "../../../../../../../shared/model/ui/ui-locale";
import { selectionToPlainText } from "../../../../../model/composer/copy-text";
import {
  buildAssistantByproducts,
  type ByproductTabId,
} from "../../../../../model/message/message-byproducts";
import { injectPendingAskUserToolCallId } from "../../../../../model/thread/thread-ask-user";
import { chatMessageAuthor } from "../../../../../model/thread/chat-surface";
import { injectThreadExtras } from "../../../../../model/thread/thread-extras";
import AssistAgentsPanel from "./byproducts/AssistAgentsPanel.vue";
import AssistantByproductContent from "./byproducts/AssistantByproductContent.vue";
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
const pendingAskUserToolCallId = injectPendingAskUserToolCallId();
const copied = useAuiState((s) => s.message.isCopied);
const metadata = useAuiState((s) => s.message.metadata);
const messageAuthor = computed(() => chatMessageAuthor(metadata.value));
const agentName = computed(() => messageAuthor.value?.name || extras.value.name);
const agentRole = computed(() => messageAuthor.value?.role || "");
/** 群消息才带 author；单聊页头已有身份，气泡上不再重复。 */
const showAuthorByline = computed(() => Boolean(messageAuthor.value?.name));
const agentAvatar = computed(
  () => messageAuthor.value?.avatarUrl || extras.value.avatarUrl || "",
);
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
    s.message.parts.some(
      (part) =>
        part.type === "tool-call" &&
        part.toolName === "ask_user" &&
        part.result === undefined,
    ),
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

const activeTab = ref<ByproductTabId>("process");
/**
 * 切 tab 时内容高度骤变：stick-to-bottom / scrollHeight 夹紧都会拽视口。
 * 锚定气泡顶边，布局后再对齐；短窗口内按住，挡住后续 autoScroll。
 */
const bubble = ref<{ surfaceEl: HTMLElement | null } | null>(null);
let releaseTabScrollPin: (() => void) | null = null;

function scrollParentOf(el: HTMLElement | null): HTMLElement | null {
  let cur = el?.parentElement ?? null;
  while (cur) {
    const { overflowY } = getComputedStyle(cur);
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") {
      return cur;
    }
    cur = cur.parentElement;
  }
  return null;
}

function pinScrollTop(scroller: HTMLElement, top: number, ms: number) {
  releaseTabScrollPin?.();
  const hold = () => {
    scroller.scrollTop = top;
  };
  const release = () => {
    window.clearTimeout(timer);
    scroller.removeEventListener("scroll", hold);
    if (releaseTabScrollPin === release) releaseTabScrollPin = null;
  };
  scroller.addEventListener("scroll", hold);
  const timer = window.setTimeout(release, ms);
  releaseTabScrollPin = release;
}

function restoreTabAnchor(
  anchor: HTMLElement,
  scroller: HTMLElement,
  beforeTop: number,
) {
  const delta = anchor.getBoundingClientRect().top - beforeTop;
  if (Math.abs(delta) < 0.5) return;
  const prevBehavior = scroller.style.scrollBehavior;
  scroller.style.scrollBehavior = "auto";
  const targetTop = scroller.scrollTop + delta;
  scroller.scrollTop = targetTop;
  scroller.style.scrollBehavior = prevBehavior;
  pinScrollTop(scroller, targetTop, 300);
}

function onActiveTabChange(id: string | number) {
  const next = String(id) as ByproductTabId;
  if (next === activeTab.value) return;

  const anchor = bubble.value?.surfaceEl ?? null;
  const scroller = scrollParentOf(anchor);
  const beforeTop = anchor?.getBoundingClientRect().top ?? null;

  activeTab.value = next;

  void nextTick(() => {
    // Presence 显隐后再对齐；双 rAF 等长→短时 scrollHeight 夹紧落地。
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!anchor || !scroller || beforeTop === null) return;
        restoreTabAnchor(anchor, scroller, beforeTop);
      });
    });
  });
}

onBeforeUnmount(() => {
  releaseTabScrollPin?.();
});

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

/**
 * 流式结束：过程区去掉 max-height（可能再切 summary），高度骤变。
 * 在布局落地前记下气泡顶，落定后对齐并短按住，挡住 stick-to-bottom。
 */
watch(streaming, (now, was) => {
  if (was !== true || now) return;
  const anchor = bubble.value?.surfaceEl ?? null;
  const scroller = scrollParentOf(anchor);
  const beforeTop = anchor?.getBoundingClientRect().top ?? null;
  void nextTick(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!anchor || !scroller || beforeTop === null) return;
        restoreTabAnchor(anchor, scroller, beforeTop);
      });
    });
  });
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
</script>

<template>
  <ChatBubble ref="bubble" side="agent" :padded="false" @copy="onBubbleCopy">
    <template #avatar>
      <div
        class="flex shrink-0 flex-col items-end"
        :class="showAuthorByline ? '' : 'mt-0.5'"
      >
        <AgentAvatar
          :name="agentName || 'A'"
          :avatar-url="agentAvatar || undefined"
          size="lg"
        />
      </div>
    </template>
    <template v-if="showAuthorByline" #header>
      <!-- 署名不进拖选复制 -->
      <div
        class="flex min-w-0 items-baseline gap-1.5 px-0.5 select-none"
        data-copy-ignore
      >
        <span class="truncate text-xs font-medium text-foreground">{{ agentName }}</span>
        <span
          v-if="agentRole"
          class="min-w-0 truncate text-xs font-normal text-muted-foreground"
        >{{ agentRole }}</span>
      </div>
    </template>
    <TabsRoot
          :model-value="activeTab"
          class="flex w-full min-w-0 flex-col"
          @update:model-value="onActiveTabChange"
        >
          <!-- 顶栏：Chrome 式标签条（不进拖选） -->
          <TabsList
            v-if="byproducts.showTabBar"
            class="flex min-w-0 flex-wrap items-end gap-0.5 border-b border-rule/70 bg-paper/70 px-2 pt-1.5 select-none"
            data-copy-ignore
            :aria-label="t('msgProducts')"
          >
            <template v-for="tab in byproducts.tabs" :key="tab.id">
              <TabsTrigger
                v-if="tab.id !== 'subagents'"
                :value="tab.id"
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
              <TabsTrigger
                v-else
                :value="tab.id"
                class="relative -mb-px inline-flex min-h-8 items-center rounded-t-lg border border-transparent px-2 transition duration-200 data-[state=active]:border-rule/70 data-[state=active]:border-b-muted data-[state=active]:bg-muted data-[state=inactive]:hover:bg-black/5 dark:data-[state=inactive]:hover:bg-white/5"
                :aria-label="t('msgAssistAgents')"
              >
                <AssistAgentsPanel
                  :assists="byproducts.assists"
                  variant="trigger"
                />
              </TabsTrigger>
            </template>
          </TabsList>

          <div class="px-3 py-3">
          <!-- 总结：仅主产物 text -->
          <TabsContent
            v-if="hasSummaryTab && byproducts.summaryPartIndex !== undefined"
            value="summary"
            class="min-w-0 outline-none"
          >
            <AssistantByproductContent tab="summary" />
          </TabsContent>

          <!-- 本回合 ARTIFACT 差分 -->
          <TabsContent
            v-if="hasArtifactsTab && byproducts.artifacts"
            value="artifacts"
            class="min-w-0 outline-none"
          >
            <AssistantByproductContent tab="artifacts" />
          </TabsContent>

          <!-- 待办：完整 checklist（结束后） -->
          <TabsContent
            v-if="byproducts.todoItems.length > 0"
            value="todo"
            class="min-w-0 outline-none"
          >
            <AssistantByproductContent tab="todo" />
          </TabsContent>

          <!-- 过程：完整时间线（可与总结重复最后一段 text） -->
          <TabsContent
            v-if="hasProcessTab"
            value="process"
            class="min-w-0 outline-none"
          >
            <AssistantByproductContent tab="process" />
          </TabsContent>

          <!-- 协助 Agent -->
          <TabsContent
            v-if="byproducts.assists.length > 0"
            value="subagents"
            class="min-w-0 outline-none"
          >
            <AssistantByproductContent tab="subagents" />
          </TabsContent>

          <!-- 无过程 tab 时（仅总结等）仍展示终止/错误 -->
          <template v-if="!hasProcessTab">
            <p
              v-if="terminated"
              class="text-muted-foreground mb-0 mt-2 text-xs select-none"
              data-copy-ignore
              role="status"
            >
              {{ t("msgCancelled") }}
            </p>
            <span
              v-if="error"
              class="text-destructive text-sm select-none"
              data-copy-ignore
              >{{ error }}</span
            >
          </template>

          <!-- 左下角：流式中提示仍在工作（步骤折叠/正文静止时也看得见） -->
          <div
            v-if="showWorking"
            class="mt-2 flex items-center gap-1.5 select-none"
            data-copy-ignore
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
    <template #footer>
      <!-- 操作栏不进拖选复制 -->
      <div
        class="text-muted-foreground flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 select-none"
        data-copy-ignore
      >
        <ActionBarPrimitiveCopy class="hover:text-foreground rounded p-1" :aria-label="t('msgCopy')">
          <CheckIcon v-if="copied" class="size-3.5" />
          <CopyIcon v-else class="size-3.5" />
        </ActionBarPrimitiveCopy>
        <ActionBarPrimitiveReload class="hover:text-foreground rounded p-1" :aria-label="t('msgReload')">
          <RefreshCwIcon class="size-3.5" />
        </ActionBarPrimitiveReload>
      </div>
    </template>
  </ChatBubble>
</template>

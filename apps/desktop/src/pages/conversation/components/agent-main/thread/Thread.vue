<script setup lang="ts">
import {
  MessageByIdProvider,
  SuggestionPrimitiveDescription,
  SuggestionPrimitiveTitle,
  SuggestionPrimitiveTrigger,
  ThreadPrimitiveScrollToBottom,
  ThreadPrimitiveSuggestions,
  ThreadPrimitiveViewport,
  useAuiState,
} from "@assistant-ui/vue";
import type {} from "@assistant-ui/core/store";
import { ArrowDownIcon } from "@lucide/vue";
import {
  computed,
  defineComponent,
  h,
  nextTick,
  onBeforeUnmount,
  provide,
  ref,
  toRef,
  watch,
} from "vue";

import {
  isContextResetMessage,
  type AgentUpApprovalData,
  type AgentUpAskUserData,
  type ApprovalScope,
  type AskUserAnswer,
} from "../../../../../shared/model/chat";
import { t, tf } from "../../../../../shared/model/ui-locale";
import { threadAskUserKey } from "../../../model/thread-ask-user";
import { threadApprovalKey } from "../../../model/thread-approval";
import { injectThreadExtras } from "../../../model/thread-extras";
import { timeLabelsForVisibleIds } from "../../../model/message-time";
import {
  THREAD_WINDOW_PAGE,
  expandWindowStart,
  initialWindowStart,
  visibleMessageIds,
} from "../../../model/thread-window";
import ApprovalDock from "./dock/ApprovalDock.vue";
import AskUserDock from "./dock/AskUserDock.vue";
import PlanDock from "./dock/PlanDock.vue";
import AssistantMessage from "./assistant-ui/AssistantMessage.vue";
import Composer from "./composer/Composer.vue";
import ContextResetMessage from "./ContextResetMessage.vue";
import TimeSeparator from "./TimeSeparator.vue";
import UserMessage from "./user-message/UserMessage.vue";

const props = defineProps<{
  approval?: AgentUpApprovalData;
  askUser?: AgentUpAskUserData;
}>();
const emit = defineEmits<{
  decide: [allow: boolean, scope?: ApprovalScope];
  answer: [answer: AskUserAnswer];
}>();
provide(threadApprovalKey, toRef(props, "approval"));
provide(threadAskUserKey, toRef(props, "askUser"));

/** 在 MessageByIdProvider 作用域内按 role 分发到独立消息组件。 */
const ThreadMessage = defineComponent({
  name: "ThreadMessage",
  setup() {
    const role = useAuiState((s) => s.message.role);
    const contextReset = useAuiState((s) => isContextResetMessage(s.message));
    return () => {
      if (contextReset.value) return h(ContextResetMessage);
      if (role.value === "user") return h(UserMessage);
      return h(AssistantMessage);
    };
  },
});

const extras = injectThreadExtras();
const threadMessages = useAuiState((state) => state.thread.messages);
const messageIds = computed(() => threadMessages.value.map((message) => message.id));
const messageCount = computed(() => messageIds.value.length);
const windowStart = ref(0);
const windowReady = ref(false);
const loadingEarlier = ref(false);
const earlierSentinel = ref<HTMLElement | null>(null);
let earlierObserver: IntersectionObserver | null = null;

const visibleIds = computed(() => visibleMessageIds(messageIds.value, windowStart.value));
const hasEarlier = computed(() => windowStart.value > 0);
const visibleRows = computed(() => {
  const labels = timeLabelsForVisibleIds(threadMessages.value, visibleIds.value);
  return visibleIds.value.map((id) => ({ id, timeLabel: labels.get(id) }));
});

const synced = computed(() => ({
  ready: Boolean(extras.value.syncedVersion),
  recruited: extras.value.recruited,
  name: extras.value.name,
}));

const emptyTitle = computed(() => synced.value.name || t("threadEmptyTitleFallback"));
const emptyHint = computed(() => {
  if (!synced.value.name) return t("threadEmptyPickOrRecruit");
  if (synced.value.recruited) return t("threadEmptyNeedSync");
  return tf("threadEmptyNeedRecruit", { name: synced.value.name });
});

watch(
  messageIds,
  (ids) => {
    if (ids.length === 0) {
      windowStart.value = 0;
      windowReady.value = false;
      return;
    }
    // 首屏只挂最新一页；之后追加的新消息落在窗口尾部，不重置已揭开的历史。
    if (!windowReady.value) {
      windowStart.value = initialWindowStart(ids.length);
      windowReady.value = true;
    }
  },
  { immediate: true },
);

function scrollParentOf(el: HTMLElement | null): HTMLElement | null {
  let cur = el?.parentElement ?? null;
  while (cur) {
    const { overflowY } = getComputedStyle(cur);
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") return cur;
    cur = cur.parentElement;
  }
  return null;
}

function sentinelStillInView(scroller: HTMLElement | null, el: HTMLElement | null): boolean {
  if (!scroller || !el || !hasEarlier.value) return false;
  const rootRect = scroller.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  return elRect.bottom >= rootRect.top - 120;
}

async function loadEarlier(): Promise<void> {
  if (!hasEarlier.value || loadingEarlier.value) return;
  loadingEarlier.value = true;
  try {
    // IntersectionObserver 在元素持续可见时不会再次回调，一屏很高时循环揭开直到离开视口。
    do {
      const scroller = scrollParentOf(earlierSentinel.value);
      const prevHeight = scroller?.scrollHeight ?? 0;
      const prevTop = scroller?.scrollTop ?? 0;
      windowStart.value = expandWindowStart(windowStart.value, THREAD_WINDOW_PAGE);
      await nextTick();
      if (scroller) {
        scroller.scrollTop = prevTop + (scroller.scrollHeight - prevHeight);
      }
    } while (sentinelStillInView(scrollParentOf(earlierSentinel.value), earlierSentinel.value));
  } finally {
    loadingEarlier.value = false;
  }
}

watch(
  [earlierSentinel, hasEarlier],
  ([el, earlier]) => {
    earlierObserver?.disconnect();
    earlierObserver = null;
    if (!el || !earlier) return;
    const root = scrollParentOf(el);
    earlierObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadEarlier();
      },
      { root, rootMargin: "120px 0px 0px 0px", threshold: 0 },
    );
    earlierObserver.observe(el);
  },
  { flush: "post" },
);

onBeforeUnmount(() => {
  earlierObserver?.disconnect();
  earlierObserver = null;
});
</script>

<template>
  <div class="flex h-full min-h-0 min-w-80 flex-1 flex-col overflow-hidden bg-paper">
    <!-- 消息区 -->
    <ThreadPrimitiveViewport
      class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-scroll scroll-smooth"
    >
      <div class="mx-auto flex w-full min-w-0 flex-1 flex-col px-4 pt-4 sm:px-4 sm:pt-5">
        <!-- 未同步空状态 -->
        <div
          v-if="messageCount === 0 && !synced.ready"
          class="flex flex-1 flex-col items-center justify-center gap-2 pb-16 text-center"
        >
          <h1 class="text-base font-semibold text-foreground">{{ emptyTitle }}</h1>
          <p class="text-muted-foreground max-w-sm text-sm leading-snug">{{ emptyHint }}</p>
        </div>
        <!-- 已同步空状态 -->
        <div
          v-if="messageCount === 0 && synced.ready"
          class="flex flex-1 flex-col items-center justify-center gap-3 pb-16"
        >
          <h1 class="text-base font-semibold text-foreground">{{ t("threadEmptyReadyTitle") }}</h1>
          <div class="flex flex-wrap items-center justify-center gap-1.5 px-3">
            <ThreadPrimitiveSuggestions>
              <SuggestionPrimitiveTrigger
                send
                class="text-foreground hover:bg-background border-border/60 flex h-auto flex-col items-start gap-0.5 rounded-lg border bg-background/80 px-3 py-1.5 text-sm shadow-sm transition-colors"
              >
                <span class="font-medium"><SuggestionPrimitiveTitle /></span>
                <span class="text-muted-foreground text-xs">
                  <SuggestionPrimitiveDescription />
                </span>
              </SuggestionPrimitiveTrigger>
            </ThreadPrimitiveSuggestions>
          </div>
        </div>
        <!-- 更早消息（从最新一页起，向上懒加载） -->
        <div
          v-if="hasEarlier || loadingEarlier"
          ref="earlierSentinel"
          class="mb-3 flex justify-center"
        >
          <button
            type="button"
            class="text-muted-foreground hover:text-foreground min-h-7 rounded-lg px-3 text-xs transition duration-200 disabled:opacity-50"
            :disabled="loadingEarlier || !hasEarlier"
            @click="loadEarlier"
          >
            {{ loadingEarlier ? t("threadLoadingEarlier") : t("threadLoadEarlier") }}
          </button>
        </div>
        <!-- 消息列表 -->
        <ol class="mb-4 flex min-w-0 flex-col gap-y-4 empty:hidden">
          <template v-for="row in visibleRows" :key="row.id">
            <TimeSeparator v-if="row.timeLabel" :label="row.timeLabel" />
            <MessageByIdProvider :id="row.id">
              <ThreadMessage />
            </MessageByIdProvider>
          </template>
        </ol>
        <ThreadPrimitiveScrollToBottom
          class="border-border/60 sticky bottom-2 z-10 mx-auto rounded-full border bg-background p-1.5 shadow-sm transition-[opacity,visibility] disabled:invisible disabled:opacity-0"
          :aria-label="t('threadScrollToBottom')"
        >
          <ArrowDownIcon class="size-3.5" />
        </ThreadPrimitiveScrollToBottom>
      </div>
    </ThreadPrimitiveViewport>

    <!-- 当前计划（输入区上方，不随消息滚动） -->
    <PlanDock :suppressed="Boolean(approval || askUser)" />
    <!-- 本会话审批 / 提问（输入区上方，随 thread 显隐，不走全屏弹窗） -->
    <ApprovalDock :approval="approval" @decide="(allow, scope) => emit('decide', allow, scope)" />
    <AskUserDock :ask-user="askUser" @answer="(answer) => emit('answer', answer)" />
    <!-- 输入区 -->
    <Composer />
  </div>
</template>

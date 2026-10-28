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
import { ArrowDownToLineIcon, ArrowUpIcon } from "@lucide/vue";
import {
  computed,
  defineComponent,
  h,
  inject,
  nextTick,
  onBeforeUnmount,
  ref,
  watch,
} from "vue";

import { isContextResetMessage } from "../../../../../../shared/model/chat/chat";
import { t, tf } from "../../../../../../shared/model/ui/ui-locale";
import {
  chatSurfaceKind,
  injectChatDelegationMessage,
  injectChatDelegationTrail,
  injectChatSurface,
} from "../../../../model/thread/chat-surface";
import { injectThreadExtras } from "../../../../model/thread/thread-extras";
import { timeLabelsForVisibleIds } from "../../../../model/message/message-time";
import {
  THREAD_WINDOW_PAGE,
  expandWindowStart,
  followLatestAfterPrepend,
  initialWindowStart,
  nextEarlierAutoLoad,
  scrollTopForAnchor,
  visibleMessageIds,
} from "../../../../model/thread/thread-window";
import {
  threadEarlierKey,
  threadRevealConsumedKey,
  threadRevealEarlierKey,
} from "../../../../model/thread/thread-earlier";
import { injectThreadWakeLive } from "../../../../model/thread/thread-wake-live";
import AssistantMessage from "./assistant-ui/AssistantMessage.vue";
import ContextResetMessage from "./ContextResetMessage.vue";
import SurfaceNotice from "./SurfaceNotice.vue";
import TimeSeparator from "./TimeSeparator.vue";
import UserMessage from "./user-message/UserMessage.vue";
import WakeLiveMessage from "./WakeLiveMessage.vue";

/** 在 MessageByIdProvider 作用域内按 role 分发到独立消息组件。 */
const ThreadMessage = defineComponent({
  name: "ThreadMessage",
  setup() {
    const role = useAuiState((s) => s.message.role);
    const contextReset = useAuiState((s) => isContextResetMessage(s.message));
    const surfaceKind = useAuiState((s) => chatSurfaceKind(s.message.metadata));
    const delegationMessage = injectChatDelegationMessage();
    return () => {
      if (surfaceKind.value === "delegation" && delegationMessage) return h(delegationMessage);
      if (surfaceKind.value) return h(SurfaceNotice);
      if (contextReset.value) return h(ContextResetMessage);
      if (role.value === "user") return h(UserMessage);
      return h(AssistantMessage);
    };
  },
});

const earlier = inject(threadEarlierKey, null);
const revealOnMount = Math.max(0, inject(threadRevealEarlierKey, null)?.value ?? 0);
const consumeReveal = inject(threadRevealConsumedKey, null);
const extras = injectThreadExtras();
const surface = injectChatSurface();
const delegationTrail = injectChatDelegationTrail();
const wakeLive = injectThreadWakeLive();
const wakeLiveMessage = computed(() => wakeLive?.value.message ?? null);
const wakeLiveStreaming = computed(() => Boolean(wakeLive?.value.streaming));
const threadMessages = useAuiState((state) => state.thread.messages);
const messageIds = computed(() => threadMessages.value.map((message) => message.id));
const messageCount = computed(() => messageIds.value.length);
const windowStart = ref(0);
const windowReady = ref(false);
const loadingEarlier = ref(false);
const earlierSentinel = ref<HTMLElement | null>(null);
const threadNav = ref<HTMLElement | null>(null);
const scrollingToPreviousUser = ref(false);
/** 补历史时关掉贴底跟随。重挂载揭示从关闭开始，避免新视口把阅读位置拉回最新消息。 */
const followLatest = ref(revealOnMount === 0);
let earlierObserver: IntersectionObserver | null = null;
let rearmFrame = 0;
/** 刚补上一页后先关掉自动加载；哨兵离开视口才重新打开。重挂载揭示时从关闭开始。 */
let autoLoadArmed = revealOnMount === 0;

const visibleIds = computed(() => visibleMessageIds(messageIds.value, windowStart.value));
const hasEarlier = computed(
  () => windowStart.value > 0 || earlier?.value.hasMore === true,
);
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
      if (revealOnMount > 0 && revealOnMount < ids.length) {
        windowStart.value = revealOnMount;
      } else {
        windowStart.value = initialWindowStart(ids.length);
      }
      windowReady.value = true;
      if (revealOnMount > 0 && revealOnMount < ids.length) void showRevealed();
      return;
    }
    if (windowStart.value >= ids.length) {
      windowStart.value = initialWindowStart(ids.length);
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

type ReadingAnchor = { id: string; offset: number };

/** 补上内容后钉住原来的阅读位置。关掉平滑滚动，避免哨兵在动画途中再次进入视口。 */
function pinScrollTop(scroller: HTMLElement, top: number): void {
  const previous = scroller.style.scrollBehavior;
  scroller.style.scrollBehavior = "auto";
  scroller.scrollTop = top;
  scroller.style.scrollBehavior = previous;
}

function captureReadingAnchor(scroller: HTMLElement): ReadingAnchor | null {
  const top = scroller.getBoundingClientRect().top;
  for (const node of scroller.querySelectorAll<HTMLElement>("[data-thread-message-id]")) {
    const rect = node.getBoundingClientRect();
    if (rect.bottom <= top + 1) continue;
    const id = node.dataset.threadMessageId;
    if (!id) continue;
    return { id, offset: rect.top - top };
  }
  return null;
}

function restoreReadingAnchor(scroller: HTMLElement, anchor: ReadingAnchor): void {
  const node = scroller.querySelector<HTMLElement>(
    `[data-thread-message-id="${CSS.escape(anchor.id)}"]`,
  );
  if (!node) return;
  const offset = node.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  pinScrollTop(scroller, scrollTopForAnchor(scroller.scrollTop, anchor.offset, offset));
}

async function settleReadingAnchor(scroller: HTMLElement, anchor: ReadingAnchor): Promise<void> {
  await nextTick();
  restoreReadingAnchor(scroller, anchor);
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
  restoreReadingAnchor(scroller, anchor);
}

function rearmAutoLoad(): void {
  // 这一帧的交叉回调仍可能带着补页前的「仍在视口内」。先保持关闭，下一帧再按实际位置决定。
  autoLoadArmed = false;
  cancelAnimationFrame(rearmFrame);
  rearmFrame = requestAnimationFrame(() => {
    if (loadingEarlier.value) return;
    autoLoadArmed = !sentinelStillInView(
      scrollParentOf(earlierSentinel.value),
      earlierSentinel.value,
    );
  });
}

async function showRevealed(): Promise<void> {
  loadingEarlier.value = true;
  autoLoadArmed = false;
  followLatest.value = false;
  try {
    await nextTick();
    const scroller = scrollParentOf(earlierSentinel.value ?? threadNav.value);
    const anchor = scroller ? captureReadingAnchor(scroller) : null;
    windowStart.value = expandWindowStart(windowStart.value, THREAD_WINDOW_PAGE);
    if (scroller && anchor) await settleReadingAnchor(scroller, anchor);
  } finally {
    loadingEarlier.value = false;
    rearmAutoLoad();
    consumeReveal?.();
  }
}

async function loadEarlier(): Promise<void> {
  if (!hasEarlier.value || loadingEarlier.value) return;
  loadingEarlier.value = true;
  autoLoadArmed = false;
  followLatest.value = false;
  await nextTick();
  const scroller = scrollParentOf(earlierSentinel.value);
  const anchor = scroller ? captureReadingAnchor(scroller) : null;
  try {
    if (windowStart.value > 0) {
      windowStart.value = expandWindowStart(windowStart.value, THREAD_WINDOW_PAGE);
    } else if (earlier?.value.hasMore) {
      const added = await earlier.value.loadOlder();
      // 一对一补页会重挂线程，由新实例按锚点钉住视口。
      if (added <= 0) return;
    } else {
      return;
    }
    if (scroller && anchor) await settleReadingAnchor(scroller, anchor);
  } finally {
    loadingEarlier.value = false;
    rearmAutoLoad();
  }
}

watch(
  threadNav,
  (el, _, onCleanup) => {
    const scroller = scrollParentOf(el);
    if (!scroller) return;
    const onScroll = () => {
      if (loadingEarlier.value) return;
      if (
        followLatestAfterPrepend(scroller.scrollTop, scroller.scrollHeight, scroller.clientHeight)
      ) {
        followLatest.value = true;
      }
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    onCleanup(() => scroller.removeEventListener("scroll", onScroll));
  },
  { flush: "post" },
);

watch(
  [earlierSentinel, hasEarlier],
  ([el, earlier]) => {
    earlierObserver?.disconnect();
    earlierObserver = null;
    if (!el || !earlier) return;
    const root = scrollParentOf(el);
    earlierObserver = new IntersectionObserver(
      (entries) => {
        if (loadingEarlier.value) return;
        const intersecting = entries.some((entry) => entry.isIntersecting);
        const decision = nextEarlierAutoLoad(autoLoadArmed, intersecting);
        autoLoadArmed = decision.armed;
        if (decision.load) void loadEarlier();
      },
      { root, rootMargin: "120px 0px 0px 0px", threshold: 0 },
    );
    earlierObserver.observe(el);
  },
  { flush: "post" },
);

onBeforeUnmount(() => {
  cancelAnimationFrame(rearmFrame);
  earlierObserver?.disconnect();
  earlierObserver = null;
});

/**
 * 相对当前视口找「再往上一条」user 气泡：
 * 先认顶边已越过 pin 线的最后一条为锚点，再取它的上一条；
 * 若所有 user 都还在 pin 下方（短对话贴底），则跳到最新一条 user。
 */
function previousUserMessageEl(scroller: HTMLElement): HTMLElement | null {
  const pin = scroller.getBoundingClientRect().top + 8;
  const users = [...scroller.querySelectorAll<HTMLElement>('[data-role="user"]')];
  if (users.length === 0) return null;
  let anchor = -1;
  for (let i = 0; i < users.length; i += 1) {
    if (users[i]!.getBoundingClientRect().top <= pin) anchor = i;
  }
  if (anchor === -1) return users[users.length - 1]!;
  if (anchor === 0) return null;
  return users[anchor - 1]!;
}

async function scrollToPreviousUserMessage(): Promise<void> {
  if (scrollingToPreviousUser.value) return;
  scrollingToPreviousUser.value = true;
  try {
    const scroller = scrollParentOf(threadNav.value);
    if (!scroller) return;
    let target = previousUserMessageEl(scroller);
    // 视口顶部已无更早的已挂载 user 气泡时，先揭开历史再找一次。
    if (!target && hasEarlier.value) {
      await loadEarlier();
      await nextTick();
      target = previousUserMessageEl(scroller);
    }
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  } finally {
    scrollingToPreviousUser.value = false;
  }
}
</script>

<template>
  <ThreadPrimitiveViewport
    class="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-scroll scroll-smooth bg-paper"
    :auto-scroll="followLatest"
    :scroll-to-bottom-on-initialize="revealOnMount === 0"
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
          v-if="messageCount === 0 && synced.ready && surface.suggestions"
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
        <!-- 消息列表：气泡与时间分隔根节点都是 li，容器须保留 list 角色 -->
        <ul
          class="mb-4 flex min-w-0 list-none flex-col gap-y-4 p-0 empty:hidden"
          role="list"
        >
          <template v-for="row in visibleRows" :key="row.id">
            <TimeSeparator v-if="row.timeLabel" :label="row.timeLabel" />
            <li class="min-w-0 list-none" :data-thread-message-id="row.id">
              <MessageByIdProvider :id="row.id">
                <ThreadMessage />
              </MessageByIdProvider>
            </li>
          </template>
        </ul>
        <!-- wake 旁路直播：与 /prompt 同形 UIMessage，结束后再并入历史 -->
        <WakeLiveMessage
          v-if="wakeLiveMessage"
          :message="wakeLiveMessage"
          :streaming="wakeLiveStreaming"
        />
        <component :is="delegationTrail" v-if="delegationTrail" />
      </div>
      <!-- 右侧导航：贴滚动视口右下角（上一条 user / 最新消息） -->
      <div
        ref="threadNav"
        class="pointer-events-none sticky bottom-3 z-10 mt-auto flex shrink-0 justify-end px-3"
      >
        <div
          class="pointer-events-auto flex w-fit flex-col overflow-hidden rounded-xl border border-rule bg-paper/95 shadow-sm backdrop-blur-sm"
        >
          <button
            type="button"
            class="inline-flex size-9 cursor-pointer items-center justify-center text-muted-foreground transition duration-200 hover:bg-paper-deep hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/30 disabled:cursor-default disabled:opacity-40"
            :aria-label="t('threadScrollToPreviousUser')"
            :disabled="scrollingToPreviousUser || messageCount === 0"
            @click="scrollToPreviousUserMessage"
          >
            <ArrowUpIcon class="size-4" stroke-width="2" />
          </button>
          <ThreadPrimitiveScrollToBottom
            class="inline-flex size-9 cursor-pointer items-center justify-center border-t border-rule text-muted-foreground transition duration-200 hover:bg-paper-deep hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/30 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
            :aria-label="t('threadScrollToBottom')"
          >
            <ArrowDownToLineIcon class="size-4" stroke-width="2" />
          </ThreadPrimitiveScrollToBottom>
        </div>
      </div>
  </ThreadPrimitiveViewport>
</template>

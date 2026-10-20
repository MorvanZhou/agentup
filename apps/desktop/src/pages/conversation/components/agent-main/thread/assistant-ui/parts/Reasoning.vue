<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  PartByIndexProvider,
  useAui,
  useAuiState,
  useScrollLock,
} from "@assistant-ui/vue";
import type {} from "@assistant-ui/core/store";
import {
  CollapsibleContent,
  CollapsibleRoot,
  CollapsibleTrigger,
} from "reka-ui";
import { ChevronRightIcon } from "@lucide/vue";
import MarkdownText from "./MarkdownText.vue";
import ShimmerTitle from "./ShimmerTitle.vue";

const aui = useAui();
const index = useAuiState(() => {
  const query = aui.part.query;
  return query && "index" in query && typeof query.index === "number"
    ? query.index
    : -1;
});
const end = useAuiState((s) => {
  const parts = s.message.parts;
  const start = index.value;
  if (
    parts[start]?.type !== "reasoning" ||
    parts[start - 1]?.type === "reasoning"
  )
    return start;
  let last = start + 1;
  while (parts[last]?.type === "reasoning") last++;
  return last;
});
const indices = computed(() =>
  Array.from(
    { length: end.value - index.value },
    (_, offset) => index.value + offset,
  ),
);
const streaming = useAuiState((s) => {
  for (let partIndex = index.value; partIndex < end.value; partIndex++) {
    if (s.message.parts[partIndex]?.status.type === "running") return true;
  }
  return false;
});

const userOpen = ref<boolean | null>(null);
const open = computed(() => userOpen.value ?? false);
const collapsibleRoot = ref<InstanceType<typeof CollapsibleRoot> | null>(null);
const collapsible = computed<HTMLElement | null>(
  () => collapsibleRoot.value?.$el ?? null,
);
const lockScroll = useScrollLock(collapsible, 200);
const setOpen = (value: boolean) => {
  lockScroll();
  userOpen.value = value;
};

const preview = computed(() => streaming.value && open.value);
const scroller = ref<HTMLElement | null>(null);
const content = ref<HTMLElement | null>(null);

watch(
  [preview, scroller, content],
  ([isPreview, scrollEl, contentEl], _, onCleanup) => {
    if (!isPreview || !scrollEl || !contentEl) return;
    let pinned = true;
    let lastScrollTop = scrollEl.scrollTop;
    let lastScrollHeight = scrollEl.scrollHeight;
    const isAtBottom = () =>
      Math.abs(
        scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight,
      ) <= 1 || scrollEl.scrollHeight <= scrollEl.clientHeight;
    const pin = () => {
      if (pinned) scrollEl.scrollTop = scrollEl.scrollHeight;
    };
    // A pin's own scroll event can arrive after new content grew the scroll
    // height and read as "not at bottom"; only an upward move at unchanged
    // scroll height is user intent.
    const onScroll = () => {
      if (isAtBottom()) {
        pinned = true;
      } else if (
        scrollEl.scrollTop < lastScrollTop &&
        scrollEl.scrollHeight === lastScrollHeight
      ) {
        pinned = false;
      }
      lastScrollTop = scrollEl.scrollTop;
      lastScrollHeight = scrollEl.scrollHeight;
    };
    pin();
    scrollEl.addEventListener("scroll", onScroll);
    const observer = new ResizeObserver(pin);
    observer.observe(contentEl);
    onCleanup(() => {
      scrollEl.removeEventListener("scroll", onScroll);
      observer.disconnect();
    });
  },
  { flush: "post" },
);
</script>

<template>
  <CollapsibleRoot
    v-if="indices.length"
    ref="collapsibleRoot"
    :open="open"
    data-slot="aui_reasoning-root"
    class="group/reasoning-root w-full"
    @update:open="setOpen"
  >
    <!-- 推理过程 -->
    <CollapsibleTrigger
      data-slot="aui_reasoning-trigger"
      class="group/trigger text-muted-foreground hover:text-foreground/80 inline-flex max-w-full min-w-0 items-center gap-0.5 py-0.5 text-xs transition-colors duration-200"
    >
      <ChevronRightIcon
        class="size-3 shrink-0 transition-transform duration-200 group-data-[state=open]/trigger:rotate-90 motion-reduce:transition-none"
      />
      <ShimmerTitle :active="streaming" title="Thinking" />
    </CollapsibleTrigger>
    <CollapsibleContent
      data-slot="aui_reasoning-content"
      class="aui-collapsible-content text-muted-foreground relative overflow-hidden text-xs outline-none"
      :aria-busy="streaming"
    >
      <div
        ref="scroller"
        data-slot="aui_reasoning-text"
        class="mt-0.5 max-h-40 overflow-y-auto border-l border-rule/50 py-0.5 ps-2.5 leading-snug text-pretty opacity-80"
      >
        <div ref="content">
          <PartByIndexProvider
            v-for="partIndex in indices"
            :key="partIndex"
            :index="partIndex"
          >
            <MarkdownText secondary />
          </PartByIndexProvider>
        </div>
      </div>
    </CollapsibleContent>
  </CollapsibleRoot>
</template>

<style scoped>
.aui-collapsible-content[data-state="open"] {
  animation: aui-collapsible-down 200ms cubic-bezier(0.32, 0.72, 0, 1);
}
.aui-collapsible-content[data-state="closed"] {
  animation: aui-collapsible-up 200ms cubic-bezier(0.32, 0.72, 0, 1);
}
@media (prefers-reduced-motion: reduce) {
  .aui-collapsible-content[data-state] {
    animation: none;
  }
}
@keyframes aui-collapsible-down {
  from {
    height: 0;
  }
  to {
    height: var(--reka-collapsible-content-height);
  }
}
@keyframes aui-collapsible-up {
  from {
    height: var(--reka-collapsible-content-height);
  }
  to {
    height: 0;
  }
}
</style>

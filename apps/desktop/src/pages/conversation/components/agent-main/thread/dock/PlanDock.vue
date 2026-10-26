<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useAuiState } from "@assistant-ui/vue";
import type {} from "@assistant-ui/core/store";
import { CircleCheckIcon, CircleIcon, ListTodoIcon, XIcon } from "@lucide/vue";

import { isContextResetMessage } from "../../../../../../shared/model/chat/chat";
import { t } from "../../../../../../shared/model/ui/ui-locale";
import {
  currentTodoParts,
  isPlanComplete,
  isSegmentStreaming,
  planFromTodoParts,
  todoPlanKey,
  type TodoMessageRef,
} from "../../../../model/message/todo-list";
import ShimmerTitle from "../assistant-ui/parts/ShimmerTitle.vue";

const props = defineProps<{
  /** 提问或审批占用底部时让出空间，组件保持挂载以记住隐藏状态。 */
  suppressed?: boolean;
}>();

const messages = useAuiState((state) => state.thread.messages as readonly TodoMessageRef[]);
const plan = computed(() =>
  planFromTodoParts(currentTodoParts(messages.value, isContextResetMessage)),
);
const streaming = computed(() => isSegmentStreaming(messages.value, isContextResetMessage));
const planKey = computed(() => (plan.value ? todoPlanKey(plan.value) : ""));
const hiddenKey = ref<string | undefined>();
watch(planKey, (next, previous) => {
  if (next !== previous) hiddenKey.value = undefined;
});
const visible = computed(
  () =>
    Boolean(plan.value) &&
    !props.suppressed &&
    !isPlanComplete(plan.value!, streaming.value) &&
    hiddenKey.value !== planKey.value,
);
const list = ref<HTMLElement | null>(null);
/** 顺序从旧到新，视口始终停在最新一条。 */
const listTail = computed(() =>
  visible.value ? (plan.value?.items.map((item) => `${item.id}\0${item.done}\0${item.text}`).join("\n") ?? "") : "",
);
watch(
  listTail,
  () => {
    void nextTick(() => {
      const node = list.value;
      if (node) node.scrollTop = node.scrollHeight;
    });
  },
  { flush: "post", immediate: true },
);

function hide(): void {
  hiddenKey.value = planKey.value;
}
const done = computed(() => plan.value?.items.filter((item) => item.done).length ?? 0);
const total = computed(() => plan.value?.items.length ?? 0);
const progress = computed(() => (total.value === 0 ? 0 : Math.round((done.value / total.value) * 100)));
const detail = computed(() => {
  if (!plan.value) return "";
  if (plan.value.updating && total.value === 0) return t("planOrganizing");
  if (plan.value.error && total.value === 0) return t("planFailed");
  if (total.value === 0) return t("planEmpty");
  return `${done.value}/${total.value}`;
});
</script>

<template>
  <!-- 当前计划：固定在输入区上方，不随消息滚动 -->
  <section
    v-if="visible && plan"
    class="shrink-0 border-t border-border bg-paper"
    :aria-label="t('planCurrent')"
    :aria-busy="plan.updating || undefined"
  >
    <div class="mx-auto w-full px-3 pt-2">
      <!-- 页头 -->
      <div class="text-foreground flex min-w-0 items-center gap-2 text-sm">
        <ListTodoIcon class="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />
        <ShimmerTitle :active="plan.updating" title="TODO" :detail="detail" />
        <button
          type="button"
          class="text-muted-foreground hover:text-foreground hover:bg-paper-deep inline-flex size-7 shrink-0 items-center justify-center rounded-lg transition duration-200"
          :aria-label="t('planHide')"
          @click="hide"
        >
          <XIcon class="size-3.5" aria-hidden="true" />
        </button>
      </div>
      <div
        class="bg-rule mt-2 h-1 overflow-hidden rounded-full"
        role="progressbar"
        :aria-valuemin="0"
        :aria-valuemax="total"
        :aria-valuenow="done"
        :aria-label="t('planProgress')"
      >
        <div class="bg-accent h-full" :style="{ width: `${progress}%` }" />
      </div>
      <!-- 待办列表 -->
      <ul
        v-if="plan.items.length"
        ref="list"
        class="m-0 max-h-40 list-none space-y-0.5 overflow-y-auto py-2"
      >
        <li
          v-for="item in plan.items"
          :key="item.id"
          class="flex min-w-0 items-start gap-1.5 text-sm leading-snug"
          :class="item.done ? 'text-muted-foreground' : 'text-foreground'"
        >
          <CircleCheckIcon v-if="item.done" class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <CircleIcon v-else class="text-muted-foreground mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span class="min-w-0 wrap-break-word" :class="item.done ? 'line-through' : ''">{{ item.text }}</span>
        </li>
      </ul>
      <p v-else class="text-muted-foreground py-2 text-xs">{{ t("planOrganizingLong") }}</p>
    </div>
  </section>
</template>

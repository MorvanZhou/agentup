<script setup lang="ts">
import {
  PartByIndexProvider,
  useScrollLock,
} from "@assistant-ui/vue";
import type {} from "@assistant-ui/core/store";
import { ChevronRightIcon } from "@lucide/vue";
import {
  CollapsibleContent,
  CollapsibleRoot,
  CollapsibleTrigger,
} from "reka-ui";
import { computed, ref, watch } from "vue";

import {
  formatGroupDuration,
  groupHasRunningPart,
  isProcessGroupDefaultOpen,
  processGroupTriggerLabel,
  type AssistantProcessPart,
} from "../../../../../model/message/assistant-process";
import {
  getProcessFoldOverride,
  setProcessFoldOverride,
} from "../../../../../model/message/process-fold-state";
import { injectThreadActive } from "../../../../../model/thread/thread-active";
import AssistantPart from "../parts/AssistantPart.vue";

const props = defineProps<{
  agentId: string;
  messageId: string;
  groupId: string;
  indices: number[];
  stepCount: number;
  parts: readonly AssistantProcessPart[];
  streaming: boolean;
}>();

const threadActive = injectThreadActive();
const userOpen = ref<boolean | null>(null);
/** 仅用户手动开合后才播动画；默认收起挂载时若播 collapsible-up 会闪一下内容。 */
const allowAnimate = ref(false);
const running = computed(() => groupHasRunningPart(props.parts, props.indices));
const open = computed(() => {
  if (userOpen.value !== null) return userOpen.value;
  const cached = getProcessFoldOverride(props.agentId, props.messageId, props.groupId);
  if (cached !== undefined) return cached;
  // 默认关闭；进行中工具由时间线外露，不靠整段自动打开
  return isProcessGroupDefaultOpen(props.streaming, running.value);
});

const collapsibleRoot = ref<InstanceType<typeof CollapsibleRoot> | null>(null);
const collapsible = computed<HTMLElement | null>(
  () => collapsibleRoot.value?.$el ?? null,
);
const lockScroll = useScrollLock(collapsible, 200);

const setOpen = (value: boolean) => {
  allowAnimate.value = true;
  lockScroll();
  userOpen.value = value;
  setProcessFoldOverride(props.agentId, props.messageId, props.groupId, value);
};

function syncFromCache() {
  const cached = getProcessFoldOverride(props.agentId, props.messageId, props.groupId);
  userOpen.value = cached === undefined ? null : cached;
}

// 从内存缓存恢复（同条消息内 stream 结束后仍记住）；换段时重置，避免沿用动画开关
watch(
  () => [props.agentId, props.messageId, props.groupId] as const,
  () => {
    allowAnimate.value = false;
    syncFromCache();
  },
  { immediate: true },
);

// 切回本对话：不读缓存（父级已 clear），本地回到默认收起
watch(threadActive, (active, prev) => {
  if (active && prev === false) {
    userOpen.value = null;
    allowAnimate.value = false;
  }
});

const duration = computed(() => formatGroupDuration(props.parts, props.indices));
const label = computed(() =>
  processGroupTriggerLabel(props.stepCount, duration.value),
);
</script>

<template>
  <CollapsibleRoot
    ref="collapsibleRoot"
    :open="open"
    data-slot="aui_process-root"
    class="group/process-root my-0.5 w-full"
    @update:open="setOpen"
  >
    <!-- 过程折叠触发（步骤数 + 可选耗时） -->
    <CollapsibleTrigger
      data-slot="aui_process-trigger"
      class="group/trigger text-muted-foreground hover:text-foreground/80 inline-flex max-w-full items-center gap-1 py-0.5 text-xs transition-colors duration-200"
    >
      <ChevronRightIcon
        class="size-3 shrink-0 transition-transform duration-200 group-data-[state=open]/trigger:rotate-90 motion-reduce:transition-none"
      />
      <span class="tabular-nums">{{ label }}</span>
    </CollapsibleTrigger>
    <CollapsibleContent
      data-slot="aui_process-content"
      class="aui-collapsible-content relative overflow-hidden outline-none"
      :class="allowAnimate && 'aui-collapsible-animate'"
    >
      <div class="mt-0.5 flex min-w-0 flex-col gap-1">
        <PartByIndexProvider
          v-for="partIndex in indices"
          :key="partIndex"
          :index="partIndex"
        >
          <AssistantPart />
        </PartByIndexProvider>
      </div>
    </CollapsibleContent>
  </CollapsibleRoot>
</template>

<style scoped>
/* 仅用户开合后加 .aui-collapsible-animate；默认 closed 挂载不播 up，避免 Write 进段时闪现 */
.aui-collapsible-content.aui-collapsible-animate[data-state="open"] {
  animation: aui-collapsible-down 200ms cubic-bezier(0.32, 0.72, 0, 1);
}
.aui-collapsible-content.aui-collapsible-animate[data-state="closed"] {
  animation: aui-collapsible-up 200ms cubic-bezier(0.32, 0.72, 0, 1);
}
@media (prefers-reduced-motion: reduce) {
  .aui-collapsible-content.aui-collapsible-animate[data-state] {
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

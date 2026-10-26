<script setup lang="ts">
import { computed, ref, useSlots, watch, type Component } from "vue";
import {
  CollapsibleContent,
  CollapsibleRoot,
  CollapsibleTrigger,
} from "reka-ui";
import { ChevronDownIcon } from "@lucide/vue";

import { t, tf } from "../../../../../../../shared/model/ui/ui-locale";
import ShimmerTitle from "../parts/ShimmerTitle.vue";
import { useToolPart } from "./useToolPart";

const props = withDefaults(
  defineProps<{
    title: string;
    detail?: string;
    icon: Component;
    /** 摘要行右侧 +N */
    added?: number;
    /** 摘要行右侧 −M */
    removed?: number;
    /** 显式控制是否可展开；默认看 slot / args / result */
    expandable?: boolean;
    /** 有内容时默认展开（进行中的写/改文件） */
    preferOpen?: boolean;
  }>(),
  { added: 0, removed: 0 },
);

const slots = useSlots();
const {
  isActive,
  isCancelled,
  isInterrupted,
  isError,
  resultText,
  hasResult,
  args,
  argsText,
  duration,
} = useToolPart();

const open = ref(false);

/** 流式参数尚未解析出摘要时，给一个轻量占位，避免只剩工具名。 */
const displayDetail = computed(() => {
  if (isInterrupted.value) {
    return props.detail ? tf("toolTerminatedDetail", { detail: props.detail }) : t("toolTerminated");
  }
  if (props.detail) return props.detail;
  if (isActive.value && !hasResult.value) return t("toolGenerating");
  return "";
});

const resultLabel = computed(() => {
  if (isInterrupted.value) return t("toolTerminated");
  if (isError.value) return t("toolError");
  return t("toolResult");
});

const hasCustomBody = computed(() => Boolean(slots.default));
/** 摘要可能来自已解析 args，而 argsText 在部分状态下仍为空。 */
const hasArgsPayload = computed(() => {
  if (argsText.value.trim()) return true;
  if (!args.value || typeof args.value !== "object") return false;
  return Object.keys(args.value as object).length > 0;
});
const canExpand = computed(() => {
  if (typeof props.expandable === "boolean") return props.expandable;
  return hasCustomBody.value || hasResult.value || hasArgsPayload.value;
});
const showStats = computed(() => props.added > 0 || props.removed > 0);

watch(
  [() => props.preferOpen, isActive, canExpand],
  ([prefer, active, expandable]) => {
    if (prefer && active && expandable) open.value = true;
  },
  { immediate: true },
);
</script>

<template>
  <CollapsibleRoot
    v-model:open="open"
    :disabled="!canExpand"
    class="group/tool border-border/60 bg-background/60 w-full max-w-full overflow-hidden rounded-lg border"
  >
    <!-- 工具摘要行；#summary 可替换默认图标+标题（如委托 Agent 身份条） -->
    <CollapsibleTrigger
      class="text-foreground flex w-full min-w-0 items-center gap-2 px-2.5 py-1.5 text-left text-sm transition duration-200 hover:bg-paper-deep/60 disabled:cursor-default"
    >
      <slot name="summary">
        <component :is="props.icon" class="text-foreground size-3.5 shrink-0" aria-hidden="true" />
        <ShimmerTitle
          :active="isActive"
          :title="title"
          :detail="displayDetail"
        />
      </slot>
      <span
        v-if="showStats"
        class="shrink-0 font-mono text-xs tabular-nums"
        :class="isError || isCancelled || isInterrupted ? 'text-muted-foreground' : undefined"
      >
        <span v-if="added > 0" :class="!isError && !isCancelled && !isInterrupted && 'text-success-foreground'">+{{ added }}</span>
        <span v-if="added > 0 && removed > 0" class="text-muted-foreground"> </span>
        <span v-if="removed > 0" :class="!isError && !isCancelled && !isInterrupted && 'text-destructive'">−{{ removed }}</span>
      </span>
      <span
        v-if="duration !== undefined && !isActive"
        class="text-muted-foreground shrink-0 text-xs tabular-nums"
      >
        {{ duration }}
      </span>
      <ChevronDownIcon
        v-if="canExpand"
        class="text-muted-foreground size-3.5 shrink-0 transition-transform duration-200 group-data-[state=open]/tool:rotate-180 motion-reduce:transition-none"
      />
    </CollapsibleTrigger>

    <!-- 参数与结果 / 自定义正文 -->
    <CollapsibleContent
      class="aui-tool-card-content border-border/60 overflow-hidden border-t outline-none"
    >
      <div v-if="hasCustomBody" class="min-w-0">
        <slot />
      </div>
      <div v-else class="flex flex-col gap-2 px-2.5 py-2">
        <div v-if="argsText" class="min-w-0">
          <p class="text-muted-foreground mb-1 text-xs font-medium">Args</p>
          <pre
            class="bg-paper text-foreground max-h-40 overflow-auto rounded-md p-2 font-mono text-xs whitespace-pre-wrap break-all"
          >{{ argsText }}</pre>
        </div>
        <div v-else-if="hasArgsPayload" class="min-w-0">
          <p class="text-muted-foreground mb-1 text-xs font-medium">Args</p>
          <pre
            class="bg-paper text-foreground max-h-40 overflow-auto rounded-md p-2 font-mono text-xs whitespace-pre-wrap break-all"
          >{{ JSON.stringify(args, null, 2) }}</pre>
        </div>
        <div v-if="hasResult" class="min-w-0">
          <p class="text-muted-foreground mb-1 text-xs font-medium">
            {{ resultLabel }}
          </p>
          <pre
            class="bg-paper max-h-56 overflow-auto rounded-md p-2 font-mono text-xs whitespace-pre-wrap break-all"
            :class="
              isError
                ? 'text-destructive'
                : isInterrupted
                  ? 'text-muted-foreground'
                  : 'text-foreground'
            "
          >{{ resultText }}</pre>
        </div>
      </div>
    </CollapsibleContent>
  </CollapsibleRoot>
</template>

<style scoped>
.aui-tool-card-content[data-state="open"] {
  animation: aui-tool-card-down 200ms cubic-bezier(0.32, 0.72, 0, 1);
}
.aui-tool-card-content[data-state="closed"] {
  animation: aui-tool-card-up 200ms cubic-bezier(0.32, 0.72, 0, 1);
}
@media (prefers-reduced-motion: reduce) {
  .aui-tool-card-content[data-state] {
    animation: none;
  }
}
@keyframes aui-tool-card-down {
  from {
    height: 0;
  }
  to {
    height: var(--reka-collapsible-content-height);
  }
}
@keyframes aui-tool-card-up {
  from {
    height: var(--reka-collapsible-content-height);
  }
  to {
    height: 0;
  }
}
</style>

<script setup lang="ts">
import { CircleCheckIcon, ChevronDownIcon } from "@lucide/vue";
import { CollapsibleContent, CollapsibleRoot, CollapsibleTrigger } from "reka-ui";
import { computed, ref } from "vue";

import { t } from "../../../../../../../shared/model/ui/ui-locale";
import {
  completedTodoTitle,
  type TodoListItem,
} from "../../../../../model/message/todo-list";

const props = withDefaults(
  defineProps<{
    items: TodoListItem[];
    /** tab 内嵌：默认展开，弱化折叠壳 */
    defaultOpen?: boolean;
  }>(),
  { defaultOpen: false },
);

const open = ref(props.defaultOpen);
const title = computed(() => completedTodoTitle({ items: props.items }));
</script>

<template>
  <!-- 本条助手回复内已完成的待办摘要 -->
  <CollapsibleRoot
    v-model:open="open"
    class="group/todo-result w-full"
    :class="defaultOpen ? '' : 'border-border/60 mt-2 border-t pt-2'"
    data-slot="aui_todo-result"
  >
    <CollapsibleTrigger
      class="group/todo-result text-muted-foreground hover:text-foreground inline-flex max-w-full items-center gap-1 py-0.5 text-xs transition-colors duration-200"
      :aria-label="title"
    >
      <ChevronDownIcon
        class="size-3 shrink-0 transition-transform duration-200 group-data-[state=closed]/todo-result:-rotate-90 motion-reduce:transition-none"
        aria-hidden="true"
      />
      <span class="font-medium tabular-nums">{{ title }}</span>
    </CollapsibleTrigger>
    <CollapsibleContent class="aui-todo-result-content overflow-hidden outline-none">
      <ul class="m-0 mt-1.5 list-none space-y-0.5 p-0" :aria-label="t('todoCompleted')">
        <li
          v-for="item in items"
          :key="item.id"
          class="text-muted-foreground flex min-w-0 items-start gap-1.5 text-xs leading-snug"
        >
          <CircleCheckIcon class="size-3.5 mt-0.5 shrink-0" aria-hidden="true" />
          <span
            class="min-w-0 wrap-break-word"
            :class="item.done ? 'line-through' : ''"
          >{{ item.text }}</span>
        </li>
      </ul>
    </CollapsibleContent>
  </CollapsibleRoot>
</template>

<style scoped>
.aui-todo-result-content[data-state="open"] {
  animation: aui-todo-result-down 200ms cubic-bezier(0.32, 0.72, 0, 1);
}
.aui-todo-result-content[data-state="closed"] {
  animation: aui-todo-result-up 200ms cubic-bezier(0.32, 0.72, 0, 1);
}
@media (prefers-reduced-motion: reduce) {
  .aui-todo-result-content[data-state] {
    animation: none;
  }
}
@keyframes aui-todo-result-down {
  from {
    height: 0;
  }
  to {
    height: var(--reka-collapsible-content-height);
  }
}
@keyframes aui-todo-result-up {
  from {
    height: var(--reka-collapsible-content-height);
  }
  to {
    height: 0;
  }
}
</style>

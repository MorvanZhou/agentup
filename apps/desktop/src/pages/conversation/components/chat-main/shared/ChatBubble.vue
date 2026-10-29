<script setup lang="ts">
import { ref } from "vue";

withDefaults(
  defineProps<{
    side: "user" | "agent";
    tag?: "li" | "div";
    /** false 时正文不套气泡色，用于单聊编辑态。 */
    surface?: boolean;
    padded?: boolean;
  }>(),
  { tag: "div", surface: true, padded: true },
);

/** 挂在正文列（含 footer）：拖选越出色块仍能拦截 copy。 */
const emit = defineEmits<{
  copy: [event: ClipboardEvent];
}>();

defineOptions({ inheritAttrs: false });

const surfaceEl = ref<HTMLElement | null>(null);
defineExpose({ surfaceEl });
</script>

<template>
  <component
    :is="tag"
    :data-role="side === 'user' ? 'user' : 'assistant'"
    class="group flex min-w-0 gap-2.5"
    :class="side === 'user' ? 'flex-row-reverse' : 'max-w-[90%]'"
  >
    <!-- 头像不进选区 -->
    <div class="select-none" data-copy-ignore>
      <slot name="avatar" />
    </div>
    <div
      class="flex min-w-0 flex-col gap-1"
      :class="
        side === 'user'
          ? surface
            ? 'max-w-[min(32rem,75%)] items-end'
            : 'w-full max-w-full items-end'
          : 'max-w-full flex-1 items-start'
      "
      @copy="emit('copy', $event)"
    >
      <slot name="header" />
      <div
        v-if="surface"
        ref="surfaceEl"
        class="min-w-0 max-w-full wrap-break-word overflow-x-hidden text-sm shadow-sm"
        :class="[
          side === 'user'
            ? 'rounded-lg rounded-tr-sm bg-primary font-medium leading-snug text-on-primary'
            : 'w-full rounded-lg rounded-tl-sm bg-muted leading-relaxed text-foreground',
          padded ? 'px-3 py-3' : '',
        ]"
        v-bind="$attrs"
      >
        <slot />
      </div>
      <slot v-else />
      <slot name="footer" />
    </div>
  </component>
</template>

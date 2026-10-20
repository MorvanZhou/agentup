<script setup lang="ts">
import { onBeforeUnmount, watch } from "vue";
import { CheckCircle2Icon, CircleAlertIcon, XIcon } from "@lucide/vue";

const props = withDefaults(defineProps<{
  open: boolean;
  message: string;
  tone?: "success" | "error";
  duration?: number;
}>(), {
  tone: "success",
  duration: 4000,
});

const emit = defineEmits<{ "update:open": [value: boolean] }>();
let timer: ReturnType<typeof setTimeout> | undefined;

watch(
  () => [props.open, props.message, props.duration] as const,
  ([open]) => {
    if (timer) clearTimeout(timer);
    if (open && props.duration > 0) {
      timer = setTimeout(() => emit("update:open", false), props.duration);
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer);
});
</script>

<template>
  <!-- 通用提示 -->
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-200 ease-out motion-reduce:transition-none"
      enter-from-class="translate-y-2 opacity-0"
      leave-active-class="transition duration-150 ease-in motion-reduce:transition-none"
      leave-to-class="translate-y-2 opacity-0"
    >
      <div
        v-if="open"
        class="fixed bottom-4 right-4 z-[60] flex max-w-[min(22rem,calc(100vw-2rem))] items-start gap-2 rounded-lg border bg-background px-3 py-2 text-sm text-foreground shadow-lg"
        :class="tone === 'success' ? 'border-accent/30' : 'border-destructive/30'"
        :role="tone === 'error' ? 'alert' : 'status'"
        :aria-live="tone === 'error' ? 'assertive' : 'polite'"
      >
        <CheckCircle2Icon v-if="tone === 'success'" class="mt-0.5 size-4 shrink-0 text-accent" />
        <CircleAlertIcon v-else class="mt-0.5 size-4 shrink-0 text-destructive" />
        <span class="min-w-0 flex-1 leading-snug">{{ message }}</span>
        <button
          type="button"
          class="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition duration-200 hover:bg-paper-deep hover:text-foreground"
          aria-label="关闭提示"
          @click="$emit('update:open', false)"
        >
          <XIcon class="size-3.5" />
        </button>
      </div>
    </Transition>
  </Teleport>
</template>

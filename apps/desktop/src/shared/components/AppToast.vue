<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from "vue";
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

const isError = computed(() => props.tone === "error");

const panelClass = computed(() =>
  isError.value
    ? "border-destructive/25 bg-danger-soft text-destructive"
    : "border-success-foreground/20 bg-success-soft text-success-foreground",
);

const iconClass = computed(() =>
  isError.value ? "text-destructive" : "text-success-foreground",
);

const closeClass = computed(() =>
  isError.value
    ? "text-destructive/70 hover:bg-destructive/10 hover:text-destructive"
    : "text-success-foreground/70 hover:bg-success-foreground/10 hover:text-success-foreground",
);

watch(
  () => [props.open, props.message, props.tone, props.duration] as const,
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
  <!-- 通用提示：success 绿底 / error 红底 -->
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-200 ease-out motion-reduce:transition-none"
      enter-from-class="-translate-y-2 opacity-0"
      leave-active-class="transition duration-150 ease-in motion-reduce:transition-none"
      leave-to-class="-translate-y-2 opacity-0"
    >
      <div
        v-if="open"
        class="fixed top-4 right-4 z-[60] flex max-w-[min(28rem,calc(100vw-2rem))] items-start gap-2 rounded-lg border px-3 py-2.5 text-sm shadow-lg"
        :class="panelClass"
        :role="isError ? 'alert' : 'status'"
        :aria-live="isError ? 'assertive' : 'polite'"
      >
        <CheckCircle2Icon v-if="!isError" class="mt-0.5 size-4 shrink-0" :class="iconClass" />
        <CircleAlertIcon v-else class="mt-0.5 size-4 shrink-0" :class="iconClass" />
        <span class="min-w-0 flex-1 whitespace-pre-wrap break-words leading-snug text-foreground">{{ message }}</span>
        <button
          type="button"
          class="grid size-7 shrink-0 place-items-center rounded-md transition duration-200"
          :class="closeClass"
          aria-label="关闭提示"
          @click="$emit('update:open', false)"
        >
          <XIcon class="size-3.5" />
        </button>
      </div>
    </Transition>
  </Teleport>
</template>

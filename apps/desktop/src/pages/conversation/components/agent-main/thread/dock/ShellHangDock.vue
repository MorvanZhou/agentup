<script setup lang="ts">
import { TimerIcon } from "@lucide/vue";
import { computed, ref, watch } from "vue";

import type { AgentUpShellHangData, ShellHangAction } from "../../../../../../shared/model/chat/chat";
import { t, tf } from "../../../../../../shared/model/ui/ui-locale";

const props = defineProps<{
  hang?: AgentUpShellHangData;
}>();

const emit = defineEmits<{
  decide: [action: ShellHangAction];
}>();

const detailsOpen = ref(false);

watch(
  () => props.hang?.id,
  () => {
    detailsOpen.value = false;
  },
);

const seconds = computed(() => Math.max(1, Math.round((props.hang?.elapsedMs ?? 0) / 1000)));

const command = computed(() => {
  const text = props.hang?.command?.trim() || "";
  return text || t("shellHangNoCommand");
});

/** 展开区：完整命令 + 元数据，便于排查卡住的指令。 */
const detailsText = computed(() => {
  const hang = props.hang;
  if (!hang) return "";
  return [
    hang.command.trim() || t("shellHangNoCommand"),
    "",
    `tool: ${hang.toolName}`,
    `elapsed: ~${seconds.value}s`,
    `toolCallId: ${hang.toolCallId}`,
  ].join("\n");
});
</script>

<template>
  <!-- 阻塞 shell 过久：继续等待 / 终止本轮；命令可展开查看全文 -->
  <section
    v-if="hang"
    class="shrink-0 border-t border-border bg-paper animate-rise motion-reduce:animate-none"
    role="region"
    :aria-labelledby="`shell-hang-title-${hang.id}`"
  >
    <div class="mx-auto w-full px-3 py-2">
      <header class="flex min-w-0 items-center gap-2">
        <span
          class="grid size-7 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent"
          aria-hidden="true"
        >
          <TimerIcon class="size-3.5" />
        </span>
        <div class="min-w-0 flex-1">
          <p class="mb-0 text-xs font-medium tracking-wider text-accent">
            {{ t("shellHangKind") }}
          </p>
          <p v-if="hang.askedByName" class="mb-0 mt-0.5 text-xs text-foreground">
            {{ tf("hitlRelayApproval", { name: hang.askedByName }) }}
          </p>
          <p v-if="hang.taskLabel" class="mb-0 mt-0.5 truncate text-xs text-muted-foreground">
            {{ tf("hitlRelayTask", { label: hang.taskLabel }) }}
          </p>
          <h2
            :id="`shell-hang-title-${hang.id}`"
            class="truncate text-sm font-semibold tracking-tight text-foreground"
          >
            {{ tf("shellHangTitle", { seconds }) }}
          </h2>
          <p class="mb-0 mt-0.5 text-xs text-muted-foreground">
            {{ t("shellHangDesc") }}
          </p>
        </div>
        <div class="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            class="inline-flex h-8 min-w-[4.5rem] cursor-pointer items-center justify-center rounded-lg border border-rule px-3 text-sm text-muted-foreground transition duration-200 hover:bg-paper-deep hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
            @click="emit('decide', 'wait')"
          >
            {{ t("shellHangWait") }}
          </button>
          <button
            type="button"
            class="inline-flex h-8 min-w-[4.5rem] cursor-pointer items-center justify-center rounded-lg bg-destructive px-3 text-sm font-semibold text-white transition duration-200 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
            @click="emit('decide', 'kill')"
          >
            {{ t("shellHangKill") }}
          </button>
        </div>
      </header>

      <!-- 命令摘要；全文按需展开 -->
      <div class="mt-1.5 flex min-w-0 items-center gap-2 pl-9">
        <p
          class="mb-0 min-w-0 flex-1 truncate font-mono text-xs leading-snug text-foreground"
          :title="command"
        >
          {{ command }}
        </p>
        <button
          type="button"
          class="shrink-0 cursor-pointer text-xs font-medium text-muted-foreground transition duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
          :aria-expanded="detailsOpen"
          :aria-controls="`shell-hang-details-${hang.id}`"
          @click="detailsOpen = !detailsOpen"
        >
          {{ detailsOpen ? t("approvalHideDetails") : t("approvalDetails") }}
        </button>
      </div>

      <pre
        v-if="detailsOpen"
        :id="`shell-hang-details-${hang.id}`"
        class="mt-1.5 mb-0 ml-9 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-paper-deep p-2 font-mono text-xs text-muted-foreground"
      >{{ detailsText }}</pre>
    </div>
  </section>
</template>

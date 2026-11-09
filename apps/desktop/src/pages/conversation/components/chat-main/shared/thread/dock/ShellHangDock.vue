<script setup lang="ts">
import { TimerIcon } from "@lucide/vue";
import { computed, ref, watch } from "vue";

import type { AgentUpShellHangData, ShellHangAction } from "../../../../../../../shared/model/chat/chat";
import { t, tf } from "../../../../../../../shared/model/ui/ui-locale";
import HitlAgentFace from "./HitlAgentFace.vue";

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

/** 首行标签：子代理时叠名。 */
const headerLabel = computed(() => {
  const name = props.hang?.askedByName?.trim();
  const kind = t("shellHangKind");
  return name ? `${name} · ${kind}` : kind;
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
  <!-- 空闲命令人审：首行 icon/label/title；操作落底 -->
  <section
    v-if="hang"
    class="shrink-0 border-t border-rule/80 bg-background animate-rise motion-reduce:animate-none"
    role="region"
    :aria-labelledby="`shell-hang-title-${hang.id}`"
  >
    <div class="mx-auto w-full px-3 py-3">
      <!-- 首行：face/类型图标 + 标签 + 标题 -->
      <header class="flex min-w-0 items-center gap-2">
        <HitlAgentFace
          v-if="hang.askedByName"
          :name="hang.askedByName"
          :agent-id="hang.askedByAgentId"
        />
        <TimerIcon v-else class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <p class="mb-0 shrink-0 text-sm text-muted-foreground">{{ headerLabel }}</p>
        <h2
          :id="`shell-hang-title-${hang.id}`"
          class="mb-0 min-w-0 flex-1 truncate text-sm font-medium text-foreground"
        >
          {{ tf("shellHangTitle", { seconds }) }}
        </h2>
        <p
          v-if="(hang.queueBehind ?? 0) > 0"
          class="mb-0 shrink-0 text-xs text-muted-foreground"
        >
          {{ tf("hitlQueueBehind", { n: hang.queueBehind ?? 0 }) }}
        </p>
      </header>
      <p class="mb-0 mt-1.5 text-xs text-muted-foreground">
        {{ t("shellHangDesc") }}
      </p>
      <p
        v-if="hang.taskLabel"
        class="mb-0 mt-1 truncate text-xs text-muted-foreground"
      >
        {{ tf("hitlRelayTask", { label: hang.taskLabel }) }}
      </p>

      <!-- 命令块 -->
      <pre
        class="mt-2.5 mb-0 max-h-36 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-paper-deep px-3 py-2.5 font-mono text-xs leading-relaxed text-muted-foreground"
      >{{ command }}</pre>
      <pre
        v-if="detailsOpen"
        :id="`shell-hang-details-${hang.id}`"
        class="mt-1.5 mb-0 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-paper-deep px-3 py-2 font-mono text-xs text-muted-foreground"
      >{{ detailsText }}</pre>

      <!-- 操作：左技术详情，右等待 / 后台 / 终止 -->
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="mr-auto shrink-0 cursor-pointer text-xs font-medium text-muted-foreground transition duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
          :aria-expanded="detailsOpen"
          :aria-controls="`shell-hang-details-${hang.id}`"
          @click="detailsOpen = !detailsOpen"
        >
          {{ detailsOpen ? t("approvalHideDetails") : t("approvalDetails") }}
        </button>
        <button
          type="button"
          class="inline-flex h-8 min-w-[4.5rem] cursor-pointer items-center justify-center rounded-full border border-rule px-3 text-sm text-muted-foreground transition duration-200 hover:bg-paper-deep hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
          @click="emit('decide', 'wait')"
        >
          {{ t("shellHangWait") }}
        </button>
        <button
          type="button"
          class="inline-flex h-8 min-w-[4.5rem] cursor-pointer items-center justify-center rounded-full border border-rule px-3 text-sm text-muted-foreground transition duration-200 hover:bg-paper-deep hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
          @click="emit('decide', 'bg')"
        >
          {{ t("shellHangBg") }}
        </button>
        <button
          type="button"
          class="inline-flex h-8 min-w-[4.5rem] cursor-pointer items-center justify-center rounded-full bg-destructive px-3 text-sm font-semibold text-white transition duration-200 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
          @click="emit('decide', 'kill')"
        >
          {{ t("shellHangKill") }}
        </button>
      </div>
    </div>
  </section>
</template>

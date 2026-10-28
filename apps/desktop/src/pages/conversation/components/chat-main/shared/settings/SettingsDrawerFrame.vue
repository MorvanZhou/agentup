<script setup lang="ts">
import { SlidersHorizontalIcon, XIcon } from "@lucide/vue";

import { t } from "../../../../../../shared/model/ui/ui-locale";

const emit = defineEmits<{
  close: [];
}>();

withDefaults(
  defineProps<{
    /** 页头副文案；缺省用本会话说明 */
    lead?: string;
  }>(),
  { lead: "" },
);
</script>

<template>
  <!-- 对话配置抽屉壳：页头 + 可滚动主区；单聊/群聊共用 -->
  <aside class="relative flex h-full min-h-0 w-full flex-col overflow-hidden border-l border-border bg-background">
    <!-- 氛围：顶缘极淡橙光，不抢内容 -->
    <div
      class="pointer-events-none absolute inset-x-0 top-0 h-28 bg-[radial-gradient(ellipse_at_top,color-mix(in_oklab,var(--color-accent)_14%,transparent),transparent_70%)]"
      aria-hidden="true"
    />

    <header class="relative z-[1] flex shrink-0 items-start gap-2.5 border-b border-rule bg-paper/90 px-3 py-3 backdrop-blur-[2px]">
      <span
        class="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl border border-rule bg-background text-accent"
        aria-hidden="true"
      >
        <SlidersHorizontalIcon class="size-4" />
      </span>
      <div class="min-w-0 flex-1 pt-0.5">
        <p class="m-0 text-[11px] font-medium tracking-[0.14em] text-accent">
          {{ t("chatSettingsKicker") }}
        </p>
        <h2 class="m-0 mt-0.5 truncate text-sm font-semibold tracking-tight text-foreground">
          {{ t("chatSettingsTitle") }}
        </h2>
        <p v-if="lead" class="mb-0 mt-1 text-xs leading-snug text-muted-foreground">
          {{ lead }}
        </p>
      </div>
      <button
        type="button"
        class="app-no-drag grid size-8 shrink-0 place-items-center rounded-lg border-0 bg-transparent text-muted-foreground outline-none transition duration-200 hover:bg-paper-deep hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40"
        :aria-label="t('chatSettingsClose')"
        @click="emit('close')"
      >
        <XIcon class="size-4" aria-hidden="true" />
      </button>
    </header>

    <div class="relative z-[1] min-h-0 flex-1 overflow-y-auto px-3 py-3.5">
      <slot />
    </div>
  </aside>
</template>

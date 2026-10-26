<script setup lang="ts">
import { computed } from "vue";

import { t } from "../../../shared/model/ui/ui-locale";

type SectionId = "account" | "provider" | "appearance";

const items = computed(() => [
  { id: "appearance" as const, label: t("settingsAppearance") },
  { id: "provider" as const, label: t("settingsProvider") },
  { id: "account" as const, label: t("settingsAccount") },
]);

defineProps<{ active: SectionId }>();
defineEmits<{ select: [id: SectionId] }>();
</script>

<template>
  <!-- 设置侧栏 -->
  <nav
    class="app-drag app-titlebar-pad flex max-h-36 min-h-0 flex-col overflow-auto px-2 py-2 min-[730px]:max-h-none min-[730px]:flex-1 min-[730px]:overflow-y-auto min-[730px]:px-2 min-[730px]:py-3"
    :aria-label="t('settingsNavAria')"
  >
    <h2 class="mx-1 mb-3 text-sm font-semibold tracking-tight text-foreground min-[730px]:mx-1.5">
      {{ t("settingsTitle") }}
    </h2>

    <div class="app-no-drag flex gap-1.5 overflow-x-auto min-[730px]:flex-col min-[730px]:gap-0.5 min-[730px]:overflow-visible">
      <button
        v-for="item in items"
        :key="item.id"
        type="button"
        class="inline-flex min-h-8 shrink-0 items-center rounded-lg border-0 bg-transparent px-2.5 text-sm font-medium text-muted-foreground transition duration-200 hover:bg-accent/10 hover:text-accent min-[730px]:w-full min-[730px]:justify-start"
        :class="{ 'bg-accent/10! text-accent!': item.id === active }"
        :aria-current="item.id === active ? 'page' : undefined"
        @click="$emit('select', item.id)"
      >
        {{ item.label }}
      </button>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { computed } from "vue";

import { t } from "../../../shared/model/ui-locale";

export type AgentsTab = "market" | "recruited" | "owned";

defineProps<{ tab: AgentsTab }>();

defineEmits<{ select: [tab: AgentsTab] }>();

const items = computed(() => [
  { id: "market" as const, label: t("agentsTabMarket") },
  { id: "recruited" as const, label: t("agentsTabRecruited") },
  { id: "owned" as const, label: t("agentsTabOwned") },
]);
</script>

<template>
  <!-- 市场侧栏 -->
  <nav
    class="app-drag app-titlebar-pad flex max-h-36 min-h-0 flex-col gap-0.5 overflow-auto px-2 py-2 min-[730px]:max-h-none min-[730px]:flex-1 min-[730px]:overflow-y-auto min-[730px]:px-2 min-[730px]:py-3"
    :aria-label="t('agentsNavLabel')"
  >
    <div class="app-no-drag flex gap-1.5 overflow-x-auto min-[730px]:block min-[730px]:overflow-visible">
      <button
        v-for="item in items"
        :key="item.id"
        type="button"
        class="inline-flex min-h-8 shrink-0 items-center rounded-lg border-0 bg-transparent px-2.5 text-sm font-medium text-muted-foreground transition duration-200 hover:bg-accent/10 hover:text-accent min-[730px]:w-full"
        :class="{ 'bg-accent/10! text-accent!': item.id === tab }"
        @click="$emit('select', item.id)"
      >
        {{ item.label }}
      </button>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";

import { t } from "../../../../shared/model/ui-locale";

export type AgentsSection = "assistant" | "local" | "recruited" | "owned";

defineProps<{ section: AgentsSection }>();

const items = computed(() => [
  { id: "local" as const, name: "agents-local" as const, label: t("agentsSectionLocal") },
  { id: "assistant" as const, name: "agents-assistant" as const, label: t("agentsSectionAssistant") },
  { id: "recruited" as const, name: "agents-recruited" as const, label: t("agentsSectionRecruited") },
  { id: "owned" as const, name: "agents-owned" as const, label: t("agentsSectionOwned") },
]);
</script>

<template>
  <!-- Agents 管理侧栏 -->
  <nav
    class="app-drag app-titlebar-pad flex max-h-36 min-h-0 flex-col gap-0.5 overflow-auto px-2 py-2 min-[730px]:max-h-none min-[730px]:flex-1 min-[730px]:overflow-y-auto min-[730px]:px-2 min-[730px]:py-3"
    :aria-label="t('agentsNavLabel')"
  >
    <h2 class="mx-1 mb-2 hidden text-sm font-semibold tracking-tight text-foreground min-[730px]:mx-1.5 min-[730px]:block">
      {{ t("agentsManageTitle") }}
    </h2>
    <div class="app-no-drag flex gap-1.5 overflow-x-auto min-[730px]:block min-[730px]:overflow-visible">
      <RouterLink
        v-for="item in items"
        :key="item.id"
        :to="{ name: item.name }"
        class="inline-flex min-h-8 shrink-0 items-center rounded-lg border-0 bg-transparent px-2.5 text-sm font-medium text-muted-foreground no-underline transition duration-200 hover:bg-accent/10 hover:text-accent min-[730px]:w-full"
        :class="{ 'bg-accent/10! text-accent!': item.id === section }"
        :aria-current="item.id === section ? 'page' : undefined"
      >
        {{ item.label }}
      </RouterLink>
    </div>
  </nav>
</template>

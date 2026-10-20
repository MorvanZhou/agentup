<script setup lang="ts">
import { computed } from "vue";

import { t } from "../../../shared/model/ui-locale";

type SectionId = "assistant" | "skills" | "rules" | "mcp" | "account" | "provider" | "appearance";

const groups = computed(() => [
  {
    id: "assistant",
    label: t("settingsGroupAssistant"),
    items: [
      { id: "assistant" as const, label: t("settingsAssistant") },
      { id: "skills" as const, label: t("settingsSkills") },
      { id: "rules" as const, label: t("settingsRules") },
      { id: "mcp" as const, label: t("settingsMcp") },
    ],
  },
  {
    id: "app",
    label: t("settingsGroupApp"),
    items: [
      { id: "account" as const, label: t("settingsAccount") },
      { id: "provider" as const, label: t("settingsProvider") },
      { id: "appearance" as const, label: t("settingsAppearance") },
    ],
  },
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

    <div
      class="app-no-drag flex gap-4 overflow-x-auto min-[730px]:flex-col min-[730px]:gap-5 min-[730px]:overflow-visible"
    >
      <section
        v-for="group in groups"
        :key="group.id"
        class="flex shrink-0 flex-col gap-0.5 min-[730px]:w-full"
      >
        <h3 class="px-2.5 pb-1 text-xs font-medium tracking-wider text-muted-foreground">
          {{ group.label }}
        </h3>
        <div class="flex gap-1 min-[730px]:ml-2 min-[730px]:flex-col min-[730px]:border-l min-[730px]:border-rule min-[730px]:pl-2">
          <button
            v-for="item in group.items"
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
      </section>
    </div>
  </nav>
</template>

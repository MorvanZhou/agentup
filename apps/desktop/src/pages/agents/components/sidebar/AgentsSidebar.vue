<script setup lang="ts">
import { computed } from "vue";

import PageSidebar from "../../../../shared/components/PageSidebar.vue";
import { t } from "../../../../shared/model/ui/ui-locale";

export type AgentsSection = "assistant" | "local" | "recruited" | "owned" | "teams";

defineProps<{ section: AgentsSection }>();

const items = computed(() => [
  { id: "local", to: { name: "agents-local" as const }, label: t("agentsSectionLocal") },
  { id: "assistant", to: { name: "agents-assistant" as const }, label: t("agentsSectionAssistant") },
  { id: "recruited", to: { name: "agents-recruited" as const }, label: t("agentsSectionRecruited") },
  { id: "owned", to: { name: "agents-owned" as const }, label: t("agentsSectionOwned") },
  { id: "teams", to: { name: "teams-owned" as const }, label: t("teamsOwnedTitle") },
]);
</script>

<template>
  <!-- Agents 管理侧栏 -->
  <PageSidebar
    :title="t('agentsManageTitle')"
    :ariaLabel="t('agentsNavLabel')"
    :items="items"
    :active="section"
    hide-title-on-narrow
  />
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";

import SettingsSidebar from "./components/SettingsSidebar.vue";
import AccountSettings from "./components/sections/app-settings/AccountSettings.vue";
import AppearanceSettings from "./components/sections/app-settings/AppearanceSettings.vue";
import ProviderSettings from "./components/sections/app-settings/ProviderSettings.vue";
import AssistantProfileSettings from "./components/sections/my-assistant/AssistantProfileSettings.vue";
import McpSettings from "./components/sections/my-assistant/McpSettings.vue";
import RulesSettings from "./components/sections/my-assistant/RulesSettings.vue";
import SkillsSettings from "./components/sections/my-assistant/SkillsSettings.vue";

type SectionId = "assistant" | "account" | "appearance" | "provider" | "skills" | "rules" | "mcp";

const SECTIONS = new Set<SectionId>([
  "assistant",
  "account",
  "appearance",
  "provider",
  "skills",
  "rules",
  "mcp",
]);

const route = useRoute();
const router = useRouter();

const section = computed<SectionId>({
  get() {
    const value = route.query.section;
    if (value === "model") return "provider";
    return typeof value === "string" && SECTIONS.has(value as SectionId)
      ? (value as SectionId)
      : "assistant";
  },
  set(id) {
    void router.replace({ name: "settings", query: { section: id } });
  },
});
</script>

<template>
  <div
    class="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background min-[730px]:grid-cols-[14rem_minmax(0,1fr)] min-[730px]:grid-rows-1"
  >
    <!-- 设置侧栏 -->
    <aside class="flex min-h-0 min-w-0 flex-col border-r border-rule bg-paper text-foreground">
      <SettingsSidebar :active="section" @select="section = $event" />
    </aside>

    <AssistantProfileSettings v-if="section === 'assistant'" />
    <SkillsSettings v-else-if="section === 'skills'" />
    <RulesSettings v-else-if="section === 'rules'" />
    <McpSettings v-else-if="section === 'mcp'" />
    <AccountSettings v-else-if="section === 'account'" />
    <ProviderSettings v-else-if="section === 'provider'" />
    <AppearanceSettings v-else />
  </div>
</template>

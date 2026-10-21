<script setup lang="ts">
import { BotIcon, MessageSquareIcon, SettingsIcon, StoreIcon } from "@lucide/vue";
import { computed } from "vue";
import { RouterLink, useRoute } from "vue-router";

import { unreadLabel } from "../pages/conversation/model/conversation-row";
import { t } from "../shared/model/ui-locale";
import { useDesktop } from "./desktop";

const route = useRoute();
const { blockedCount } = useDesktop();
const conversationBadge = computed(() => unreadLabel(blockedCount.value));

const items = computed(() => [
  { id: "conversation" as const, to: { name: "conversation" as const }, label: t("navMessages"), icon: MessageSquareIcon },
  { id: "market" as const, to: { name: "market" as const }, label: t("navMarket"), icon: StoreIcon },
  { id: "agents" as const, to: { name: "agents-assistant" as const }, label: t("navAgents"), icon: BotIcon },
]);

function itemActive(id: "conversation" | "market" | "agents"): boolean {
  const name = String(route.name ?? "");
  if (id === "conversation") return name === "conversation";
  if (id === "market") return name === "market";
  return name === "agents" || name.startsWith("agents-");
}

function itemAriaLabel(item: { id: string; label: string }): string {
  if (item.id === "conversation" && conversationBadge.value) {
    return `${item.label}，${conversationBadge.value} ${t("navBlocked")}`;
  }
  return item.label;
}
</script>

<template>
  <!-- 主导航 -->
  <nav
    class="app-no-drag flex min-w-0 items-center gap-1 max-[729px]:flex-1 max-[729px]:justify-center min-[730px]:min-h-0 min-[730px]:w-full min-[730px]:flex-1 min-[730px]:flex-col min-[730px]:gap-3.5"
  >
    <RouterLink
      v-for="item in items"
      :key="item.id"
      :to="item.to"
      class="app-no-drag relative grid size-12 place-items-center rounded-lg text-shell-muted no-underline transition duration-200 hover:bg-accent/10 hover:text-accent"
      active-class=""
      exact-active-class=""
      :class="{ 'bg-accent/10! text-accent!': itemActive(item.id) }"
      :aria-label="itemAriaLabel(item)"
      :aria-current="itemActive(item.id) ? 'page' : undefined"
      :title="item.label"
    >
      <component :is="item.icon" class="size-6" />
      <span
        v-if="item.id === 'conversation' && conversationBadge"
        class="absolute top-1.5 right-1.5 grid min-h-4 min-w-4 place-items-center rounded-full bg-destructive px-0.5 text-xs leading-none font-semibold text-white"
        aria-hidden="true"
      >
        {{ conversationBadge }}
      </span>
    </RouterLink>
    <!-- 设置入口：宽屏沉底，窄屏跟在主导航后 -->
    <RouterLink
      :to="{ name: 'settings', query: { section: 'appearance' } }"
      class="app-no-drag relative grid size-12 place-items-center rounded-lg text-shell-muted no-underline transition duration-200 hover:bg-accent/10 hover:text-accent min-[730px]:mt-auto"
      active-class=""
      exact-active-class=""
      :class="{ 'bg-accent/10! text-accent!': route.name === 'settings' }"
      :aria-label="t('navSettings')"
      :aria-current="route.name === 'settings' ? 'page' : undefined"
      :title="t('navSettings')"
    >
      <SettingsIcon class="size-6" />
    </RouterLink>
  </nav>
</template>

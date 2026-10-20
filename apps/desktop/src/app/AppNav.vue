<script setup lang="ts">
import { computed } from "vue";
import { MessageSquareIcon, SettingsIcon, StoreIcon } from "@lucide/vue";
import { RouterLink } from "vue-router";

import { totalUnread, unreadLabel } from "../pages/conversation/model/conversation-row";
import { t } from "../shared/model/ui-locale";
import { useDesktop } from "./desktop";

const { unread } = useDesktop();
const conversationBadge = computed(() => unreadLabel(totalUnread(unread.value)));

const items = computed(() => [
  { name: "conversation" as const, label: t("navMessages"), icon: MessageSquareIcon },
  { name: "agents" as const, label: t("navMarket"), icon: StoreIcon },
]);

function itemAriaLabel(item: { name: string; label: string }): string {
  if (item.name === "conversation" && conversationBadge.value) {
    return `${item.label}，${conversationBadge.value} ${t("navUnread")}`;
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
      :key="item.name"
      :to="{ name: item.name }"
      class="app-no-drag relative grid size-12 place-items-center rounded-lg text-shell-muted no-underline transition duration-200 hover:bg-accent/10 hover:text-accent"
      active-class=""
      exact-active-class="bg-accent/10! text-accent!"
      :aria-label="itemAriaLabel(item)"
      :title="item.label"
    >
      <component :is="item.icon" class="size-6" />
      <span
        v-if="item.name === 'conversation' && conversationBadge"
        class="absolute top-1.5 right-1.5 grid min-h-4 min-w-4 place-items-center rounded-full bg-destructive px-0.5 text-xs leading-none font-semibold text-white"
        aria-hidden="true"
      >
        {{ conversationBadge }}
      </span>
    </RouterLink>
    <!-- 设置入口：宽屏沉底，窄屏跟在主导航后 -->
    <RouterLink
      :to="{ name: 'settings', query: { section: 'assistant' } }"
      class="app-no-drag relative grid size-12 place-items-center rounded-lg text-shell-muted no-underline transition duration-200 hover:bg-accent/10 hover:text-accent min-[730px]:mt-auto"
      active-class=""
      exact-active-class="bg-accent/10! text-accent!"
      :aria-label="t('navSettings')"
      :title="t('navSettings')"
    >
      <SettingsIcon class="size-6" />
    </RouterLink>
  </nav>
</template>

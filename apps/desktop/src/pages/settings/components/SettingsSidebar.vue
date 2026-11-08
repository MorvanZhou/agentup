<script setup lang="ts">
import { CpuIcon, InfoIcon, SlidersHorizontalIcon, UserIcon } from "@lucide/vue";
import { computed } from "vue";

import PageSidebar from "../../../shared/components/PageSidebar.vue";
import { t } from "../../../shared/model/ui/ui-locale";

type SectionId = "account" | "provider" | "general" | "about";

const items = computed(() => [
  { id: "provider", label: t("settingsProvider"), icon: CpuIcon },
  { id: "general", label: t("settingsGeneral"), icon: SlidersHorizontalIcon },
  { id: "account", label: t("settingsAccount"), icon: UserIcon },
  { id: "about", label: t("settingsAbout"), icon: InfoIcon },
]);

defineProps<{ active: SectionId }>();
defineEmits<{ select: [id: SectionId] }>();
</script>

<template>
  <!-- 设置侧栏 -->
  <PageSidebar
    :title="t('settingsTitle')"
    :ariaLabel="t('settingsNavAria')"
    :items="items"
    :active="active"
    @select="$emit('select', $event as SectionId)"
  />
</template>

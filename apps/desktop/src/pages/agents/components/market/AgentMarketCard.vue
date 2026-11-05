<script setup lang="ts">
import { EllipsisIcon, FolderOpenIcon, UserMinusIcon, UserPlusIcon, UsersIcon } from "@lucide/vue";
import { computed, ref } from "vue";

import AppDialog from "../../../../shared/components/AppDialog.vue";
import AppDropdownMenu, { type AppDropdownItem } from "../../../../shared/components/AppDropdownMenu.vue";
import AgentCatalogCard from "../../../../shared/components/agent/AgentCatalogCard.vue";
import type { AgentCard } from "../../../../shared/model/runtime/runtime";
import { t, tf } from "../../../../shared/model/ui/ui-locale";
import AgentProfileDialog from "../AgentProfileDialog.vue";

const props = withDefaults(
  defineProps<{
    agent: AgentCard;
    busy: boolean;
    /** market：只招募/标已招；manage：开目录与解雇 */
    surface?: "market" | "manage";
  }>(),
  { surface: "market" },
);
const emit = defineEmits<{
  recruit: [agentId: string];
  open: [agentId: string];
  dismiss: [agentId: string];
  chat: [agent: AgentCard];
}>();

const confirmDismiss = ref(false);
const profileOpen = ref(false);

const showManageMenu = computed(() => props.surface === "manage" && props.agent.recruited);
const showRecruit = computed(() => props.surface === "market" && !props.agent.recruited);
const showRecruited = computed(() => props.surface === "market" && props.agent.recruited);
const profileScene = computed(() =>
  props.surface === "manage" || props.agent.recruited ? "recruited" : "market",
);

const menuItems = computed((): AppDropdownItem[] => [
  { id: "open", label: t("agentsOpenDir"), icon: FolderOpenIcon, disabled: props.busy },
  {
    id: "dismiss",
    label: props.busy ? t("threadDismissing") : t("threadDismiss"),
    icon: UserMinusIcon,
    disabled: props.busy,
    danger: true,
  },
]);

function onSelect(id: string): void {
  if (id === "open") {
    emit("open", props.agent.agentId);
    return;
  }
  if (id === "dismiss") confirmDismiss.value = true;
}

function confirmDismissAction(): void {
  confirmDismiss.value = false;
  emit("dismiss", props.agent.agentId);
}
</script>

<template>
  <AgentCatalogCard
    :agent="agent"
    :title-id="`agent-card-${agent.agentId}`"
    @view-profile="profileOpen = true"
  >
    <template v-if="showRecruited" #badge>
      <span
        class="inline-flex shrink-0 items-center rounded-md bg-success-soft px-1.5 py-0.5 text-[10px] font-semibold leading-none text-success-foreground"
        :aria-label="t('agentsRecruited')"
      >
        {{ t("agentsRecruited") }}
      </span>
    </template>
    <template v-if="showManageMenu" #trailing>
      <AppDropdownMenu :items="menuItems" @select="onSelect">
        <template #trigger>
          <button
            type="button"
            :disabled="busy"
            class="grid size-7 shrink-0 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-muted-foreground outline-none transition duration-200 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-45"
            :aria-label="tf('agentsManageAria', { name: agent.name })"
          >
            <EllipsisIcon class="size-3.5" aria-hidden="true" />
          </button>
        </template>
      </AppDropdownMenu>
    </template>
    <template #footer>
      <span
        class="inline-flex min-w-0 flex-1 items-center gap-1 truncate text-[11px] tabular-nums text-muted-foreground"
        :aria-label="tf('agentsRecruitCount', { n: agent.recruitCount })"
      >
        <UsersIcon class="size-3 shrink-0 opacity-70" aria-hidden="true" />
        {{ tf("agentsRecruitCount", { n: agent.recruitCount }) }}
      </span>
      <button
        v-if="showRecruit"
        type="button"
        :disabled="busy"
        class="inline-flex min-h-7 shrink-0 cursor-pointer items-center gap-1 rounded-lg bg-accent px-2.5 text-xs font-semibold text-white transition duration-200 hover:bg-accent-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-45"
        :aria-label="tf('agentsRecruitAria', { name: agent.name })"
        @click="$emit('recruit', agent.agentId)"
      >
        <UserPlusIcon class="size-3.5 shrink-0" aria-hidden="true" />
        {{ busy ? t("agentsRecruiting") : t("agentsRecruit") }}
      </button>
    </template>
  </AgentCatalogCard>

  <AppDialog
    :open="confirmDismiss"
    :title="t('threadDismissTitle')"
    :description="t('threadDismissBody')"
    @update:open="confirmDismiss = $event"
  >
    <template #footer>
      <button
        type="button"
        class="min-h-8 cursor-pointer rounded-lg border border-rule px-3 text-sm font-medium transition duration-200 hover:bg-paper-deep"
        @click="confirmDismiss = false"
      >
        {{ t("cancel") }}
      </button>
      <button
        type="button"
        class="min-h-8 cursor-pointer rounded-lg bg-destructive px-3 text-sm font-semibold text-white transition duration-200 hover:opacity-90"
        @click="confirmDismissAction"
      >
        {{ t("threadDismiss") }}
      </button>
    </template>
  </AppDialog>
  <AgentProfileDialog
    :open="profileOpen"
    :agent="agent"
    :scene="profileScene"
    :busy="busy"
    @update:open="profileOpen = $event"
    @recruit="$emit('recruit', $event)"
    @chat="$emit('chat', $event)"
  />
</template>

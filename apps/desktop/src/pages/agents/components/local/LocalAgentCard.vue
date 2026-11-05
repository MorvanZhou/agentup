<script setup lang="ts">
import {
  EllipsisIcon,
  FolderOpenIcon,
  MessageSquareIcon,
  PencilIcon,
  Trash2Icon,
  UploadIcon,
} from "@lucide/vue";
import { computed, ref } from "vue";

import AppDialog from "../../../../shared/components/AppDialog.vue";
import AppDropdownMenu, { type AppDropdownItem } from "../../../../shared/components/AppDropdownMenu.vue";
import AgentCatalogCard from "../../../../shared/components/agent/AgentCatalogCard.vue";
import type { AgentCard } from "../../../../shared/model/runtime/runtime";
import { t, tf } from "../../../../shared/model/ui/ui-locale";
import AgentProfileDialog from "../AgentProfileDialog.vue";

const props = defineProps<{ agent: AgentCard; busy: boolean }>();
const emit = defineEmits<{
  chat: [agent: AgentCard];
  edit: [agentId: string];
  open: [agentId: string];
  publish: [agent: AgentCard];
  remove: [agentId: string];
}>();

const confirmDelete = ref(false);
const profileOpen = ref(false);

const menuItems = computed((): AppDropdownItem[] => [
  { id: "edit", label: t("agentsLocalEdit"), icon: PencilIcon, disabled: props.busy },
  { id: "open", label: t("agentsOpenDir"), icon: FolderOpenIcon, disabled: props.busy },
  {
    id: "publish",
    label: props.agent.publishedAgentId ? t("agentsLocalRepublish") : t("agentsLocalPublish"),
    icon: UploadIcon,
    disabled: props.busy,
  },
  {
    id: "remove",
    label: t("agentsLocalDelete"),
    icon: Trash2Icon,
    disabled: props.busy,
    danger: true,
  },
]);

function onSelect(id: string): void {
  if (id === "edit") {
    emit("edit", props.agent.agentId);
    return;
  }
  if (id === "open") {
    emit("open", props.agent.agentId);
    return;
  }
  if (id === "publish") {
    emit("publish", props.agent);
    return;
  }
  if (id === "remove") confirmDelete.value = true;
}

function confirmDeleteAction(): void {
  confirmDelete.value = false;
  emit("remove", props.agent.agentId);
}

function onProfileEdit(agent: AgentCard): void {
  emit("edit", agent.agentId);
}
</script>

<template>
  <AgentCatalogCard
    :agent="agent"
    :title-id="`local-agent-${agent.agentId}`"
    @view-profile="profileOpen = true"
  >
    <template #trailing>
      <AppDropdownMenu :items="menuItems" @select="onSelect">
        <template #trigger>
          <button
            type="button"
            class="grid size-7 shrink-0 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-muted-foreground outline-none transition duration-200 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-45"
            :aria-label="tf('agentsManageAria', { name: agent.name })"
            :disabled="busy"
          >
            <EllipsisIcon class="size-3.5" aria-hidden="true" />
          </button>
        </template>
      </AppDropdownMenu>
    </template>
    <template #footer>
      <button
        type="button"
        class="inline-flex min-w-0 flex-1 cursor-pointer items-center gap-1 truncate border-0 bg-transparent p-0 text-left text-[11px] font-medium text-muted-foreground transition duration-200 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-45"
        :disabled="busy"
        @click="emit('chat', agent)"
      >
        <MessageSquareIcon class="size-3 shrink-0 opacity-70" aria-hidden="true" />
        {{ t("agentsLocalChat") }}
      </button>
    </template>
  </AgentCatalogCard>

  <AppDialog
    :open="confirmDelete"
    :title="t('agentsLocalDeleteTitle')"
    :description="tf('agentsLocalDeleteDesc', { name: agent.name })"
    @update:open="confirmDelete = $event"
  >
    <div class="flex justify-end gap-2 p-4">
      <button
        type="button"
        class="inline-flex min-h-8 items-center rounded-lg border border-rule bg-paper px-3 text-sm font-medium text-foreground"
        @click="confirmDelete = false"
      >
        {{ t("agentsLocalCancel") }}
      </button>
      <button
        type="button"
        class="inline-flex min-h-8 items-center rounded-lg bg-destructive px-3 text-sm font-semibold text-white"
        @click="confirmDeleteAction"
      >
        {{ t("agentsLocalDelete") }}
      </button>
    </div>
  </AppDialog>
  <AgentProfileDialog
    :open="profileOpen"
    :agent="agent"
    scene="local"
    :busy="busy"
    @update:open="profileOpen = $event"
    @edit="onProfileEdit"
  />
</template>

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

import AgentAvatar from "../../../../shared/components/AgentAvatar.vue";
import AppDialog from "../../../../shared/components/AppDialog.vue";
import AppDropdownMenu, { type AppDropdownItem } from "../../../../shared/components/AppDropdownMenu.vue";
import type { AgentCard } from "../../../../shared/model/runtime";
import { formatAgentTime } from "../../../../shared/model/time";
import { t, tf } from "../../../../shared/model/ui-locale";

const props = defineProps<{ agent: AgentCard; busy: boolean }>();
const emit = defineEmits<{
  chat: [agent: AgentCard];
  edit: [agentId: string];
  open: [agentId: string];
  publish: [agent: AgentCard];
  remove: [agentId: string];
}>();

const confirmDelete = ref(false);
const updatedLabel = computed(() => formatAgentTime(props.agent.updatedAt));

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
</script>

<template>
  <article
    class="group flex gap-3.5 rounded-xl border border-rule bg-paper p-3.5 shadow-sm transition duration-200 ease-out hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-md motion-reduce:transform-none motion-reduce:transition-none"
    :aria-labelledby="`local-agent-${agent.agentId}`"
  >
    <!-- 本机私有 Agent 卡片 -->
    <AgentAvatar :name="agent.name" :avatar-url="agent.avatarUrl" size="xl" />

    <div class="flex min-w-0 flex-1 flex-col gap-2.5">
      <div class="min-w-0">
        <div class="flex items-start justify-between gap-3">
          <div class="flex min-w-0 items-center gap-1.5">
            <h2
              :id="`local-agent-${agent.agentId}`"
              class="m-0 min-w-0 truncate text-sm font-semibold tracking-tight text-foreground"
              :title="agent.name"
            >
              {{ agent.name }}
            </h2>
            <span v-if="agent.role" class="shrink-0 truncate text-xs font-normal text-muted-foreground">
              {{ agent.role }}
            </span>
            <span
              class="inline-flex shrink-0 items-center rounded-md bg-accent/10 px-1.5 py-0.5 text-xs font-semibold text-accent"
            >
              {{ t("agentsLocalBadge") }}
            </span>
          </div>
          <AppDropdownMenu :items="menuItems" @select="onSelect">
            <template #trigger>
              <button
                type="button"
                class="inline-flex size-7 shrink-0 items-center justify-center rounded-lg border-0 bg-transparent text-muted-foreground transition duration-200 hover:bg-accent/10 hover:text-accent"
                :aria-label="tf('agentsManageAria', { name: agent.name })"
                :disabled="busy"
              >
                <EllipsisIcon class="size-4" aria-hidden="true" />
              </button>
            </template>
          </AppDropdownMenu>
        </div>
        <p class="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{{ agent.background }}</p>
        <p v-if="updatedLabel" class="mt-1 text-xs text-muted-foreground">
          {{ tf("agentsUpdated", { time: updatedLabel }) }}
        </p>
      </div>

      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-semibold text-white transition duration-200 hover:bg-accent-deep disabled:opacity-50"
          :disabled="busy"
          @click="emit('chat', agent)"
        >
          <MessageSquareIcon class="size-3.5" aria-hidden="true" />
          {{ t("agentsLocalChat") }}
        </button>
      </div>
    </div>

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
  </article>
</template>

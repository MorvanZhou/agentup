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
    class="group flex h-full flex-col gap-1.5 rounded-xl border border-rule bg-paper p-2.5 shadow-sm transition duration-200 ease-out hover:-translate-y-0.5 hover:border-accent/35 hover:shadow-md motion-reduce:transform-none motion-reduce:transition-none"
    :aria-labelledby="`local-agent-${agent.agentId}`"
  >
    <!-- 身份：头像 + 名职 + 菜单 -->
    <div class="flex shrink-0 items-start gap-2.5">
      <AgentAvatar
        class="ring-1 ring-rule ring-offset-1 ring-offset-paper"
        :name="agent.name"
        :avatar-url="agent.avatarUrl"
        size="sidebar"
      />
      <div class="min-w-0 flex-1 pt-0.5">
        <div class="flex min-w-0 items-center gap-1.5">
          <h2
            :id="`local-agent-${agent.agentId}`"
            class="m-0 min-w-0 truncate text-[15px] font-bold leading-snug tracking-tight text-foreground"
            :title="agent.name"
          >
            {{ agent.name }}
          </h2>
          <span
            class="inline-flex shrink-0 items-center rounded-md bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-accent"
          >
            {{ t("agentsLocalBadge") }}
          </span>
        </div>
        <p
          v-if="agent.role"
          class="m-0 mt-1 truncate text-xs font-semibold leading-tight text-accent"
          :title="agent.role"
        >
          {{ agent.role }}
        </p>
        <p v-else class="m-0 mt-1 h-4" aria-hidden="true" />
      </div>
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
    </div>

    <!-- 简介 -->
    <p
      class="m-0 line-clamp-2 min-h-[2.5rem] flex-1 text-xs leading-snug text-muted-foreground"
      :title="agent.background"
    >
      {{ agent.background }}
    </p>

    <!-- 底栏：对话 CTA -->
    <footer class="mt-auto flex shrink-0 items-center justify-end gap-2 pt-0.5">
      <button
        type="button"
        class="inline-flex min-h-7 shrink-0 cursor-pointer items-center gap-1 rounded-lg bg-accent px-2.5 text-xs font-semibold text-white transition duration-200 hover:bg-accent-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-45"
        :disabled="busy"
        @click="emit('chat', agent)"
      >
        <MessageSquareIcon class="size-3.5 shrink-0" aria-hidden="true" />
        {{ t("agentsLocalChat") }}
      </button>
    </footer>

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

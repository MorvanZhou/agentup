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

import AgentAvatar from "../../../../shared/components/avatar/AgentAvatar.vue";
import AppDialog from "../../../../shared/components/AppDialog.vue";
import AppDropdownMenu, { type AppDropdownItem } from "../../../../shared/components/AppDropdownMenu.vue";
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
</script>

<template>
  <article
    class="group relative flex h-full w-full flex-col gap-1.5 rounded-xl border border-rule bg-paper p-2.5 text-left shadow-sm transition duration-200 ease-out hover:-translate-y-0.5 hover:border-accent/35 hover:shadow-md motion-reduce:transform-none motion-reduce:transition-none"
    :aria-labelledby="`local-agent-${agent.agentId}`"
  >
    <!-- 点卡片空白处看资料；菜单和对话盖在上层 -->
    <button
      type="button"
      class="absolute inset-0 z-10 cursor-pointer rounded-xl border-0 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
      :aria-label="tf('agentsViewProfile', { name: agent.name })"
      @click="profileOpen = true"
    />
    <!-- 身份：头像 + 名职 + 菜单 -->
    <div class="flex shrink-0 items-start gap-2.5">
      <AgentAvatar
        class="ring-1 ring-rule ring-offset-1 ring-offset-paper"
        :name="agent.name"
        :avatar-url="agent.avatarUrl"
        size="sidebar"
      />
      <div class="min-w-0 flex-1 pt-0.5">
        <h2
          :id="`local-agent-${agent.agentId}`"
          class="m-0 truncate text-[15px] font-bold leading-snug tracking-tight text-foreground"
          :title="agent.name"
        >
          {{ agent.name }}
        </h2>
        <p
          v-if="agent.role"
          class="m-0 mt-1 truncate text-xs font-semibold leading-tight text-accent"
          :title="agent.role"
        >
          {{ agent.role }}
        </p>
        <p v-else class="m-0 mt-1 h-4" aria-hidden="true" />
      </div>
      <div class="relative z-20">
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
    </div>

    <!-- 简介 -->
    <p
      class="m-0 line-clamp-2 min-h-[2.5rem] flex-1 text-xs leading-snug text-muted-foreground"
      :title="agent.background"
    >
      {{ agent.background }}
    </p>

    <!-- 底栏：去对话，位置与已发布卡片的次数一致 -->
    <footer class="mt-auto flex shrink-0 items-center gap-2 pt-0.5">
      <button
        type="button"
        class="relative z-20 inline-flex min-w-0 flex-1 cursor-pointer items-center gap-1 truncate border-0 bg-transparent p-0 text-left text-[11px] font-medium text-muted-foreground transition duration-200 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-45"
        :disabled="busy"
        @click="emit('chat', agent)"
      >
        <MessageSquareIcon class="size-3 shrink-0 opacity-70" aria-hidden="true" />
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
    <AgentProfileDialog :open="profileOpen" :agent="agent" @update:open="profileOpen = $event" />
  </article>
</template>

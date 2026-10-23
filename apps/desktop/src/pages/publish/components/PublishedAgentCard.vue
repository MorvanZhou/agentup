<script setup lang="ts">
import { CheckIcon, CopyIcon, EllipsisIcon, PencilIcon, Trash2Icon, UsersIcon } from "@lucide/vue";
import { computed, ref, watch } from "vue";

import AgentAvatar from "../../../shared/components/AgentAvatar.vue";
import AppDialog from "../../../shared/components/AppDialog.vue";
import AppDropdownMenu, { type AppDropdownItem } from "../../../shared/components/AppDropdownMenu.vue";
import type { AgentCard } from "../../../shared/model/runtime";
import { t, tf } from "../../../shared/model/ui-locale";

const props = defineProps<{ agent: AgentCard; busy?: boolean }>();
const emit = defineEmits<{ update: [agentId: string]; remove: [agentId: string] }>();

const confirmDelete = ref(false);
const confirmName = ref("");
const nameCopied = ref(false);
let copyTimer: ReturnType<typeof setTimeout> | undefined;

const nameMatches = computed(() => confirmName.value === props.agent.name);

const menuItems = computed((): AppDropdownItem[] => [
  {
    id: "update",
    label: t("publishUpdate"),
    icon: PencilIcon,
    disabled: props.busy,
  },
  {
    id: "remove",
    label: t("publishDelete"),
    icon: Trash2Icon,
    disabled: props.busy,
    danger: true,
  },
]);

watch(confirmDelete, (open) => {
  if (!open) {
    confirmName.value = "";
    nameCopied.value = false;
    if (copyTimer) clearTimeout(copyTimer);
  }
});

function onSelect(id: string): void {
  if (id === "update") {
    emit("update", props.agent.agentId);
    return;
  }
  if (id === "remove") confirmDelete.value = true;
}

async function copyAgentName(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.agent.name);
    nameCopied.value = true;
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      nameCopied.value = false;
    }, 1500);
  } catch {
    /* 剪贴板不可用时仍可手输 */
  }
}

function confirmDeleteAction(): void {
  if (!nameMatches.value || props.busy) return;
  confirmDelete.value = false;
  emit("remove", props.agent.agentId);
}
</script>

<template>
  <article
    class="group flex h-full w-full flex-col gap-1.5 rounded-xl border border-rule bg-paper p-2.5 text-left shadow-sm transition duration-200 ease-out hover:-translate-y-0.5 hover:border-accent/35 hover:shadow-md motion-reduce:transform-none motion-reduce:transition-none"
    :aria-labelledby="`owned-card-${agent.agentId}`"
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
        <h2
          :id="`owned-card-${agent.agentId}`"
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

    <!-- 底栏：招募次数 -->
    <footer class="mt-auto flex shrink-0 items-center gap-2 pt-0.5">
      <span
        class="inline-flex min-w-0 flex-1 items-center gap-1 truncate text-[11px] tabular-nums text-muted-foreground"
        :aria-label="tf('agentsRecruitCount', { n: agent.recruitCount })"
      >
        <UsersIcon class="size-3 shrink-0 opacity-70" aria-hidden="true" />
        {{ tf("agentsRecruitCount", { n: agent.recruitCount }) }}
      </span>
    </footer>

    <AppDialog
      :open="confirmDelete"
      :title="t('publishDeleteTitle')"
      :description="tf('publishDeleteDesc', { name: agent.name })"
      @update:open="confirmDelete = $event"
    >
      <div class="flex flex-col gap-3 py-1">
        <div class="flex min-w-0 items-center gap-2">
          <code
            class="min-w-0 flex-1 truncate rounded-lg border border-rule bg-background px-2.5 py-1.5 text-sm font-semibold text-foreground"
            :title="agent.name"
          >{{ agent.name }}</code>
          <button
            type="button"
            class="inline-flex min-h-8 shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-rule bg-paper px-2.5 text-xs font-medium text-foreground transition duration-200 hover:bg-paper-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            :aria-label="t('publishDeleteCopyName')"
            @click="copyAgentName"
          >
            <CheckIcon v-if="nameCopied" class="size-3.5 text-accent" aria-hidden="true" />
            <CopyIcon v-else class="size-3.5 text-muted-foreground" aria-hidden="true" />
            {{ nameCopied ? t("publishDeleteCopied") : t("publishDeleteCopyName") }}
          </button>
        </div>
        <label class="flex flex-col gap-1.5">
          <span class="text-xs font-medium text-muted-foreground">{{ t("publishDeleteConfirmLabel") }}</span>
          <input
            v-model="confirmName"
            type="text"
            autocomplete="off"
            spellcheck="false"
            :placeholder="t('publishDeleteConfirmPlaceholder')"
            class="min-h-8 w-full rounded-lg border border-rule bg-paper px-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-accent focus:ring-2 focus:ring-accent/15"
          />
        </label>
      </div>
      <template #footer>
        <button
          type="button"
          class="inline-flex min-h-8 cursor-pointer items-center rounded-lg border border-rule bg-paper px-3 text-sm font-medium text-foreground transition duration-200 hover:bg-paper-deep"
          @click="confirmDelete = false"
        >
          {{ t("cancel") }}
        </button>
        <button
          type="button"
          class="inline-flex min-h-8 cursor-pointer items-center rounded-lg bg-destructive px-3 text-sm font-semibold text-white transition duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
          :disabled="!nameMatches || busy"
          @click="confirmDeleteAction"
        >
          {{ t("publishDelete") }}
        </button>
      </template>
    </AppDialog>
  </article>
</template>

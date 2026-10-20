<script setup lang="ts">
import { EllipsisIcon, FolderOpenIcon, UserMinusIcon, UserPlusIcon } from "@lucide/vue";
import { computed, ref } from "vue";

import AgentAvatar from "../../../shared/components/AgentAvatar.vue";
import AppDialog from "../../../shared/components/AppDialog.vue";
import AppDropdownMenu, { type AppDropdownItem } from "../../../shared/components/AppDropdownMenu.vue";
import type { AgentCard } from "../../../shared/model/runtime";
import { formatAgentTime } from "../../../shared/model/time";
import { t, tf } from "../../../shared/model/ui-locale";

const props = defineProps<{ agent: AgentCard; busy: boolean }>();
const emit = defineEmits<{ recruit: [agentId: string]; open: [agentId: string]; dismiss: [agentId: string] }>();

const confirmDismiss = ref(false);

const updatedLabel = computed(() => formatAgentTime(props.agent.updatedAt));

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
  <article
    class="group flex gap-3.5 rounded-xl border border-rule bg-paper p-3.5 shadow-sm transition duration-200 ease-out hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-md motion-reduce:transform-none motion-reduce:transition-none"
    :aria-labelledby="`agent-card-${agent.agentId}`"
  >
    <!-- 市场卡片 -->
    <AgentAvatar :name="agent.name" :avatar-url="agent.avatarUrl" size="xl" />

    <div class="flex min-w-0 flex-1 flex-col gap-2.5">
      <!-- 身份与简介 -->
      <div class="min-w-0">
        <div class="flex items-start justify-between gap-3">
          <div class="flex min-w-0 items-center gap-1.5">
            <h2
              :id="`agent-card-${agent.agentId}`"
              class="m-0 min-w-0 truncate text-sm font-semibold tracking-tight text-foreground"
              :title="agent.name"
            >
              {{ agent.name }}
            </h2>
            <span
              v-if="agent.role"
              class="shrink-0 truncate text-xs font-normal text-muted-foreground"
            >
              {{ agent.role }}
            </span>
            <span
              v-if="agent.recruited"
              class="inline-flex shrink-0 items-center rounded-md bg-success-soft px-1.5 py-0.5 text-xs font-semibold text-success-foreground"
              :aria-label="t('agentsRecruited')"
            >
              {{ t("agentsRecruited") }}
            </span>
          </div>
          <AppDropdownMenu v-if="agent.recruited" :items="menuItems" @select="onSelect">
            <template #trigger>
              <button
                type="button"
                :disabled="busy"
                class="grid size-8 shrink-0 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-muted-foreground outline-none transition duration-200 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-45"
                :aria-label="tf('agentsManageAria', { name: agent.name })"
              >
                <EllipsisIcon class="size-4" aria-hidden="true" />
              </button>
            </template>
          </AppDropdownMenu>
          <button
            v-else
            type="button"
            :disabled="busy"
            class="inline-flex min-h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-semibold text-white transition duration-200 hover:bg-accent-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-45"
            :aria-label="tf('agentsRecruitAria', { name: agent.name })"
            @click="$emit('recruit', agent.agentId)"
          >
            <UserPlusIcon class="size-3.5 shrink-0" aria-hidden="true" />
            {{ busy ? t("agentsRecruiting") : t("agentsRecruit") }}
          </button>
        </div>
        <p class="m-0 mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
          {{ agent.summary }}
        </p>
      </div>

      <!-- 标识与市场信号 -->
      <div class="flex flex-col gap-1 border-t border-rule pt-2.5 text-xs text-muted-foreground">
        <p
          class="m-0 truncate font-mono tabular-nums"
          :title="`${agent.agentId} · v${agent.latestVersion}`"
        >
          <span>{{ agent.agentId }}</span>
          <span aria-hidden="true"> · </span>
          <span :aria-label="tf('agentsVersion', { n: agent.latestVersion })">v{{ agent.latestVersion }}</span>
        </p>
        <p class="m-0 flex flex-wrap gap-x-3 gap-y-0.5 tabular-nums">
          <span v-if="updatedLabel" :aria-label="tf('agentsUpdated', { time: updatedLabel })">
            {{ tf("agentsUpdated", { time: updatedLabel }) }}
          </span>
          <span :aria-label="tf('agentsRecruitCount', { n: agent.recruitCount })">
            {{ tf("agentsRecruitCount", { n: agent.recruitCount }) }}
          </span>
        </p>
      </div>
    </div>

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
  </article>
</template>

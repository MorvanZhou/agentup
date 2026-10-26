<script setup lang="ts">
import { EllipsisIcon, FolderOpenIcon, UserMinusIcon, UserPlusIcon, UsersIcon } from "@lucide/vue";
import { computed, ref } from "vue";

import AgentAvatar from "../../../../shared/components/avatar/AgentAvatar.vue";
import AppDialog from "../../../../shared/components/AppDialog.vue";
import AppDropdownMenu, { type AppDropdownItem } from "../../../../shared/components/AppDropdownMenu.vue";
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
const emit = defineEmits<{ recruit: [agentId: string]; open: [agentId: string]; dismiss: [agentId: string] }>();

const confirmDismiss = ref(false);
const profileOpen = ref(false);

const showManageMenu = computed(() => props.surface === "manage" && props.agent.recruited);
const showRecruit = computed(() => props.surface === "market" && !props.agent.recruited);
const showRecruited = computed(() => props.surface === "market" && props.agent.recruited);

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
    class="group relative flex h-full flex-col gap-1.5 rounded-xl border border-rule bg-paper p-2.5 shadow-sm transition duration-200 ease-out hover:-translate-y-0.5 hover:border-accent/35 hover:shadow-md motion-reduce:transform-none motion-reduce:transition-none"
    :aria-labelledby="`agent-card-${agent.agentId}`"
  >
    <!-- 点卡片空白处看资料；菜单和招募盖在上层 -->
    <button
      type="button"
      class="absolute inset-0 z-10 cursor-pointer rounded-xl border-0 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
      :aria-label="tf('agentsViewProfile', { name: agent.name })"
      @click="profileOpen = true"
    />
    <!-- 身份：放大头像 + 名职，作为卡片主视觉 -->
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
            :id="`agent-card-${agent.agentId}`"
            class="m-0 min-w-0 truncate text-[15px] font-bold leading-snug tracking-tight text-foreground"
            :title="agent.name"
          >
            {{ agent.name }}
          </h2>
          <span
            v-if="showRecruited"
            class="inline-flex shrink-0 items-center rounded-md bg-success-soft px-1.5 py-0.5 text-[10px] font-semibold leading-none text-success-foreground"
            :aria-label="t('agentsRecruited')"
          >
            {{ t("agentsRecruited") }}
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
      <div v-if="showManageMenu" class="relative z-20">
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
      </div>
    </div>

    <!-- 简介：固定两行高度，避免短文案导致卡高不一致 -->
    <p
      class="m-0 line-clamp-2 min-h-[2.5rem] flex-1 text-xs leading-snug text-muted-foreground"
      :title="agent.background"
    >
      {{ agent.background }}
    </p>

    <!-- 底栏：次数 + 招募 CTA，贴齐卡片底部 -->
    <footer class="mt-auto flex shrink-0 items-center gap-2 pt-0.5">
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
        class="relative z-20 inline-flex min-h-7 shrink-0 cursor-pointer items-center gap-1 rounded-lg bg-accent px-2.5 text-xs font-semibold text-white transition duration-200 hover:bg-accent-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-45"
        :aria-label="tf('agentsRecruitAria', { name: agent.name })"
        @click="$emit('recruit', agent.agentId)"
      >
        <UserPlusIcon class="size-3.5 shrink-0" aria-hidden="true" />
        {{ busy ? t("agentsRecruiting") : t("agentsRecruit") }}
      </button>
    </footer>

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
    <AgentProfileDialog :open="profileOpen" :agent="agent" @update:open="profileOpen = $event" />
  </article>
</template>

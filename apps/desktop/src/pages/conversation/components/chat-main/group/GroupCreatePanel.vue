<script setup lang="ts">
import { CheckIcon, SearchIcon, UsersIcon } from "@lucide/vue";
import { computed, ref } from "vue";

import type { AgentCard } from "../../../../../shared/model/runtime/runtime";
import AgentAvatar from "../../../../../shared/components/avatar/AgentAvatar.vue";
import { t, tf } from "../../../../../shared/model/ui/ui-locale";
import { GROUP_MEMBER_MAX, GROUP_MEMBER_MIN } from "../../../model/group/group-limits";

const props = defineProps<{
  title: string;
  agents: AgentCard[];
  picked: string[];
  busy?: boolean;
}>();

const emit = defineEmits<{
  "update:title": [value: string];
  toggle: [agentId: string];
  submit: [];
}>();

const query = ref("");
const searching = computed(() => Boolean(query.value.trim()));

const filteredAgents = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return props.agents;
  return props.agents.filter((agent) => agentSearchText(agent).includes(q));
});

const pickedCount = computed(() => props.picked.length);
const canSubmit = computed(
  () =>
    pickedCount.value >= GROUP_MEMBER_MIN &&
    pickedCount.value <= GROUP_MEMBER_MAX &&
    !props.busy,
);

function agentSearchText(agent: AgentCard): string {
  return `${agent.remark}\n${agent.name}\n${agent.role}\n${agent.background}\n${agent.agentId}`.toLowerCase();
}

function agentLabel(agent: AgentCard): string {
  return (agent.remark || agent.name || agent.agentId).trim() || agent.agentId;
}

function isPicked(agentId: string): boolean {
  return props.picked.includes(agentId);
}

function atCap(agentId: string): boolean {
  return !isPicked(agentId) && pickedCount.value >= GROUP_MEMBER_MAX;
}
</script>

<template>
  <!-- 建群主区：占满右侧空白，表单居中 -->
  <section class="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-background">
    <div class="mx-auto flex w-full max-w-xl flex-1 flex-col px-5 py-8 sm:px-8 sm:py-10">
      <header class="mb-8">
        <div
          class="mb-4 grid size-11 place-items-center rounded-xl border border-rule bg-paper text-accent"
          aria-hidden="true"
        >
          <UsersIcon class="size-5" />
        </div>
        <h1 class="m-0 mt-1.5 text-2xl font-semibold tracking-tight text-foreground">
          {{ t("groupCreateHeading") }}
        </h1>
        <p class="m-0 mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
          {{ tf("groupLead", { min: GROUP_MEMBER_MIN, max: GROUP_MEMBER_MAX }) }}
        </p>
      </header>

      <form class="flex flex-1 flex-col gap-6" @submit.prevent="emit('submit')">
        <label class="block">
          <span class="text-xs font-medium text-foreground">{{ t("groupTitleField") }}</span>
          <input
            :value="title"
            type="text"
            :placeholder="t('groupTitlePlaceholder')"
            class="mt-1.5 min-h-9 w-full rounded-lg border border-rule bg-paper px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-accent focus:ring-2 focus:ring-accent/15"
            @input="emit('update:title', ($event.target as HTMLInputElement).value)"
          />
        </label>

        <fieldset class="m-0 min-h-0 border-0 p-0">
          <legend class="mb-2 flex w-full items-baseline justify-between gap-3 p-0">
            <span class="text-xs font-medium text-foreground">{{ t("groupMembersField") }}</span>
            <span
              class="text-xs tabular-nums"
              :class="
                pickedCount >= GROUP_MEMBER_MIN && pickedCount <= GROUP_MEMBER_MAX
                  ? 'text-accent'
                  : 'text-muted-foreground'
              "
            >
              {{ tf("groupMembersPicked", { n: pickedCount, max: GROUP_MEMBER_MAX }) }}
            </span>
          </legend>

          <p v-if="agents.length === 0" class="m-0 rounded-xl border border-dashed border-rule bg-paper px-4 py-8 text-center text-sm text-muted-foreground">
            {{ t("groupNoAgents") }}
          </p>

          <div v-else class="flex flex-col gap-2">
            <label class="relative block">
              <span class="sr-only">{{ t("groupMembersSearch") }}</span>
              <SearchIcon
                class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <input
                v-model="query"
                type="search"
                :placeholder="t('groupMembersSearchPlaceholder')"
                class="min-h-9 w-full rounded-lg border border-rule bg-paper py-1.5 pr-3 pl-8 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-accent focus:ring-2 focus:ring-accent/15"
              />
            </label>

            <p
              v-if="filteredAgents.length === 0"
              class="m-0 rounded-xl border border-dashed border-rule bg-paper px-4 py-8 text-center text-sm text-muted-foreground"
            >
              {{ searching ? t("groupMembersNoMatch") : t("groupNoAgents") }}
            </p>

            <div v-else class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                v-for="agent in filteredAgents"
                :key="agent.agentId"
                type="button"
                class="group flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-40"
                :class="
                  isPicked(agent.agentId)
                    ? 'border-accent bg-accent/10'
                    : 'border-rule bg-paper hover:border-accent/40 hover:bg-muted/60'
                "
                :aria-pressed="isPicked(agent.agentId)"
                :disabled="atCap(agent.agentId)"
                @click="emit('toggle', agent.agentId)"
              >
                <AgentAvatar
                  :name="agentLabel(agent)"
                  :avatar-url="agent.avatarUrl"
                  size="sm"
                  round
                />
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-medium text-foreground">
                    {{ agentLabel(agent) }}
                  </span>
                  <span
                    v-if="agent.role.trim()"
                    class="mt-0.5 block truncate text-xs text-muted-foreground"
                  >
                    {{ agent.role }}
                  </span>
                </span>
                <span
                  class="grid size-5 shrink-0 place-items-center rounded-md border transition duration-150"
                  :class="
                    isPicked(agent.agentId)
                      ? 'border-accent bg-accent text-white'
                      : 'border-rule bg-background text-transparent'
                  "
                  aria-hidden="true"
                >
                  <CheckIcon class="size-3" />
                </span>
              </button>
            </div>
          </div>
        </fieldset>

        <div class="mt-auto flex items-center gap-3 border-t border-rule pt-5">
          <button
            type="submit"
            class="inline-flex min-h-9 flex-1 cursor-pointer items-center justify-center rounded-lg bg-accent px-4 text-sm font-semibold text-white transition duration-150 hover:bg-accent-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="!canSubmit"
          >
            {{ t("groupCreate") }}
          </button>
        </div>
      </form>
    </div>
  </section>
</template>

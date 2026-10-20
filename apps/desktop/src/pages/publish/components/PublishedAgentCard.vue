<script setup lang="ts">
import { ChevronRightIcon } from "@lucide/vue";
import { computed } from "vue";

import AgentAvatar from "../../../shared/components/AgentAvatar.vue";
import type { AgentCard } from "../../../shared/model/runtime";
import { formatAgentTime } from "../../../shared/model/time";
import { t, tf } from "../../../shared/model/ui-locale";

const props = defineProps<{ agent: AgentCard }>();

const createdLabel = computed(() => formatAgentTime(props.agent.createdAt));
const updatedLabel = computed(() => formatAgentTime(props.agent.updatedAt));
</script>

<template>
  <article
    class="group flex h-full gap-3.5 rounded-xl border border-rule bg-paper p-3.5 text-left shadow-sm transition duration-200 ease-out group-hover:-translate-y-0.5 group-hover:border-accent/40 group-hover:shadow-md motion-reduce:transform-none motion-reduce:transition-none"
    :aria-labelledby="`owned-card-${agent.agentId}`"
  >
    <!-- 已发布卡片 -->
    <AgentAvatar :name="agent.name" :avatar-url="agent.avatarUrl" size="xl" />

    <div class="flex min-w-0 flex-1 flex-col gap-2.5">
      <!-- 身份与简介 -->
      <div class="min-w-0 flex-1">
        <div class="flex items-start justify-between gap-3">
          <h2
            :id="`owned-card-${agent.agentId}`"
            class="m-0 min-w-0 truncate text-sm font-semibold tracking-tight text-foreground"
            :title="agent.name"
          >
            {{ agent.name }}
          </h2>
          <span
            class="inline-flex shrink-0 items-center gap-0.5 text-xs font-semibold text-accent transition duration-200 group-hover:text-accent-deep"
          >
            {{ t("publishUpdate") }}
            <ChevronRightIcon class="size-3.5 shrink-0" aria-hidden="true" />
          </span>
        </div>
        <p
          class="m-0 mt-1.5 line-clamp-2 min-h-[calc(1.625em*2)] text-sm leading-relaxed text-muted-foreground"
          :title="agent.summary"
        >
          {{ agent.summary }}
        </p>
      </div>

      <!-- 标识与时间 -->
      <div class="mt-auto flex flex-col gap-1 border-t border-rule pt-2.5 text-xs text-muted-foreground">
        <p
          class="m-0 truncate font-mono tabular-nums"
          :title="`${agent.agentId} · v${agent.latestVersion}`"
        >
          <span>{{ agent.agentId }}</span>
          <span aria-hidden="true"> · </span>
          <span :aria-label="tf('agentsVersion', { n: agent.latestVersion })">v{{ agent.latestVersion }}</span>
          <span aria-hidden="true"> · </span>
          <span :aria-label="tf('agentsRecruitCount', { n: agent.recruitCount })">{{ tf("agentsRecruitCount", { n: agent.recruitCount }) }}</span>
        </p>
        <p class="m-0 flex flex-wrap gap-x-3 gap-y-0.5 tabular-nums">
          <span v-if="createdLabel" :aria-label="tf('publishCreated', { time: createdLabel })">{{ tf("publishCreated", { time: createdLabel }) }}</span>
          <span v-if="updatedLabel" :aria-label="tf('publishUpdated', { time: updatedLabel })">{{ tf("publishUpdated", { time: updatedLabel }) }}</span>
        </p>
      </div>
    </div>
  </article>
</template>

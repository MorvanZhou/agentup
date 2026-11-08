<script setup lang="ts">
import AgentAvatar from "../avatar/AgentAvatar.vue";
import type { AgentCard } from "../../model/runtime/runtime";
import { tf } from "../../model/ui/ui-locale";
import { agentDisplayName } from "./agent-profile";

const props = defineProps<{
  agent: AgentCard;
  /** 标题用 id，避免同页多卡撞 id */
  titleId: string;
}>();

const emit = defineEmits<{ "view-profile": [] }>();

const displayName = () => agentDisplayName(props.agent);
</script>

<template>
  <!-- 共享目录卡：头像 / 名职 / 背景；点空白开资料；trailing·footer 盖在上层 -->
  <article
    class="group relative flex h-full w-full flex-col gap-1.5 rounded-xl border border-rule bg-paper p-2.5 text-left shadow-sm transition duration-200 ease-out hover:-translate-y-0.5 hover:border-foreground/12 hover:shadow-md motion-reduce:transform-none motion-reduce:transition-none"
    :aria-labelledby="titleId"
  >
    <button
      type="button"
      class="absolute inset-0 z-10 cursor-pointer rounded-xl border-0 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
      :aria-label="tf('agentsViewProfile', { name: displayName() })"
      @click="emit('view-profile')"
    />
    <!-- 身份行 -->
    <div class="flex shrink-0 items-start gap-2.5">
      <AgentAvatar
        class="ring-1 ring-rule ring-offset-1 ring-offset-paper"
        :name="displayName()"
        :avatar-url="agent.avatarUrl"
        size="sidebar"
      />
      <div class="min-w-0 flex-1 pt-0.5">
        <div class="flex min-w-0 items-center gap-1.5">
          <h2
            :id="titleId"
            class="m-0 min-w-0 truncate text-[15px] font-bold leading-snug tracking-tight text-foreground"
            :title="displayName()"
          >
            {{ displayName() }}
          </h2>
          <slot name="badge" />
        </div>
        <p
          v-if="agent.role"
          class="m-0 mt-1 truncate text-xs font-semibold leading-tight text-muted-foreground"
          :title="agent.role"
        >
          {{ agent.role }}
        </p>
        <p v-else class="m-0 mt-1 h-4" aria-hidden="true" />
      </div>
      <div v-if="$slots.trailing" class="relative z-20 shrink-0">
        <slot name="trailing" />
      </div>
    </div>

    <!-- 简介：固定两行 -->
    <p
      class="m-0 line-clamp-2 min-h-[2.1rem] flex-1 text-xs leading-snug text-muted-foreground"
      :title="agent.background"
    >
      {{ agent.background }}
    </p>

    <footer v-if="$slots.footer" class="relative z-20 mt-auto flex shrink-0 items-center gap-2 pt-0.5">
      <slot name="footer" />
    </footer>
  </article>
</template>

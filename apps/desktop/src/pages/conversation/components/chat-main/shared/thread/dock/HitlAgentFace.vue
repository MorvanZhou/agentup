<script setup lang="ts">
import { BotIcon } from "@lucide/vue";
import { computed, inject } from "vue";

import { stubAgentCard } from "../../../../../../../shared/components/agent/agent-profile";
import { agentProfileHostKey } from "../../../../../../../shared/components/agent/agent-profile-host";
import { tf } from "../../../../../../../shared/model/ui/ui-locale";
import { injectThreadRoster, resolveRosterAgent } from "../../../../../model/thread/thread-roster";

const props = defineProps<{
  name?: string;
  agentId?: string;
}>();

const roster = injectThreadRoster();
const profileHost = inject(agentProfileHostKey, null);
const canOpenProfile = computed(() => Boolean(profileHost && props.agentId?.trim()));

function openAgentProfile(): void {
  const id = props.agentId?.trim();
  if (!profileHost || !id) return;
  const name = props.name?.trim() || id;
  const agent = resolveRosterAgent(roster.value, id, name);
  profileHost.open({
    agent: stubAgentCard({
      agentId: id,
      name: agent.name || name,
      role: agent.role,
      remark: agent.remark,
      avatarUrl: agent.avatarUrl,
      kind: "recruited",
      recruited: agent.available,
    }),
  });
}
</script>

<template>
  <!-- HITL 询问方：无底纯图标；有 agentId 时可开资料 -->
  <button
    v-if="name && canOpenProfile"
    type="button"
    class="inline-flex size-4 shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-muted-foreground outline-none transition duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40"
    :aria-label="tf('agentsViewProfile', { name })"
    @click="openAgentProfile"
  >
    <BotIcon class="size-4" aria-hidden="true" />
  </button>
  <BotIcon
    v-else-if="name"
    class="size-4 shrink-0 text-muted-foreground"
    aria-hidden="true"
  />
</template>

<script setup lang="ts">
import { computed, inject } from "vue";

import { stubAgentCard } from "../../../../../../../shared/components/agent/agent-profile";
import { agentProfileHostKey } from "../../../../../../../shared/components/agent/agent-profile-host";
import AgentAvatar from "../../../../../../../shared/components/avatar/AgentAvatar.vue";
import { tf } from "../../../../../../../shared/model/ui/ui-locale";
import { injectThreadRoster, resolveRosterAgent } from "../../../../../model/thread/thread-roster";

const props = defineProps<{
  name?: string;
  agentId?: string;
}>();

const roster = injectThreadRoster();
const profileHost = inject(agentProfileHostKey, null);
const avatarUrl = computed(() => {
  const id = props.agentId?.trim();
  const name = props.name?.trim();
  if (!id || !name) return undefined;
  return resolveRosterAgent(roster.value, id, name).avatarUrl;
});
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
  <!-- HITL 询问方头像：有 agentId 时可开资料 -->
  <button
    v-if="name && canOpenProfile"
    type="button"
    class="shrink-0 cursor-pointer rounded-full border-0 bg-transparent p-0 outline-none transition duration-150 hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent/40"
    :aria-label="tf('agentsViewProfile', { name })"
    @click="openAgentProfile"
  >
    <AgentAvatar :name="name" :avatar-url="avatarUrl" size="sm" round />
  </button>
  <AgentAvatar v-else-if="name" :name="name" :avatar-url="avatarUrl" size="sm" round />
</template>

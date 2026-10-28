<script setup lang="ts">
import { computed } from "vue";

import AgentAvatar from "../../../../../../../shared/components/avatar/AgentAvatar.vue";
import { injectThreadRoster, resolveRosterAgent } from "../../../../../model/thread/thread-roster";

const props = defineProps<{
  name?: string;
  agentId?: string;
}>();

const roster = injectThreadRoster();
const avatarUrl = computed(() => {
  const id = props.agentId?.trim();
  const name = props.name?.trim();
  if (!id || !name) return undefined;
  return resolveRosterAgent(roster.value, id, name).avatarUrl;
});
</script>

<template>
  <AgentAvatar v-if="name" :name="name" :avatar-url="avatarUrl" size="sm" round />
</template>

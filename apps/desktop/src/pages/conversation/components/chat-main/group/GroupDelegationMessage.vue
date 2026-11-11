<script setup lang="ts">
import { useAuiState } from "@assistant-ui/vue";
import type {} from "@assistant-ui/core/store";
import { computed } from "vue";

import { readGroupDelegationCard } from "../../../model/group/group-delegation";
import GroupDelegationBubble from "./GroupDelegationBubble.vue";

const metadata = useAuiState((state) => state.message.metadata);

const card = computed(() => {
  const custom = (metadata.value as { custom?: { delegation?: unknown } } | undefined)?.custom;
  return readGroupDelegationCard(custom?.delegation);
});
</script>

<template>
  <GroupDelegationBubble v-if="card" :card="card" />
</template>

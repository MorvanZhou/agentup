<script setup lang="ts">
import { useAuiState } from "@assistant-ui/vue";
import type {} from "@assistant-ui/core/store";
import { computed, inject } from "vue";

import {
  chatQueueBusyKey,
  chatQueueCancelKey,
} from "../../../model/thread/chat-surface";
import type { GroupUiQueueCard } from "../../../model/group/group-ui-messages";
import GroupQueueCard from "./GroupQueueCard.vue";

const custom = useAuiState((s) => {
  const metadata = s.message.metadata as { custom?: { queue?: GroupUiQueueCard[] } } | undefined;
  return metadata?.custom;
});
const cards = computed(() => custom.value?.queue ?? []);
const cancel = inject(chatQueueCancelKey, undefined);
const busy = inject(chatQueueBusyKey, undefined);
</script>

<template>
  <GroupQueueCard
    v-for="item in cards"
    :key="item.id"
    :label="item.label"
    :busy="Boolean(busy)"
    @cancel="cancel?.(item.id)"
  />
</template>

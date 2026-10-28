<script setup lang="ts">
import { inject } from "vue";

import { groupDelegationCardsKey } from "../../../model/group/group-delegation";
import GroupDelegationBubble from "./GroupDelegationBubble.vue";

const cards = inject(groupDelegationCardsKey, null);
</script>

<template>
  <ol v-if="cards && cards.length > 0" class="mb-4 flex min-w-0 flex-col gap-y-4">
    <GroupDelegationBubble v-for="card in cards" :key="card.id" :card="card" />
  </ol>
</template>

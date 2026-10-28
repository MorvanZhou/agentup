<script setup lang="ts">
import { useAuiState } from "@assistant-ui/vue";
import type {} from "@assistant-ui/core/store";
import { computed } from "vue";

import type { GroupDelegationCard } from "../../../model/group/group-delegation";
import GroupDelegationBubble from "./GroupDelegationBubble.vue";

const metadata = useAuiState((state) => state.message.metadata);

const card = computed<GroupDelegationCard | null>(() => {
  const custom = (metadata.value as { custom?: { delegation?: unknown } } | undefined)?.custom;
  const value = custom?.delegation;
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<GroupDelegationCard>;
  return {
    id: typeof raw.id === "string" ? raw.id : "",
    taskId: typeof raw.taskId === "string" ? raw.taskId : "",
    authorId: typeof raw.authorId === "string" ? raw.authorId : "",
    authorName: typeof raw.authorName === "string" ? raw.authorName : "",
    avatarUrl: typeof raw.avatarUrl === "string" ? raw.avatarUrl : undefined,
    role: typeof raw.role === "string" ? raw.role : undefined,
    brief: typeof raw.brief === "string" ? raw.brief : "",
    summary: typeof raw.summary === "string" ? raw.summary : "",
    activity: raw.activity === "queued" ? "queued" : "running",
    handoff: raw.handoff === "consumed" ? "consumed" : "pending",
    outcome:
      raw.outcome === "completed" || raw.outcome === "failed" || raw.outcome === "cancelled"
        ? raw.outcome
        : undefined,
  };
});
</script>

<template>
  <GroupDelegationBubble v-if="card" :card="card" />
</template>

<script setup lang="ts">
import SingleWorkspacePanel from "../../single/workspace/WorkspacePanel.vue";

withDefaults(defineProps<{
  token: string;
  userId: string;
  agentId: string;
  personal: boolean;
  generation: number;
  group?: boolean;
}>(), { group: false });

const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <SingleWorkspacePanel v-bind="$props" @close="emit('close')" />
</template>

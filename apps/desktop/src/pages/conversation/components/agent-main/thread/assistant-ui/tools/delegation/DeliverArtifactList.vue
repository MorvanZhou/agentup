<script setup lang="ts">
import { computed } from "vue";

import { formatToolErrorMessage } from "../shared/tool-args";
import ToolErrorNotice from "../shared/ToolErrorNotice.vue";

const props = defineProps<{
  paths: string[];
  error?: string;
}>();

const errorMessage = computed(() =>
  props.error?.trim() ? formatToolErrorMessage(props.error) : "",
);
</script>

<template>
  <!-- 本轮确认投递的文件 -->
  <div class="flex min-w-0 flex-col gap-2 px-2.5 py-2">
    <ToolErrorNotice v-if="errorMessage" :message="errorMessage" />
    <ul v-if="paths.length > 0" class="m-0 list-none p-0">
      <li
        v-for="(item, index) in paths"
        :key="`${item}:${index}`"
        class="text-foreground truncate font-mono text-xs"
      >
        {{ item }}
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { useAuiState } from "@assistant-ui/vue";

import MarkdownBody from "../../../../../../../shared/components/preview/MarkdownBody.vue";

const props = withDefaults(
  defineProps<{
    /** 次要信息：更小字号、muted 色（如推理过程） */
    secondary?: boolean;
  }>(),
  { secondary: false },
);

const text = useAuiState((s) =>
  s.part.type === "text" || s.part.type === "reasoning" ? s.part.text : "",
);
</script>

<template>
  <!-- Markdown 正文：渲染体下沉到 shared MarkdownBody -->
  <MarkdownBody :source="text" :secondary="props.secondary" />
</template>

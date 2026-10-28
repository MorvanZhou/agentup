<script setup lang="ts">
import { useAuiState } from "@assistant-ui/vue";
import type {} from "@assistant-ui/core/store";

import ToolCall from "../tools/ToolCall.vue";
import MarkdownText from "./MarkdownText.vue";
import Reasoning from "./Reasoning.vue";

const type = useAuiState((s) => s.part.type);
</script>

<template>
  <!-- 单 part：与 MessagePrimitiveParts 的命名 slot 对齐 -->
  <MarkdownText v-if="type === 'text'" />
  <Reasoning v-else-if="type === 'reasoning'" />
  <ToolCall v-else-if="type === 'tool-call'" />
</template>

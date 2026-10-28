<script setup lang="ts">
import { ListTodoIcon } from "@lucide/vue";

import ToolCard from "../shared/ToolCard.vue";
import { useToolPart } from "../shared/useToolPart";

const { isError } = useToolPart();
</script>

<template>
  <!-- 计划改在输入区上方常驻；只有执行失败时才在消息里露出错误条 -->
  <ToolCard v-if="isError" title="Todo" :icon="ListTodoIcon" />
</template>

<script setup lang="ts">
import { PartByIndexProvider, useAuiState } from "@assistant-ui/vue";
import { computed } from "vue";

import {
  buildAssistantByproducts,
  type ByproductTabId,
} from "../../../../../../model/message/message-byproducts";
import MarkdownText from "../parts/MarkdownText.vue";
import ArtifactsPanel from "./ArtifactsPanel.vue";
import AssistAgentsPanel from "./AssistAgentsPanel.vue";
import AssistantProcessTimeline from "./AssistantProcessTimeline.vue";
import TodoPanel from "./TodoPanel.vue";

const props = withDefaults(
  defineProps<{
    tab: ByproductTabId;
    /** 旁路任务在卡片上仍应展示过程状态。 */
    showProcessStatus?: boolean;
  }>(),
  { showProcessStatus: false },
);

const metadata = useAuiState((state) => state.message.metadata);
const streaming = useAuiState((state) => state.message.status?.type === "running");
const parts = useAuiState((state) => state.message.parts);
// 共享内容：标签归属由外层决定，此处只渲染一个副产物面板。
const byproducts = computed(() =>
  buildAssistantByproducts({
    parts: parts.value,
    metadata: metadata.value,
    streaming: streaming.value,
  }),
);

const hasTab = computed(() => byproducts.value.tabs.some((tab) => tab.id === props.tab));
</script>

<template>
  <!-- 总结内容 -->
  <PartByIndexProvider
    v-if="tab === 'summary' && hasTab && byproducts.summaryPartIndex !== undefined"
    :index="byproducts.summaryPartIndex"
  >
    <MarkdownText />
  </PartByIndexProvider>

  <!-- ARTIFACT 文件差分 -->
  <ArtifactsPanel
    v-else-if="tab === 'artifacts' && hasTab && byproducts.artifacts"
    :artifacts="byproducts.artifacts"
  />

  <!-- 待办清单 -->
  <TodoPanel
    v-else-if="tab === 'todo' && hasTab"
    :items="byproducts.todoItems"
    :default-open="true"
  />

  <!-- Agent 过程时间线 -->
  <AssistantProcessTimeline
    v-else-if="tab === 'process' && hasTab"
    :show-status="showProcessStatus"
  />

  <!-- 下级 Agent 产物 -->
  <AssistAgentsPanel
    v-else-if="tab === 'subagents' && hasTab"
    :assists="byproducts.assists"
    variant="panel"
  />
</template>

<script setup lang="ts">
import { computed } from "vue";
import { PackageOpenIcon } from "@lucide/vue";

import { t, tf } from "../../../../../../../../../shared/model/ui/ui-locale";
import { shortPath } from "../shared/tool-args";
import { useToolPart } from "../shared/useToolPart";
import DeliverArtifactList from "../delegation/DeliverArtifactList.vue";
import ToolCard from "../shared/ToolCard.vue";
import { presentArtifactsView } from "./tool-present-artifacts";

const { args, resultText, hasResult } = useToolPart();

const view = computed(() =>
  presentArtifactsView(args.value, hasResult.value ? resultText.value : ""),
);

const detail = computed(() => {
  if (view.value.error) return "";
  if (view.value.cleared) return t("toolPresentArtifactsCleared");
  if (view.value.paths.length === 1) return shortPath(view.value.paths[0] ?? "");
  if (view.value.paths.length > 1) {
    return tf("toolDeliverCount", { n: view.value.paths.length });
  }
  if (view.value.action) return view.value.action;
  return "";
});

/** 清空只靠 detail「已清空」；有路径或错误才展开正文 */
const expandable = computed(
  () => view.value.paths.length > 0 || Boolean(view.value.error),
);
</script>

<template>
  <!-- 收口交付网格：增删展示哪些 ARTIFACT 文件 -->
  <ToolCard
    :title="t('toolPresentArtifacts')"
    :detail="detail"
    :icon="PackageOpenIcon"
    :expandable="expandable"
  >
    <DeliverArtifactList
      v-if="expandable"
      :paths="view.paths"
      :error="view.error"
    />
  </ToolCard>
</template>

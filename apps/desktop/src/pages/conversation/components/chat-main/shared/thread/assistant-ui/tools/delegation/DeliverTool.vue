<script setup lang="ts">
import { computed } from "vue";
import { PackageCheckIcon } from "@lucide/vue";

import { t, tf } from "../../../../../../../../../shared/model/ui/ui-locale";
import { shortPath } from "../shared/tool-args";
import { deliverArtifactView } from "./tool-deliver";
import { useToolPart } from "../shared/useToolPart";
import DeliverArtifactList from "./DeliverArtifactList.vue";
import ToolCard from "../shared/ToolCard.vue";

const { args, resultText, hasResult } = useToolPart();

const view = computed(() =>
  deliverArtifactView(args.value, hasResult.value ? resultText.value : ""),
);
const detail = computed(() => {
  if (view.value.empty) return t("toolDeliverNone");
  if (view.value.paths.length === 1) return shortPath(view.value.paths[0] ?? "");
  if (view.value.paths.length > 1) return tf("toolDeliverCount", { n: view.value.paths.length });
  return "";
});
const expandable = computed(() => view.value.paths.length > 0 || Boolean(view.value.error));
</script>

<template>
  <!-- 委托投递：确认要交给上游的 ARTIFACT 文件 -->
  <ToolCard
    title="Deliver"
    :detail="detail"
    :icon="PackageCheckIcon"
    :expandable="expandable"
  >
    <DeliverArtifactList
      v-if="expandable"
      :paths="view.paths"
      :error="view.error"
    />
  </ToolCard>
</template>

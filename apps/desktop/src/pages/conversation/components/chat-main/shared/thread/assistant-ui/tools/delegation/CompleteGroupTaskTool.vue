<script setup lang="ts">
import { computed } from "vue";
import { CircleCheckBigIcon } from "@lucide/vue";

import { t, tf } from "../../../../../../../../../shared/model/ui/ui-locale";
import { shortPath } from "../shared/tool-args";
import { completeGroupTaskView } from "./tool-deliver";
import { useToolPart } from "../shared/useToolPart";
import DeliverArtifactList from "./DeliverArtifactList.vue";
import ToolCard from "../shared/ToolCard.vue";

const { args, resultText, hasResult } = useToolPart();

const view = computed(() =>
  completeGroupTaskView(args.value, hasResult.value ? resultText.value : ""),
);

const detail = computed(() => {
  const parts: string[] = [];
  if (view.value.empty) parts.push(t("toolCompleteGroupNone"));
  else if (view.value.paths.length === 1) parts.push(shortPath(view.value.paths[0] ?? ""));
  else if (view.value.paths.length > 1) {
    parts.push(tf("toolDeliverCount", { n: view.value.paths.length }));
  }
  if (view.value.nextStep) {
    const step =
      view.value.nextStep.length > 36
        ? `${view.value.nextStep.slice(0, 35)}…`
        : view.value.nextStep;
    parts.push(step);
  }
  return parts.join(" · ");
});

const expandable = computed(
  () =>
    view.value.paths.length > 0 ||
    Boolean(view.value.nextStep) ||
    Boolean(view.value.error) ||
    view.value.empty,
);
</script>

<template>
  <!-- 群委托收尾：确认共享文件 + 下一步 -->
  <ToolCard
    :title="t('toolCompleteGroupTask')"
    :detail="detail"
    :icon="CircleCheckBigIcon"
    :expandable="expandable"
  >
    <div v-if="expandable" class="flex min-w-0 flex-col">
      <DeliverArtifactList :paths="view.paths" :error="view.error" />
      <div
        v-if="view.nextStep || view.empty"
        class="border-border/60 min-w-0 border-t px-2.5 py-2"
      >
        <p class="text-muted-foreground mb-1 text-xs font-medium">
          {{ t("toolCompleteGroupNext") }}
        </p>
        <p
          class="text-foreground text-xs whitespace-pre-wrap break-words"
          :class="view.nextStep ? undefined : 'text-muted-foreground'"
        >
          {{ view.nextStep || t("toolCompleteGroupNextNone") }}
        </p>
      </div>
    </div>
  </ToolCard>
</template>

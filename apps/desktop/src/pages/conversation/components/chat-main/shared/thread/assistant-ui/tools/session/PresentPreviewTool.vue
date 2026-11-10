<script setup lang="ts">
import { computed } from "vue";
import { AppWindowIcon } from "@lucide/vue";

import { t } from "../../../../../../../../../shared/model/ui/ui-locale";
import { argString, mergeToolArgs } from "../shared/tool-args";
import { useToolPart } from "../shared/useToolPart";
import ToolCard from "../shared/ToolCard.vue";

const {
  args,
  argsText,
  isError,
  isInterrupted,
  resultText,
  hasResult,
  isActive,
} = useToolPart();

/** 流式时半解析 title / preview_url / command。 */
const mergedArgs = computed(() => mergeToolArgs(args.value, argsText.value));

const recipeTitle = computed(() => argString(mergedArgs.value, "title").trim());
const previewUrl = computed(() => argString(mergedArgs.value, "preview_url").trim());
const command = computed(() => argString(mergedArgs.value, "command").replace(/\s+/g, " ").trim());
const cwd = computed(() => argString(mergedArgs.value, "cwd").trim() || ".");
const recipeId = computed(() => argString(mergedArgs.value, "id").trim());
const linkedJobId = computed(() => argString(mergedArgs.value, "linked_job_id").trim());

const detail = computed(() => {
  if (recipeTitle.value && previewUrl.value) {
    return `${recipeTitle.value} · ${previewUrl.value}`;
  }
  return recipeTitle.value || previewUrl.value || command.value;
});

const showBody = computed(
  () =>
    Boolean(recipeTitle.value || previewUrl.value || command.value) ||
    (hasResult.value && Boolean(resultText.value)),
);
const expandable = computed(() => showBody.value || Boolean(argsText.value.trim()));
</script>

<template>
  <!-- 启动预览工具卡：登记 Launch Recipe，给人侧内嵌预览用 -->
  <ToolCard
    :title="t('toolPresentPreview')"
    :detail="detail"
    :icon="AppWindowIcon"
    :expandable="expandable"
    :prefer-open="showBody && isActive"
  >
    <div class="flex min-w-0 flex-col gap-2 px-2.5 py-2">
      <dl v-if="recipeTitle || previewUrl || command" class="grid gap-1.5 text-xs">
        <div v-if="recipeTitle" class="flex min-w-0 gap-2">
          <dt class="w-14 shrink-0 text-muted-foreground">{{ t("toolPresentPreviewTitle") }}</dt>
          <dd class="min-w-0 truncate font-medium text-foreground">{{ recipeTitle }}</dd>
        </div>
        <div v-if="previewUrl" class="flex min-w-0 gap-2">
          <dt class="w-14 shrink-0 text-muted-foreground">{{ t("toolPresentPreviewUrl") }}</dt>
          <dd class="min-w-0 truncate font-mono text-foreground">{{ previewUrl }}</dd>
        </div>
        <div v-if="command" class="flex min-w-0 gap-2">
          <dt class="w-14 shrink-0 text-muted-foreground">{{ t("toolPresentPreviewCmd") }}</dt>
          <dd class="min-w-0 break-all font-mono text-foreground">{{ command }}</dd>
        </div>
        <div v-if="cwd && cwd !== '.'" class="flex min-w-0 gap-2">
          <dt class="w-14 shrink-0 text-muted-foreground">cwd</dt>
          <dd class="min-w-0 truncate font-mono text-muted-foreground">{{ cwd }}</dd>
        </div>
        <div v-if="recipeId" class="flex min-w-0 gap-2">
          <dt class="w-14 shrink-0 text-muted-foreground">id</dt>
          <dd class="min-w-0 truncate font-mono text-muted-foreground">{{ recipeId }}</dd>
        </div>
        <div v-if="linkedJobId" class="flex min-w-0 gap-2">
          <dt class="w-14 shrink-0 text-muted-foreground">job</dt>
          <dd class="min-w-0 truncate font-mono text-muted-foreground">{{ linkedJobId }}</dd>
        </div>
      </dl>
      <pre
        v-if="hasResult && resultText"
        class="bg-paper max-h-40 overflow-auto rounded-md p-2 font-mono text-xs whitespace-pre-wrap break-all"
        :class="
          isError
            ? 'text-destructive'
            : isInterrupted
              ? 'text-muted-foreground'
              : 'text-foreground'
        "
      >{{ resultText }}</pre>
    </div>
  </ToolCard>
</template>

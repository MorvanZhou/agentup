<script setup lang="ts">
import { deliverableFileIcon } from "../../../../../model/message/deliverable-icon";
import { deliverableFileName, type AgentUpDeliverable } from "../../../../../model/message/message-deliverables";
import { middleEllipsisFileName } from "../../../../../model/composer/attachment-ref";
import { formatBytes } from "../../../../../model/workspace/workspace-path";

const props = defineProps<{
  file: AgentUpDeliverable;
  previewUrl?: string;
  size?: number;
  loading?: boolean;
}>();

const emit = defineEmits<{ open: [file: AgentUpDeliverable] }>();

/** 气泡/弹窗卡片上的省略文件名。 */
function displayName(): string {
  return middleEllipsisFileName(deliverableFileName(props.file.path), 22);
}
</script>

<template>
  <!-- 交付文件卡：缩略/图标 + 文件名 + 大小 -->
  <button
    type="button"
    class="flex w-full min-w-0 items-center gap-2.5 rounded-lg border border-rule/80 bg-paper px-2 py-2 text-left transition duration-150 hover:bg-muted focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-60"
    :disabled="loading"
    :title="file.path"
    @click="emit('open', file)"
  >
    <!-- 左：图片缩略或类型图标 -->
    <span
      class="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-rule/60 bg-bubble"
      aria-hidden="true"
    >
      <img
        v-if="previewUrl"
        :src="previewUrl"
        alt=""
        class="size-full object-cover"
      />
      <component
        :is="deliverableFileIcon(file.path)"
        v-else
        class="size-5 text-muted-foreground"
      />
    </span>
    <!-- 右：省略文件名 + 大小（无 size 不占行） -->
    <span class="flex min-w-0 flex-1 flex-col gap-0.5">
      <span class="truncate text-xs font-medium text-foreground">{{ displayName() }}</span>
      <span
        v-if="size != null"
        class="tabular-nums text-[11px] text-muted-foreground"
      >
        {{ formatBytes(size) }}
      </span>
    </span>
  </button>
</template>

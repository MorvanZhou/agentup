<script setup lang="ts">
import { FileMinusIcon, FilePenIcon, FilePlusIcon } from "@lucide/vue";
import { computed, ref, watch } from "vue";

import HtmlPreview from "../../../../../../../../shared/components/preview/HtmlPreview.vue";
import ImagePreview from "../../../../../../../../shared/components/preview/ImagePreview.vue";
import MarkdownPreview from "../../../../../../../../shared/components/preview/MarkdownPreview.vue";
import { t } from "../../../../../../../../shared/model/ui/ui-locale";
import { usePreviewWorkspaceFile } from "../../../../../../composables/usePreviewWorkspaceFile";
import { useRevealWorkspaceFile } from "../../../../../../composables/useRevealWorkspaceFile";
import {
  ARTIFACT_PAGE_SIZE,
  artifactDisplayPath,
  artifactFileName,
  paginateArtifacts,
  type AgentUpArtifacts,
  type ArtifactChange,
  type ArtifactChangeKind,
} from "../../../../../../model/message/message-artifacts";
import { formatBytes } from "../../../../../../model/workspace/workspace-path";

const props = defineProps<{
  artifacts: AgentUpArtifacts;
}>();

const {
  loading,
  imageOpen,
  imageSrc,
  imagePath,
  htmlOpen,
  htmlSource,
  htmlPath,
  markdownOpen,
  markdownSource,
  markdownPath,
  previewWorkspaceFile,
} = usePreviewWorkspaceFile();

const { revealWorkspaceFile } = useRevealWorkspaceFile();

const visibleCount = ref(ARTIFACT_PAGE_SIZE);

watch(
  () => props.artifacts.files.length,
  () => {
    visibleCount.value = ARTIFACT_PAGE_SIZE;
  },
);

const page = computed(() => paginateArtifacts(props.artifacts.files, visibleCount.value));

function kindLabel(kind: ArtifactChangeKind): string {
  if (kind === "added") return t("artifactKindAdded");
  if (kind === "modified") return t("artifactKindModified");
  return t("artifactKindDeleted");
}

function onOpen(file: ArtifactChange): void {
  if (file.kind === "deleted" || loading.value) return;
  void previewWorkspaceFile(file.path);
}

function loadMore(): void {
  visibleCount.value += ARTIFACT_PAGE_SIZE;
}

function revealImage(): void {
  if (imagePath.value) void revealWorkspaceFile(imagePath.value);
}

function revealHtml(): void {
  if (htmlPath.value) void revealWorkspaceFile(htmlPath.value);
}

function revealMarkdown(): void {
  if (markdownPath.value) void revealWorkspaceFile(markdownPath.value);
}
</script>

<template>
  <!-- 本回合 ARTIFACT 差分：单行紧凑卡片 + 分页；可预览类型走 shared preview -->
  <div class="flex w-full min-w-0 flex-col gap-1.5" data-slot="aui_artifacts" :aria-label="t('tabArtifacts')">
    <ul class="m-0 grid list-none gap-1 p-0">
      <li v-for="file in page.items" :key="`${file.kind}:${file.path}`">
        <button
          type="button"
          class="flex w-full min-w-0 items-center gap-1.5 rounded-md border border-rule/80 bg-paper px-2 py-1 text-left transition duration-200 outline-none focus-visible:ring-2 focus-visible:ring-accent/15"
          :class="
            file.kind === 'deleted'
              ? 'cursor-default opacity-70'
              : 'hover:border-accent/40 hover:bg-accent/5'
          "
          :disabled="file.kind === 'deleted' || loading"
          :title="`${kindLabel(file.kind)} · ${file.path}`"
          @click="onOpen(file)"
        >
          <FilePlusIcon
            v-if="file.kind === 'added'"
            class="size-3 shrink-0 text-accent"
            aria-hidden="true"
          />
          <FilePenIcon
            v-else-if="file.kind === 'modified'"
            class="size-3 shrink-0 text-foreground"
            aria-hidden="true"
          />
          <FileMinusIcon
            v-else
            class="size-3 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <span
            class="min-w-0 shrink truncate text-xs font-medium text-foreground"
            :class="file.kind === 'deleted' ? 'line-through text-muted-foreground' : ''"
          >
            {{ artifactFileName(file.path) }}
          </span>
          <span class="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
            {{ artifactDisplayPath(file.path) }}
          </span>
          <span
            v-if="file.size != null"
            class="shrink-0 tabular-nums text-[11px] text-muted-foreground"
          >
            {{ formatBytes(file.size) }}
          </span>
        </button>
      </li>
    </ul>

    <button
      v-if="page.hasMore"
      type="button"
      class="inline-flex min-h-7 w-full items-center justify-center rounded-md border border-rule/80 bg-paper px-2 text-[11px] font-medium text-muted-foreground transition duration-200 hover:bg-black/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/15 dark:hover:bg-white/5"
      @click="loadMore"
    >
      {{ t("artifactLoadMore") }}
    </button>

    <p
      v-if="artifacts.truncated"
      class="m-0 text-[11px] text-muted-foreground"
      role="note"
    >
      {{ t("artifactTruncated") }}
    </p>

    <ImagePreview
      v-model:open="imageOpen"
      :src="imageSrc"
      :alt="t('msgImagePreview')"
      :reveal-path="imagePath"
      @reveal="revealImage"
    />
    <HtmlPreview
      v-model:open="htmlOpen"
      :source="htmlSource"
      :reveal-path="htmlPath"
      @reveal="revealHtml"
    />
    <MarkdownPreview
      v-model:open="markdownOpen"
      :source="markdownSource"
      :reveal-path="markdownPath"
      @reveal="revealMarkdown"
    />
  </div>
</template>

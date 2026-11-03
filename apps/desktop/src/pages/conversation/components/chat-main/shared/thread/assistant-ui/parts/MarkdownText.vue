<script setup lang="ts">
import { useAuiState } from "@assistant-ui/vue";
import { computed } from "vue";

import MarkdownBody from "../../../../../../../../shared/components/preview/MarkdownBody.vue";
import HtmlPreview from "../../../../../../../../shared/components/preview/HtmlPreview.vue";
import ImagePreview from "../../../../../../../../shared/components/preview/ImagePreview.vue";
import MarkdownPreview from "../../../../../../../../shared/components/preview/MarkdownPreview.vue";
import type { NormalizedLocalPath } from "../../../../../../../../shared/model/markdown/local-path";
import { showToast } from "../../../../../../../../shared/model/ui/toast";
import { t } from "../../../../../../../../shared/model/ui/ui-locale";
import { usePreviewWorkspaceFile } from "../../../../../../composables/usePreviewWorkspaceFile";
import { useRevealWorkspaceFile } from "../../../../../../composables/useRevealWorkspaceFile";

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

// 流式中不链化；结束后与历史二次加载（已 complete）一次启发式链化
const messageRunning = useAuiState((s) => s.message.status?.type === "running");
const linkLocalPaths = computed(() => !messageRunning.value);

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

async function openHostAbsolute(absolute: string): Promise<void> {
  // 与 useOpenWorkspaceFile 一致：无 Electron 桥时提示桌面端
  if (!window.agentUp?.openHostPath) {
    showToast("请在 AgentUp 桌面应用中打开", "error");
    return;
  }
  try {
    await window.agentUp.openHostPath(absolute);
  } catch (caught) {
    showToast(caught instanceof Error && caught.message ? caught.message : "无法打开文件", "error");
  }
}

function onOpenLocalPath(target: NormalizedLocalPath): void {
  if (loading.value) return;
  if (target.kind === "relative") {
    void previewWorkspaceFile(target.path);
    return;
  }
  // 绝对路径（含工作区外）：系统打开；敏感根 / 不存在由主进程拒绝
  void openHostAbsolute(target.path);
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
  <!-- Markdown 正文：流结束后链化本地路径；可预览类型走 shared preview -->
  <MarkdownBody
    :source="text"
    :secondary="props.secondary"
    :link-local-paths="linkLocalPaths"
    @open-local-path="onOpenLocalPath"
  />
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
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";

import HtmlPreview from "../../../../../../../shared/components/preview/HtmlPreview.vue";
import ImagePreview from "../../../../../../../shared/components/preview/ImagePreview.vue";
import MarkdownPreview from "../../../../../../../shared/components/preview/MarkdownPreview.vue";
import { useDesktop } from "../../../../../../../app/desktop";
import { DesktopApi } from "../../../../../../../shared/api/runtime";
import { t } from "../../../../../../../shared/model/ui/ui-locale";
import { usePreviewWorkspaceFile } from "../../../../../composables/usePreviewWorkspaceFile";
import { useRevealWorkspaceFile } from "../../../../../composables/useRevealWorkspaceFile";
import {
  isImageAttachmentPath,
  loadAttachmentImagePreview,
} from "../../../../../model/composer/attachment-image-preview";
import { middleEllipsisFileName } from "../../../../../model/composer/attachment-ref";
import { deliverableFileIcon } from "../../../../../model/message/deliverable-icon";
import {
  deliverableFileName,
  type AgentUpDeliverable,
  type AgentUpDeliverables,
} from "../../../../../model/message/message-deliverables";
import { injectChatSurface } from "../../../../../model/thread/chat-surface";
import { injectThreadAgentId } from "../../../../../model/thread/thread-agent-id";
import { injectThreadExtras } from "../../../../../model/thread/thread-extras";
import { formatBytes } from "../../../../../model/workspace/workspace-path";

const props = defineProps<{
  deliverables: AgentUpDeliverables;
}>();

const api = new DesktopApi();
const { session } = useDesktop();
const injectedAgentId = injectThreadAgentId();
const extras = injectThreadExtras();
const surface = injectChatSurface();

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

/** path → 缩略 dataURL；非图或失败不入 map。 */
const previews = ref(new Map<string, string>());
/** metadata 缺 size 时从工作区补；失败记入 sizeFailed，不再重试。 */
const sizes = ref(new Map<string, number>());
const sizeFailed = ref(new Set<string>());

const files = computed(() => props.deliverables.files);

watch(
  files,
  (list) => {
    const token = session.value?.token ?? "";
    const userId = session.value?.userId ?? "";
    const groupId = surface.value.groupId;
    const agentId = groupId ? `group:${groupId}` : injectedAgentId;
    if (!token || !userId || !agentId) return;
    const personal = !groupId && extras.value.personal;
    for (const file of list) {
      if (isImageAttachmentPath(file.path) && !previews.value.has(file.path)) {
        void loadAttachmentImagePreview({
          api,
          token,
          userId,
          agentId,
          personal,
          path: file.path,
        }).then((url) => {
          if (!url) return;
          previews.value = new Map(previews.value).set(file.path, url);
        });
      }
      // 历史气泡可能只有 path：现读工作区补 size
      if (
        file.size != null ||
        sizes.value.has(file.path) ||
        sizeFailed.value.has(file.path)
      ) {
        continue;
      }
      void api
        .readWorkspaceFile(token, userId, agentId, personal, file.path)
        .then((result) => {
          if (typeof result.size !== "number" || !Number.isFinite(result.size) || result.size < 0) {
            sizeFailed.value = new Set(sizeFailed.value).add(file.path);
            return;
          }
          sizes.value = new Map(sizes.value).set(file.path, result.size);
        })
        .catch(() => {
          sizeFailed.value = new Set(sizeFailed.value).add(file.path);
        });
    }
  },
  { immediate: true },
);

function displayName(file: AgentUpDeliverable): string {
  return middleEllipsisFileName(deliverableFileName(file.path), 22);
}

/** metadata.size 优先，否则用工作区回填。 */
function resolvedSize(file: AgentUpDeliverable): number | undefined {
  if (typeof file.size === "number" && Number.isFinite(file.size) && file.size >= 0) {
    return file.size;
  }
  return sizes.value.get(file.path);
}

function onOpen(file: AgentUpDeliverable): void {
  if (loading.value) return;
  void previewWorkspaceFile(file.path);
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
  <!-- 收口交付：矩形卡片网格（工具栏下方） -->
  <div
    v-if="files.length > 0"
    class="mt-2 w-full min-w-0 select-none"
    data-copy-ignore
    role="group"
    :aria-label="t('msgDeliverables')"
  >
    <ul class="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
      <li v-for="file in files" :key="file.path" class="min-w-0">
        <button
          type="button"
          class="flex w-full min-w-0 items-center gap-2.5 rounded-lg border border-rule/80 bg-paper px-2 py-2 text-left transition duration-150 hover:bg-muted focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-60"
          :disabled="loading"
          :title="file.path"
          @click="onOpen(file)"
        >
          <!-- 左：图片缩略或类型图标 -->
          <span
            class="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-rule/60 bg-bubble"
            aria-hidden="true"
          >
            <img
              v-if="previews.get(file.path)"
              :src="previews.get(file.path)"
              alt=""
              class="size-full object-cover"
            />
            <component
              :is="deliverableFileIcon(file.path)"
              v-else
              class="size-5 text-muted-foreground"
            />
          </span>
          <!-- 右：省略文件名 + 大小（缺 size 时现读工作区，读不到则不占行） -->
          <span class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="truncate text-xs font-medium text-foreground">{{ displayName(file) }}</span>
            <span
              v-if="resolvedSize(file) != null"
              class="tabular-nums text-[11px] text-muted-foreground"
            >
              {{ formatBytes(resolvedSize(file)!) }}
            </span>
          </span>
        </button>
      </li>
    </ul>
  </div>

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

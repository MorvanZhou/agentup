<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ChevronRightIcon } from "@lucide/vue";

import HtmlPreview from "../../../../../../../shared/components/preview/HtmlPreview.vue";
import ImagePreview from "../../../../../../../shared/components/preview/ImagePreview.vue";
import MarkdownPreview from "../../../../../../../shared/components/preview/MarkdownPreview.vue";
import AppDialog from "../../../../../../../shared/components/AppDialog.vue";
import { useDesktop } from "../../../../../../../app/desktop";
import { DesktopApi } from "../../../../../../../shared/api/runtime";
import { t, tf } from "../../../../../../../shared/model/ui/ui-locale";
import { usePreviewWorkspaceFile } from "../../../../../composables/usePreviewWorkspaceFile";
import { useRevealWorkspaceFile } from "../../../../../composables/useRevealWorkspaceFile";
import {
  isImageAttachmentPath,
  loadAttachmentImagePreview,
} from "../../../../../model/composer/attachment-image-preview";
import {
  type AgentUpDeliverable,
  type AgentUpDeliverables,
} from "../../../../../model/message/message-deliverables";
import { injectChatSurface } from "../../../../../model/thread/chat-surface";
import { injectThreadAgentId } from "../../../../../model/thread/thread-agent-id";
import { injectThreadExtras } from "../../../../../model/thread/thread-extras";
import DeliverableFileCard from "./DeliverableFileCard.vue";

/** 气泡内先露前 N 个，其余进「查看更多」弹窗。 */
const PREVIEW_LIMIT = 4;

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
/** 查看更多：弹窗 grid 展示全部交付。 */
const moreOpen = ref(false);

const files = computed(() => props.deliverables.files);
const visibleFiles = computed(() => files.value.slice(0, PREVIEW_LIMIT));
const remainingCount = computed(() => Math.max(0, files.value.length - PREVIEW_LIMIT));
const hasMore = computed(() => remainingCount.value > 0);

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
  <!-- 收口交付：矩形卡片网格（工具栏下方）；多则先露前 4，其余进弹窗 -->
  <div
    v-if="files.length > 0"
    class="mt-2 w-full min-w-0 select-none"
    data-copy-ignore
    role="group"
    :aria-label="t('msgDeliverables')"
  >
    <ul class="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
      <li v-for="file in visibleFiles" :key="file.path" class="min-w-0">
        <DeliverableFileCard
          :file="file"
          :preview-url="previews.get(file.path)"
          :size="resolvedSize(file)"
          :loading="loading"
          @open="onOpen"
        />
      </li>
    </ul>

    <!-- 超出预览上限：打开弹窗看全部 -->
    <button
      v-if="hasMore"
      type="button"
      class="mt-2 inline-flex min-h-8 items-center gap-1 rounded-lg px-1 text-xs font-medium text-muted-foreground transition duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/30"
      @click="moreOpen = true"
    >
      {{ tf("msgDeliverablesViewMore", { count: remainingCount }) }}
      <ChevronRightIcon class="size-3.5" aria-hidden="true" />
    </button>
  </div>

  <!-- 全部交付：宽弹窗，一排多列 -->
  <AppDialog
    :open="moreOpen"
    :title="t('msgDeliverables')"
    size="xl"
    @update:open="moreOpen = $event"
  >
    <ul class="grid w-full grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      <li v-for="file in files" :key="file.path" class="min-w-0">
        <DeliverableFileCard
          :file="file"
          :preview-url="previews.get(file.path)"
          :size="resolvedSize(file)"
          :loading="loading"
          @open="onOpen"
        />
      </li>
    </ul>
  </AppDialog>

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

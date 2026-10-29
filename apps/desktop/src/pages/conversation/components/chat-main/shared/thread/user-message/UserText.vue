<script setup lang="ts">
import { useAuiState } from "@assistant-ui/vue";
import type {} from "@assistant-ui/core/store";
import { computed, ref, watch } from "vue";

import { useDesktop } from "../../../../../../../app/desktop";
import { DesktopApi } from "../../../../../../../shared/api/runtime";
import { useOpenWorkspaceFile } from "../../../../../composables/useOpenWorkspaceFile";
import { splitEmojiText } from "../../../../../model/composer/emoji-data";
import {
  isImageAttachmentPath,
  loadAttachmentImagePreview,
} from "../../../../../model/composer/attachment-image-preview";
import { stripSyntheticImageCaption } from "../../../../../model/composer/image-caption";
import {
  partitionDisplayAttachments,
  segmentDisplayMessage,
} from "../../../../../model/composer/skill-text";
import { injectChatSurface } from "../../../../../model/thread/chat-surface";
import { injectThreadAgentId } from "../../../../../model/thread/thread-agent-id";
import { injectThreadExtras } from "../../../../../model/thread/thread-extras";
import FileChip from "../composer/chips/FileChip.vue";
import SkillChip from "../composer/chips/SkillChip.vue";

/** 用户气泡正文：文件抽到附件条，skill 仍内联。 */
// 尺寸说明是识图管线写进原文的，气泡只留用户自己的字；图在附件条里。
const text = useAuiState((s) =>
  s.part.type === "text" ? stripSyntheticImageCaption(s.part.text) : "",
);
const partitioned = computed(() =>
  partitionDisplayAttachments(segmentDisplayMessage(text.value)),
);
const files = computed(() => partitioned.value.files);
const body = computed(() => partitioned.value.body);
const hasBody = computed(() => body.value.length > 0);

const { openWorkspaceFile } = useOpenWorkspaceFile();

/** reference 附件（群聊 / 私人助理）的图片缩略：拉一次 dataURL，失败保持文件芯片。 */
const api = new DesktopApi();
const surface = injectChatSurface();
const extras = injectThreadExtras();
const injectedAgentId = injectThreadAgentId();
const { session } = useDesktop();
const previews = ref(new Map<string, string>());

watch(
  files,
  (list) => {
    const token = session.value?.token ?? "";
    const userId = session.value?.userId ?? "";
    // 无会话（游客冷启动等）或无归属时不发请求，保持纯文件芯片
    const groupId = surface.value.groupId;
    const agentId = groupId ? `group:${groupId}` : injectedAgentId;
    if (!token || !userId || !agentId) return;
    for (const file of list) {
      if (!isImageAttachmentPath(file.path) || previews.value.has(file.path)) continue;
      void loadAttachmentImagePreview({
        api,
        token,
        userId,
        agentId,
        personal: !groupId && extras.value.personal,
        path: file.path,
      }).then((url) => {
        if (!url) return;
        previews.value = new Map(previews.value).set(file.path, url);
      });
    }
  },
  { immediate: true },
);
</script>

<template>
  <!-- 用户气泡：附件条 + 正文 -->
  <div class="flex min-w-0 flex-col gap-2">
    <div
      v-if="files.length"
      class="flex min-w-0 flex-col gap-1"
      aria-label="附件"
    >
      <FileChip
        v-for="file in files"
        :key="file.path"
        :name="file.name"
        :path="file.path"
        :folder="file.folder"
        :image="previews.get(file.path)"
        variant="on-primary"
        layout="row"
        openable
        @open="openWorkspaceFile(file.path)"
      />
    </div>
    <!-- 注释夹缝：避免 whitespace-pre-wrap 把模板缩进带进选区 -->
    <span v-if="hasBody" class="inline whitespace-pre-wrap"
      ><!--
   --><template v-for="(segment, index) in body" :key="index"
        ><!--
     --><SkillChip
          v-if="segment.type === 'skill'"
          :name="segment.name"
          variant="on-primary"
          class="mx-0.5 align-baseline"
        /><!--
     --><template v-else-if="segment.type === 'text'"
          ><!--
       --><template
            v-for="(piece, pieceIndex) in splitEmojiText(segment.value)"
            :key="pieceIndex"
            ><!--
         --><span
              v-if="piece.type === 'emoji'"
              class="inline-block text-lg leading-none align-[-0.1em]"
              aria-hidden="false"
              >{{ piece.value }}</span
            ><!--
         --><template v-else>{{ piece.value }}</template><!--
       --></template
          ><!--
     --></template
        ><!--
     --><span
          v-else-if="segment.type === 'mention'"
          class="mx-0.5"
          :data-mention="segment.name"
          >@{{ segment.name }}</span
        ><!--
   --></template
      ><!--
 --></span>
  </div>
</template>

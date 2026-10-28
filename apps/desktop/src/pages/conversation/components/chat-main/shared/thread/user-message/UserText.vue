<script setup lang="ts">
import { useAuiState } from "@assistant-ui/vue";
import type {} from "@assistant-ui/core/store";
import { computed } from "vue";

import { useOpenWorkspaceFile } from "../../../../../composables/useOpenWorkspaceFile";
import { splitEmojiText } from "../../../../../model/composer/emoji-data";
import {
  partitionDisplayAttachments,
  segmentDisplayMessage,
} from "../../../../../model/composer/skill-text";
import FileChip from "../composer/chips/FileChip.vue";
import SkillChip from "../composer/chips/SkillChip.vue";

/** 用户气泡正文：文件抽到附件条，skill 仍内联。 */
const text = useAuiState((s) => (s.part.type === "text" ? s.part.text : ""));
const partitioned = computed(() =>
  partitionDisplayAttachments(segmentDisplayMessage(text.value)),
);
const files = computed(() => partitioned.value.files);
const body = computed(() => partitioned.value.body);
const hasBody = computed(() => body.value.length > 0);

const { openWorkspaceFile } = useOpenWorkspaceFile();
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
        variant="on-primary"
        layout="row"
        openable
        @open="openWorkspaceFile(file.path)"
      />
    </div>
    <span v-if="hasBody" class="inline whitespace-pre-wrap">
      <template v-for="(segment, index) in body" :key="index">
        <SkillChip
          v-if="segment.type === 'skill'"
          :name="segment.name"
          variant="on-primary"
          class="mx-0.5 align-baseline"
        />
        <template v-else>
          <template v-for="(piece, pieceIndex) in splitEmojiText(segment.value)" :key="pieceIndex">
            <span
              v-if="piece.type === 'emoji'"
              class="inline-block text-lg leading-none align-[-0.1em]"
              aria-hidden="false"
            >{{ piece.value }}</span>
            <template v-else>{{ piece.value }}</template>
          </template>
        </template>
      </template>
    </span>
  </div>
</template>

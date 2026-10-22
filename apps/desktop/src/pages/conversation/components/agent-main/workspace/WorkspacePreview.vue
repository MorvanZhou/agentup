<script setup lang="ts">
import { computed, ref, watch } from "vue";

import type { WorkspaceFile } from "../../../../../shared/api/runtime/workspace";
import ImagePreview from "../../../../../shared/components/ImagePreview.vue";
import { t } from "../../../../../shared/model/ui-locale";
import { highlightCodeHtml, languageFromPath } from "../../../model/highlight-code";
import { formatBytes } from "../../../model/workspace-path";

const props = defineProps<{
  file: WorkspaceFile | null;
  loading: boolean;
  draft: string;
}>();

const emit = defineEmits<{
  "update:draft": [value: string];
}>();

const previewOpen = ref(false);

/** 编辑器用行拆分：保留末尾空行，与 textarea 对齐。 */
const lines = computed(() => {
  if (!props.draft) return [""];
  return props.draft.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
});
const lineNos = computed(() => lines.value.map((_, index) => index + 1));
const language = computed(() =>
  props.file?.path ? languageFromPath(props.file.path) : undefined,
);
const html = computed(() => highlightCodeHtml(props.draft, language.value));
const imageSrc = computed(() => {
  const file = props.file;
  if (!file || file.kind !== "image") return "";
  return `data:${file.mediaType};base64,${file.dataBase64}`;
});

watch(imageSrc, () => {
  previewOpen.value = false;
});

function openImagePreview(): void {
  if (!imageSrc.value) return;
  // 推迟到本次 click 冒泡结束后再挂遮罩，避免同一次点击立刻关掉
  window.setTimeout(() => {
    previewOpen.value = true;
  }, 0);
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <!-- 预览 -->
    <p v-if="loading && !file" class="px-3 py-6 text-center text-sm text-muted-foreground">{{ t("wsReading") }}</p>
    <div
      v-else-if="file?.kind === 'text'"
      class="aui-hljs flex min-h-0 flex-1 flex-col overflow-hidden bg-code"
    >
      <div class="min-h-0 flex-1 overflow-auto">
        <div class="flex w-max min-w-full min-h-full">
          <div
            class="text-code-gutter sticky left-0 z-10 shrink-0 select-none border-r border-rule/50 bg-code py-3 pl-2 pr-2 text-right font-mono text-sm leading-5 tabular-nums"
            aria-hidden="true"
          >
            <div v-for="n in lineNos" :key="n" class="h-5">{{ n }}</div>
          </div>
          <div class="relative min-h-full min-w-0 flex-1">
            <pre
              class="pointer-events-none m-0 min-h-full px-3 py-3 font-mono text-sm leading-5"
              aria-hidden="true"
            ><code class="hljs block whitespace-pre bg-transparent p-0 font-inherit" v-html="html" /></pre>
            <textarea
              :value="draft"
              :aria-label="t('wsFileContent')"
              spellcheck="false"
              wrap="off"
              class="absolute inset-0 m-0 h-full w-full resize-none border-0 bg-transparent px-3 py-3 font-mono text-sm leading-5 text-transparent caret-foreground outline-none selection:bg-accent/30"
              @input="emit('update:draft', ($event.target as HTMLTextAreaElement).value)"
            />
          </div>
        </div>
      </div>
    </div>
    <div v-else-if="file?.kind === 'image'" class="min-h-0 flex-1 overflow-auto p-3">
      <button
        type="button"
        class="block max-w-full cursor-zoom-in rounded-lg border-0 bg-transparent p-0 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        :aria-label="t('msgImagePreview')"
        @click="openImagePreview"
      >
        <img :src="imageSrc" alt="" class="max-w-full" draggable="false" />
      </button>
    </div>
    <!-- 无法预览（点击列表项时已优先走系统默认应用） -->
    <div v-else-if="file" class="grid gap-1 px-3 py-6 text-sm">
      <p class="font-medium text-foreground">{{ file.kind === "too-large" ? t("wsTooLarge") : t("wsCannotPreview") }}</p>
      <p class="text-muted-foreground">{{ formatBytes(file.size) }}</p>
    </div>
    <ImagePreview
      v-model:open="previewOpen"
      :src="imageSrc"
      :alt="t('msgImagePreview')"
    />
  </div>
</template>

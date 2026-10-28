<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Maximize2Icon } from "@lucide/vue";

import type { WorkspaceFile } from "../../../../../../shared/api/runtime/workspace";
import HtmlPreview from "../../../../../../shared/components/preview/HtmlPreview.vue";
import ImagePreview from "../../../../../../shared/components/preview/ImagePreview.vue";
import MarkdownBody from "../../../../../../shared/components/preview/MarkdownBody.vue";
import MarkdownPreview from "../../../../../../shared/components/preview/MarkdownPreview.vue";
import PreviewModeTabs from "../../../../../../shared/components/preview/PreviewModeTabs.vue";
import { t } from "../../../../../../shared/model/ui/ui-locale";
import { highlightCodeHtml, languageFromPath } from "../../../../model/render/highlight-code";
import {
  formatBytes,
  isHtmlWorkspacePath,
  isMarkdownWorkspacePath,
} from "../../../../model/workspace/workspace-path";

const props = defineProps<{
  file: WorkspaceFile | null;
  loading: boolean;
  draft: string;
}>();

const emit = defineEmits<{
  "update:draft": [value: string];
  reveal: [];
}>();

const filePath = computed(() => props.file?.path ?? "");

const imagePreviewOpen = ref(false);
const htmlPreviewOpen = ref(false);
const markdownPreviewOpen = ref(false);
/** HTML 文件面板内：渲染预览 / 可编辑源码 */
const htmlPanelMode = ref<"preview" | "code">("preview");
/** Markdown 文件面板内：渲染预览 / 可编辑原文 */
const markdownPanelMode = ref<"preview" | "source">("preview");

/** 编辑器用行拆分：保留末尾空行，与 textarea 对齐。 */
const lines = computed(() => {
  if (!props.draft) return [""];
  return props.draft.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
});
const lineNos = computed(() => lines.value.map((_, index) => index + 1));
const language = computed(() =>
  props.file?.path ? languageFromPath(props.file.path) : undefined,
);
const highlighted = computed(() => highlightCodeHtml(props.draft, language.value));
const isHtml = computed(
  () => props.file?.kind === "text" && !!props.file.path && isHtmlWorkspacePath(props.file.path),
);
const isMarkdown = computed(
  () =>
    props.file?.kind === "text" && !!props.file.path && isMarkdownWorkspacePath(props.file.path),
);
const showCodeEditor = computed(
  () =>
    props.file?.kind === "text" &&
    (!isHtml.value || htmlPanelMode.value === "code") &&
    (!isMarkdown.value || markdownPanelMode.value === "source"),
);
const htmlModeTabs = computed(() => [
  { id: "preview", label: t("msgHtmlPreviewMode"), icon: "eye" as const },
  { id: "code", label: t("msgHtmlCodeMode"), icon: "code" as const },
]);
const markdownModeTabs = computed(() => [
  { id: "preview", label: t("msgMarkdownPreviewMode"), icon: "eye" as const },
  { id: "source", label: t("msgMarkdownSourceMode"), icon: "code" as const },
]);
const imageSrc = computed(() => {
  const file = props.file;
  if (!file || file.kind !== "image") return "";
  return `data:${file.mediaType};base64,${file.dataBase64}`;
});

watch(imageSrc, () => {
  imagePreviewOpen.value = false;
});

watch(
  () => props.file?.path,
  () => {
    htmlPreviewOpen.value = false;
    markdownPreviewOpen.value = false;
    htmlPanelMode.value = "preview";
    markdownPanelMode.value = "preview";
  },
);

function openImagePreview(): void {
  if (!imageSrc.value) return;
  // 推迟到本次 click 冒泡结束后再挂遮罩，避免同一次点击立刻关掉
  window.setTimeout(() => {
    imagePreviewOpen.value = true;
  }, 0);
}

function openHtmlPreview(): void {
  window.setTimeout(() => {
    htmlPreviewOpen.value = true;
  }, 0);
}

function openMarkdownPreview(): void {
  window.setTimeout(() => {
    markdownPreviewOpen.value = true;
  }, 0);
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <!-- 预览 -->
    <p v-if="loading && !file" class="px-3 py-6 text-center text-sm text-muted-foreground">{{ t("wsReading") }}</p>
    <template v-else-if="file?.kind === 'text'">
      <!-- HTML：面板内预览 / 代码切换，全屏走 HtmlPreview -->
      <div v-if="isHtml" class="flex shrink-0 items-center justify-between gap-2 border-b border-rule px-2 py-1.5">
        <PreviewModeTabs
          v-model="htmlPanelMode"
          :modes="htmlModeTabs"
          :aria-label="t('msgHtmlPreviewModes')"
        />
        <button
          type="button"
          class="grid size-7 place-items-center rounded-lg text-muted-foreground transition duration-200 hover:bg-paper-deep hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40"
          :aria-label="t('msgHtmlPreviewExpand')"
          @click="openHtmlPreview"
        >
          <Maximize2Icon class="size-3.5" />
        </button>
      </div>
      <!-- Markdown：面板内预览 / 原文切换，全屏走 MarkdownPreview -->
      <div
        v-else-if="isMarkdown"
        class="flex shrink-0 items-center justify-between gap-2 border-b border-rule px-2 py-1.5"
      >
        <PreviewModeTabs
          v-model="markdownPanelMode"
          :modes="markdownModeTabs"
          :aria-label="t('msgMarkdownPreviewModes')"
        />
        <button
          type="button"
          class="grid size-7 place-items-center rounded-lg text-muted-foreground transition duration-200 hover:bg-paper-deep hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40"
          :aria-label="t('msgMarkdownPreviewExpand')"
          @click="openMarkdownPreview"
        >
          <Maximize2Icon class="size-3.5" />
        </button>
      </div>
      <div
        v-if="isHtml && htmlPanelMode === 'preview'"
        class="min-h-0 flex-1 overflow-hidden bg-paper"
      >
        <iframe
          class="h-full w-full border-0 bg-white"
          :title="t('msgHtmlPreview')"
          :srcdoc="draft"
          sandbox="allow-scripts allow-forms"
          referrerpolicy="no-referrer"
        />
      </div>
      <div
        v-else-if="isMarkdown && markdownPanelMode === 'preview'"
        class="min-h-0 flex-1 overflow-auto bg-paper px-4 py-3"
      >
        <MarkdownBody :source="draft" />
      </div>
      <div
        v-else-if="showCodeEditor"
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
              ><code class="hljs block whitespace-pre bg-transparent p-0 font-inherit" v-html="highlighted" /></pre>
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
    </template>
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
      v-model:open="imagePreviewOpen"
      :src="imageSrc"
      :alt="t('msgImagePreview')"
      :reveal-path="filePath"
      @reveal="emit('reveal')"
    />
    <HtmlPreview
      v-model:open="htmlPreviewOpen"
      :source="draft"
      :initial-mode="htmlPanelMode"
      :reveal-path="filePath"
      @reveal="emit('reveal')"
    />
    <MarkdownPreview
      v-model:open="markdownPreviewOpen"
      :source="draft"
      :initial-mode="markdownPanelMode"
      :reveal-path="filePath"
      @reveal="emit('reveal')"
    />
  </div>
</template>

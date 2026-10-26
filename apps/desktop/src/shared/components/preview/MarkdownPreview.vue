<script setup lang="ts">
import { computed, ref, watch } from "vue";

import { previewFileName } from "../../model/preview/file-name";
import { t } from "../../model/ui/ui-locale";
import MarkdownBody from "./MarkdownBody.vue";
import PreviewModeTabs from "./PreviewModeTabs.vue";
import PreviewShell from "./PreviewShell.vue";

const open = defineModel<boolean>("open", { default: false });

const props = withDefaults(
  defineProps<{
    /** Markdown 原文 */
    source: string;
    /** 初始模式；每次打开时重置 */
    initialMode?: "preview" | "source";
    /** 工作区相对路径；有值时显示「在文件夹中显示」 */
    revealPath?: string;
  }>(),
  { initialMode: "preview", revealPath: undefined },
);

const emit = defineEmits<{
  reveal: [];
}>();

type Mode = "preview" | "source";
const mode = ref<Mode>("preview");

const modeTabs = computed(() => [
  { id: "preview", label: t("msgMarkdownPreviewMode"), icon: "eye" as const },
  { id: "source", label: t("msgMarkdownSourceMode"), icon: "code" as const },
]);
const chromeTitle = computed(() =>
  props.revealPath ? previewFileName(props.revealPath) : undefined,
);

watch(open, (value) => {
  if (value) mode.value = props.initialMode;
});

function escapeGuard(): boolean {
  // 内嵌 ImagePreview 打开时留给它关
  return typeof document !== "undefined" && !!document.querySelector('[data-testid="image-preview"]');
}
</script>

<template>
  <PreviewShell
    v-model:open="open"
    test-id="markdown-preview"
    :aria-label="t('msgMarkdownPreview')"
    :title="chromeTitle"
    :escape-guard="escapeGuard"
    :show-reveal="Boolean(revealPath)"
    @reveal="emit('reveal')"
  >
    <template #view-mode>
      <PreviewModeTabs v-model="mode" :modes="modeTabs" :aria-label="t('msgMarkdownPreviewModes')" />
    </template>

    <div
      v-if="mode === 'preview'"
      class="min-h-0 flex-1 overflow-auto bg-paper px-5 py-4"
    >
      <MarkdownBody :source="source" />
    </div>
    <div
      v-else
      class="aui-hljs flex min-h-0 flex-1 flex-col overflow-hidden bg-code"
    >
      <pre
        class="m-0 min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-sm leading-5 text-foreground"
      ><code class="block whitespace-pre bg-transparent p-0 font-inherit">{{ source }}</code></pre>
    </div>
  </PreviewShell>
</template>

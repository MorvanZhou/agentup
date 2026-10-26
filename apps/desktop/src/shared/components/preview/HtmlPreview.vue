<script setup lang="ts">
import { computed, ref, watch } from "vue";

import { previewFileName } from "../../model/preview/file-name";
import { t } from "../../model/ui/ui-locale";
import PreviewModeTabs from "./PreviewModeTabs.vue";
import PreviewShell from "./PreviewShell.vue";

const open = defineModel<boolean>("open", { default: false });

const props = withDefaults(
  defineProps<{
    /** HTML 源码 */
    source: string;
    /** 初始模式；每次打开时重置 */
    initialMode?: "preview" | "code";
    /** 工作区相对路径；有值时显示「在文件夹中显示」 */
    revealPath?: string;
  }>(),
  { initialMode: "preview", revealPath: undefined },
);

const emit = defineEmits<{
  reveal: [];
}>();

type Mode = "preview" | "code";
const mode = ref<Mode>("preview");

const iframeTitle = computed(() => t("msgHtmlPreview"));
const modeTabs = computed(() => [
  { id: "preview", label: t("msgHtmlPreviewMode"), icon: "eye" as const },
  { id: "code", label: t("msgHtmlCodeMode"), icon: "code" as const },
]);
const chromeTitle = computed(() =>
  props.revealPath ? previewFileName(props.revealPath) : undefined,
);

watch(open, (value) => {
  if (value) mode.value = props.initialMode;
});
</script>

<template>
  <PreviewShell
    v-model:open="open"
    test-id="html-preview"
    :aria-label="t('msgHtmlPreview')"
    :title="chromeTitle"
    :show-reveal="Boolean(revealPath)"
    @reveal="emit('reveal')"
  >
    <template #view-mode>
      <PreviewModeTabs v-model="mode" :modes="modeTabs" :aria-label="t('msgHtmlPreviewModes')" />
    </template>

    <div
      v-if="mode === 'preview'"
      class="flex min-h-0 flex-1 overflow-hidden bg-paper"
    >
      <iframe
        class="h-full min-h-0 w-full flex-1 border-0 bg-white"
        :title="iframeTitle"
        :srcdoc="source"
        sandbox="allow-scripts allow-forms"
        referrerpolicy="no-referrer"
      />
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

<script setup lang="ts">
import { computed } from "vue";

import { highlightCodeHtml, languageFromPath } from "../../../../../../model/render/highlight-code";
import { splitContentLines } from "./tool-file-view";

const props = withDefaults(
  defineProps<{
    content: string;
    /** 用于推断高亮语言 */
    path?: string;
    /** 起始行号（1-indexed）；不传则不显示行号。 */
    startLine?: number;
    tone?: "default" | "muted" | "error";
  }>(),
  { tone: "default" },
);

const lines = computed(() => splitContentLines(props.content));
const lineNos = computed(() => {
  if (typeof props.startLine !== "number") return [] as number[];
  const start = props.startLine;
  return lines.value.map((_, index) => start + index);
});
const language = computed(() =>
  props.path ? languageFromPath(props.path) : undefined,
);
/** 错误/muted 不着色，避免盖住语义色。 */
const html = computed(() => {
  if (props.tone === "error" || props.tone === "muted") {
    return highlightCodeHtml(props.content);
  }
  return highlightCodeHtml(props.content, language.value);
});
const toneClass = computed(() => {
  if (props.tone === "error") return "text-destructive";
  if (props.tone === "muted") return "text-muted-foreground";
  return undefined;
});
const githubChrome = computed(() => props.tone === "default");
</script>

<template>
  <!-- 代码预览：GitHub Prettylights + 行号 -->
  <div
    class="aui-hljs min-w-0 overflow-hidden rounded-md border border-rule/70"
    :class="githubChrome ? 'bg-code' : 'bg-paper'"
  >
    <div class="max-h-64 overflow-auto">
      <div class="flex w-max min-w-full">
        <div
          v-if="lineNos.length"
          class="text-code-gutter sticky left-0 z-10 shrink-0 select-none border-r border-rule/50 py-1.5 pl-2 pr-2 text-right font-mono text-xs leading-5 tabular-nums"
          :class="githubChrome ? 'bg-code' : 'bg-paper'"
          aria-hidden="true"
        >
          <div v-for="n in lineNos" :key="n" class="h-5">{{ n }}</div>
        </div>
        <pre
          class="m-0 px-2 py-1.5 font-mono text-xs leading-5"
          :class="toneClass"
        ><code
          class="hljs block whitespace-pre bg-transparent p-0 font-inherit"
          v-html="html"
        /></pre>
      </div>
    </div>
  </div>
</template>

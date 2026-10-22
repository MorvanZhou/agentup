<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useAuiState } from "@assistant-ui/vue";

import ImagePreview from "../../../../../../../shared/components/ImagePreview.vue";
import { t } from "../../../../../../../shared/model/ui-locale";
import { renderMarkdown } from "../../../../../model/render/markdown";
import { renderMermaidIn } from "../../../../../model/render/mermaid";

withDefaults(
  defineProps<{
    /** 次要信息：更小字号、muted 色（如推理过程） */
    secondary?: boolean;
  }>(),
  { secondary: false },
);

const rootEl = ref<HTMLElement | null>(null);
const previewOpen = ref(false);
const previewSrc = ref("");
const previewAlt = ref(t("msgImagePreview"));
const text = useAuiState((s) =>
  s.part.type === "text" || s.part.type === "reasoning" ? s.part.text : "",
);
const html = computed(() => renderMarkdown(text.value));

let mermaidGen = 0;
watch(
  html,
  async () => {
    const gen = ++mermaidGen;
    await nextTick();
    if (gen !== mermaidGen) return;
    await renderMermaidIn(rootEl.value);
  },
  { flush: "post", immediate: true },
);

function clickElement(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  if (target instanceof Text) return target.parentElement;
  return null;
}

function findPreviewImage(from: Element | null): HTMLImageElement | null {
  if (!from) return null;
  if (from instanceof HTMLImageElement && from.classList.contains("aui-md-img")) {
    return from.src ? from : null;
  }
  const inMermaid = from.closest(".aui-mermaid[data-rendered]");
  if (inMermaid) {
    const img = inMermaid.querySelector("img.aui-md-img");
    return img instanceof HTMLImageElement && img.src ? img : null;
  }
  const img = from.closest("img.aui-md-img");
  return img instanceof HTMLImageElement && img.src ? img : null;
}

function openImagePreview(img: HTMLImageElement): void {
  previewSrc.value = img.currentSrc || img.src;
  previewAlt.value = img.alt || t("msgImagePreview");
  // 推迟到本次 click 冒泡结束后再挂遮罩，避免同一次点击立刻关掉
  window.setTimeout(() => {
    previewOpen.value = true;
  }, 0);
}

async function onRootClick(event: MouseEvent): Promise<void> {
  const target = clickElement(event.target);

  const previewImg = findPreviewImage(target);
  if (previewImg) {
    event.preventDefault();
    openImagePreview(previewImg);
    return;
  }

  if (!target) return;
  const btn = target.closest(".aui-code-copy");
  if (!(btn instanceof HTMLButtonElement)) return;
  const block = btn.closest(".aui-code-block");
  const code = block?.querySelector("pre code")?.textContent ?? "";
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    btn.dataset.copied = "true";
    window.setTimeout(() => {
      delete btn.dataset.copied;
    }, 2000);
  } catch {
    /* 剪贴板不可用时静默失败 */
  }
}

function onRootKeydown(event: KeyboardEvent): void {
  if (event.key !== "Enter" && event.key !== " ") return;
  const target = clickElement(event.target);
  const mermaid = target?.closest(".aui-mermaid[data-rendered]");
  if (!(mermaid instanceof HTMLElement)) return;
  const img = findPreviewImage(mermaid);
  if (!img) return;
  event.preventDefault();
  openImagePreview(img);
}
</script>

<template>
  <!-- Markdown 正文（样式对齐 assistant-ui MarkdownText + GitHub 高亮） -->
  <div
    ref="rootEl"
    class="aui-md"
    :class="secondary && 'aui-md--secondary'"
    data-status="complete"
    v-html="html"
    @click.capture="onRootClick"
    @keydown="onRootKeydown"
  />
  <ImagePreview v-model:open="previewOpen" :src="previewSrc" :alt="previewAlt" />
</template>

<style scoped>
/* 版式：紧凑 IM 气泡内的 prose，参考 assistant-ui / agent-ui chat prose */
.aui-md {
  min-width: 0;
  max-width: 100%;
  overflow-wrap: break-word;
  color: var(--color-foreground);
  font-size: 1rem;
  line-height: 1.75;
  letter-spacing: 0.02em;
}

.aui-md--secondary {
  color: var(--color-muted-foreground);
  font-size: 0.75rem; /* text-xs */
  line-height: 1.375; /* leading-snug */
  letter-spacing: 0.01em;
}

.aui-md--secondary :deep(h1),
.aui-md--secondary :deep(h2),
.aui-md--secondary :deep(h3),
.aui-md--secondary :deep(h4),
.aui-md--secondary :deep(strong),
.aui-md--secondary :deep(a) {
  color: var(--color-muted-foreground);
}

.aui-md--secondary :deep(h1) {
  font-size: 0.875rem;
}

.aui-md--secondary :deep(h2),
.aui-md--secondary :deep(h3),
.aui-md--secondary :deep(h4) {
  font-size: 0.75rem;
}

.aui-md--secondary :deep(p) {
  margin: 0.35rem 0;
}

.aui-md--secondary :deep(p + p) {
  margin-top: 0.5rem;
}

.aui-md :deep(> :first-child) {
  margin-top: 0;
}

.aui-md :deep(> :last-child) {
  margin-bottom: 0;
}

.aui-md :deep(p) {
  margin: 0.75rem 0;
}

.aui-md :deep(p + p) {
  margin-top: 1rem;
}

.aui-md :deep(h1),
.aui-md :deep(h2),
.aui-md :deep(h3),
.aui-md :deep(h4) {
  margin: 1.35rem 0 0.65rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  line-height: 1.45;
  color: var(--color-foreground);
}

.aui-md :deep(h1) {
  font-size: 1.25rem;
}

.aui-md :deep(h2) {
  font-size: 1.125rem;
}

.aui-md :deep(h3),
.aui-md :deep(h4) {
  font-size: 1rem;
}

.aui-md :deep(ul),
.aui-md :deep(ol) {
  margin: 0.75rem 0;
  padding-left: 1.5rem;
}

.aui-md :deep(ul) {
  list-style: disc;
}

.aui-md :deep(ol) {
  list-style: decimal;
}

.aui-md :deep(li) {
  margin: 0.4rem 0;
  line-height: 1.7;
}

.aui-md :deep(li > ul),
.aui-md :deep(li > ol) {
  margin: 0.35rem 0;
}

.aui-md :deep(strong) {
  font-weight: 600;
}

.aui-md :deep(hr) {
  margin: 1.25rem 0;
  border: 0;
  border-top: 1px solid var(--color-border);
}

.aui-md :deep(blockquote) {
  margin: 0.9rem 0;
  padding: 0.35rem 0 0.35rem 0.85rem;
  border-left: 2px solid var(--color-border);
  color: var(--color-muted-foreground);
}

.aui-md :deep(blockquote p) {
  margin: 0.4rem 0;
}

.aui-md :deep(a.aui-md-a) {
  color: var(--color-accent);
  text-decoration: underline;
  text-underline-offset: 2px;
  text-decoration-thickness: 1px;
}

.aui-md :deep(a.aui-md-a:hover) {
  color: var(--color-accent-deep);
}

.aui-md :deep(s),
.aui-md :deep(del) {
  color: var(--color-muted-foreground);
}

/* 行内代码：围栏块内由 pre 承载底色，避免双重底 */
.aui-md :deep(:not(pre) > code) {
  border-radius: 0.375rem;
  background: color-mix(in srgb, var(--color-background) 88%, var(--color-foreground) 6%);
  padding: 0.12em 0.4em;
  font-family: var(--font-mono);
  font-size: 0.85em;
}

/* 代码块：语言头 + 圆角底，对齐 assistant-ui CodeHeader */
.aui-md :deep(.aui-code-block) {
  margin: 0.9rem 0;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--color-border) 70%, transparent);
  border-radius: 0.75rem;
  background: color-mix(in srgb, var(--color-muted) 55%, var(--color-background));
}

.aui-md :deep(.aui-code-header) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  border-bottom: 1px solid color-mix(in srgb, var(--color-border) 70%, transparent);
  background: color-mix(in srgb, var(--color-muted) 70%, transparent);
  padding: 0.35rem 0.65rem;
  font-size: 0.75rem;
}

.aui-md :deep(.aui-code-lang) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
  text-transform: lowercase;
  color: var(--color-muted-foreground);
}

.aui-md :deep(.aui-code-copy) {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  min-height: 1.5rem;
  border: 0;
  border-radius: 0.375rem;
  background: transparent;
  padding: 0.15rem 0.4rem;
  color: var(--color-muted-foreground);
  font-size: 0.75rem;
  line-height: 1;
  cursor: pointer;
  transition: color 200ms, background 200ms;
}

.aui-md :deep(.aui-code-copy:hover) {
  background: color-mix(in srgb, var(--color-background) 70%, transparent);
  color: var(--color-foreground);
}

.aui-md :deep(.aui-code-copy-done),
.aui-md :deep(.aui-code-copy[data-copied="true"] .aui-code-copy-idle) {
  display: none;
}

.aui-md :deep(.aui-code-copy[data-copied="true"] .aui-code-copy-done) {
  display: inline-flex;
}

.aui-md :deep(.aui-code-copy[data-copied="true"] .aui-code-copy-label) {
  font-size: 0;
}

.aui-md :deep(.aui-code-copy[data-copied="true"] .aui-code-copy-label)::after {
  content: "Copied";
  font-size: 0.75rem;
}

.aui-md :deep(.aui-code-copy-idle),
.aui-md :deep(.aui-code-copy-done) {
  display: inline-flex;
}

.aui-md :deep(pre.aui-md-pre) {
  margin: 0;
  overflow-x: auto;
  padding: 0.85rem 1rem;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  line-height: 1.65;
}

.aui-md :deep(pre.aui-md-pre code.hljs) {
  display: block;
  padding: 0;
  background: transparent;
  font-size: inherit;
  line-height: inherit;
  white-space: pre;
}

/* 可点预览的图片（markdown 图 / mermaid 导出图）；纸色底避免透明图与气泡融合 */
.aui-md :deep(img.aui-md-img) {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 0.9rem 0;
  cursor: zoom-in;
  border-radius: 0.75rem;
  background: var(--color-paper);
}

.aui-md :deep(.aui-mermaid) {
  margin: 0.9rem 0;
  max-width: 100%;
  overflow-x: auto;
}

.aui-md :deep(.aui-mermaid[data-rendered="true"]) {
  cursor: zoom-in;
  border-radius: 0.75rem;
  background: var(--color-paper);
  outline: 1px solid color-mix(in srgb, var(--color-border) 70%, transparent);
  transition: outline-color 200ms, background 200ms;
}

.aui-md :deep(.aui-mermaid[data-rendered="true"]:hover),
.aui-md :deep(.aui-mermaid[data-rendered="true"]:focus-visible) {
  outline-color: var(--color-border);
}

.aui-md :deep(.aui-mermaid img.aui-md-img) {
  margin: 0;
  background: transparent;
}

.aui-md :deep(.aui-mermaid-source) {
  margin: 0;
  overflow-x: auto;
  border: 1px solid color-mix(in srgb, var(--color-border) 70%, transparent);
  border-radius: 0.75rem;
  background: color-mix(in srgb, var(--color-muted) 55%, var(--color-background));
  padding: 0.85rem 1rem;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  line-height: 1.65;
  white-space: pre;
}

/* 表格 */
.aui-md :deep(table) {
  display: block;
  width: 100%;
  max-width: 100%;
  margin: 0.9rem 0;
  overflow-x: auto;
  border-collapse: collapse;
  font-size: 0.8125rem;
}

.aui-md :deep(th),
.aui-md :deep(td) {
  border: 1px solid var(--color-border);
  padding: 0.5rem 0.75rem;
  text-align: left;
  vertical-align: top;
}

.aui-md :deep(th) {
  background: color-mix(in srgb, var(--color-muted) 80%, transparent);
  font-weight: 600;
}

.aui-md :deep(tr:nth-child(even) td) {
  background: color-mix(in srgb, var(--color-muted) 35%, transparent);
}

/* 语法色见 styles/hljs-github.css（GitHub Prettylights） */
</style>

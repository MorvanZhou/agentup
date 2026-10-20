<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import { middleEllipsisFileName } from "../../../../../model/attachment-ref";
import {
  segmentComposerText,
  serializeComposerSegments,
  type ComposerSegment,
} from "../../../../../model/skill-text";

const props = defineProps<{
  modelValue: string;
  knownNames: ReadonlySet<string>;
  disabled?: boolean;
  placeholder?: string;
  height: number;
}>();

export type CaretClientRect = {
  x: number;
  y: number;
  bottom: number;
  height: number;
};

const emit = defineEmits<{
  "update:modelValue": [value: string];
  "update:cursor": [offset: number];
  "update:caret-rect": [rect: CaretClientRect | null];
  keydown: [event: KeyboardEvent];
  /** 点击文件芯片 ×：父级删正文引用并删除 staging 文件。 */
  "remove-file": [path: string];
  paste: [event: ClipboardEvent];
}>();

const editorRef = ref<HTMLDivElement | null>(null);
const composing = ref(false);
let syncing = false;
/** 外部插入 skill/表情后指定的光标；优先于重渲染时保留的旧位置。 */
let preferredCaret: number | null = null;

/** 避免父级每次 render 新建 Set 触发无意义重绘。 */
const knownNamesKey = computed(() => [...props.knownNames].sort().join("\0"));

onMounted(() => {
  renderFromText(props.modelValue);
  emitCaret();
});

watch(
  () => [props.modelValue, knownNamesKey.value] as const,
  ([text]) => {
    if (syncing || composing.value) return;
    const current = serializeEditor();
    const want = preferredCaret;
    const dirty = hasForeignFormatting();
    if (current === text && !dirty) {
      if (want !== null) scheduleCommitCaret(want);
      return;
    }
    // 外部插入时用 preferredCaret；勿回退到旧 getCaretOffset（文末插入会落在新内容前）
    const restore = want ?? getCaretOffset();
    renderFromText(text);
    const target = Math.min(restore, text.length);
    preferredCaret = target;
    // 重绘后 DOM 已是新文本，同步落地；失败再排到下一帧
    if (!commitCaret(target)) scheduleCommitCaret(target);
  },
);

watch(
  () => props.disabled,
  (disabled) => {
    const el = editorRef.value;
    if (!el) return;
    el.contentEditable = disabled ? "false" : "true";
  },
);

onBeforeUnmount(() => {
  syncing = false;
});

function renderFromText(text: string): void {
  const el = editorRef.value;
  if (!el) return;
  el.replaceChildren();
  const segments = segmentComposerText(text, props.knownNames);
  if (!segments.length) {
    el.appendChild(document.createTextNode(""));
    return;
  }
  for (const segment of segments) {
    if (segment.type === "text") {
      // 可编辑区正文与 emoji 同字号、纯文本节点；加大只放只读气泡（见 UserText）。
      el.appendChild(document.createTextNode(segment.value));
    } else if (segment.type === "skill") {
      el.appendChild(createChip(segment.name));
    } else {
      el.appendChild(createFileChip(segment.path, segment.name));
    }
  }
}

/** 浏览器在混排不同 font-size 时常插入 font/span；除 skill 芯片与 br 外一律视为脏。 */
function hasForeignFormatting(): boolean {
  const el = editorRef.value;
  if (!el) return false;
  for (const node of el.querySelectorAll("*")) {
    const html = node as HTMLElement;
    if (html.dataset.skill || html.dataset.file) continue;
    if (html.closest("[data-skill],[data-file]")) continue;
    if (html.tagName === "BR") continue;
    return true;
  }
  return false;
}

function createChip(name: string): HTMLSpanElement {
  const chip = document.createElement("span");
  chip.contentEditable = "false";
  chip.dataset.skill = name;
  chip.className =
    "mx-0.5 inline-flex max-w-full items-center gap-0.5 rounded-md border border-accent/30 bg-accent/10 px-1.5 py-0 align-baseline text-xs font-medium text-accent";
  chip.textContent = `/${name}`;
  return chip;
}

function createFileChip(path: string, name: string): HTMLSpanElement {
  const chip = document.createElement("span");
  chip.contentEditable = "false";
  chip.dataset.file = path;
  chip.className =
    "mx-0.5 inline-flex max-w-full items-center gap-0.5 rounded-md border border-accent/30 bg-accent/10 px-1.5 py-0 align-baseline text-xs font-medium text-accent";
  chip.title = `@${path}`;
  const label = document.createElement("span");
  label.textContent = middleEllipsisFileName(name, 28);
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className =
    "grid size-3.5 shrink-0 place-items-center rounded-sm border-0 bg-transparent p-0 text-accent/70 hover:bg-accent/15 hover:text-accent";
  remove.setAttribute("aria-label", `移除 ${name}`);
  remove.textContent = "×";
  remove.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    emit("remove-file", path);
  });
  chip.append(label, remove);
  return chip;
}

/** 从编辑器收集段，经 serializeComposerSegments 保证 skill 两侧有空格。 */
function serializeEditor(): string {
  const el = editorRef.value;
  if (!el) return "";
  const segments: ComposerSegment[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = (node.textContent ?? "").replace(/\u00a0/g, " ");
      if (value) segments.push({ type: "text", value });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as HTMLElement;
    if (element.dataset.skill) {
      segments.push({ type: "skill", name: element.dataset.skill });
      return;
    }
    if (element.dataset.file) {
      segments.push({
        type: "file",
        path: element.dataset.file,
        name: element.dataset.file.split("/").pop() || element.dataset.file,
      });
      return;
    }
    if (element.tagName === "BR") {
      segments.push({ type: "text", value: "\n" });
      return;
    }
    for (const child of element.childNodes) walk(child);
  };
  for (const child of el.childNodes) walk(child);
  return serializeComposerSegments(segments);
}

function getCaretOffset(): number {
  const el = editorRef.value;
  const selection = window.getSelection();
  if (!el || !selection || selection.rangeCount === 0) return 0;
  const range = selection.getRangeAt(0);
  if (!el.contains(range.startContainer)) return serializeEditor().length;
  const pre = range.cloneRange();
  pre.selectNodeContents(el);
  pre.setEnd(range.startContainer, range.startOffset);
  return measureRangeText(pre).length;
}

function measureRangeText(range: Range): string {
  const frag = range.cloneContents();
  const segments: ComposerSegment[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = (node.textContent ?? "").replace(/\u00a0/g, " ");
      if (value) segments.push({ type: "text", value });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as HTMLElement;
    if (element.dataset.skill) {
      segments.push({ type: "skill", name: element.dataset.skill });
      return;
    }
    if (element.dataset.file) {
      segments.push({
        type: "file",
        path: element.dataset.file,
        name: element.dataset.file.split("/").pop() || element.dataset.file,
      });
      return;
    }
    if (element.tagName === "BR") {
      segments.push({ type: "text", value: "\n" });
      return;
    }
    for (const child of element.childNodes) walk(child);
  };
  for (const child of frag.childNodes) walk(child);
  return serializeComposerSegments(segments);
}

function setCaretOffset(offset: number): void {
  const el = editorRef.value;
  const selection = window.getSelection();
  if (!el || !selection) return;
  // 目标在文末（含插入后）时直接塌到末尾，避免芯片/表情节点计数偏差
  if (offset >= props.modelValue.length && props.modelValue.length > 0) {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    return;
  }
  let remaining = Math.max(0, offset);
  const place = (node: Node): boolean => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      if (remaining <= text.length) {
        const range = document.createRange();
        range.setStart(node, remaining);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        return true;
      }
      remaining -= text.length;
      return false;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    const element = node as HTMLElement;
    if (element.dataset.skill || element.dataset.file) {
      const token = element.dataset.skill
        ? `/${element.dataset.skill}`
        : `@${element.dataset.file}`;
      // 与 serialize 一致：芯片两侧空格由相邻文本节点承担
      if (remaining === 0) {
        const range = document.createRange();
        range.setStartBefore(element);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        return true;
      }
      if (remaining <= token.length) {
        const range = document.createRange();
        range.setStartAfter(element);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        return true;
      }
      remaining -= token.length;
      return false;
    }
    if (element.tagName === "BR") {
      if (remaining <= 1) {
        const range = document.createRange();
        range.setStartAfter(element);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        return true;
      }
      remaining -= 1;
      return false;
    }
    for (const child of element.childNodes) {
      if (place(child)) return true;
    }
    return false;
  };
  for (const child of el.childNodes) {
    if (place(child)) return;
  }
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** 当前选区光标的视口矩形，供 Skill 候选框贴边定位。 */
function getCaretClientRect(): CaretClientRect | null {
  const el = editorRef.value;
  if (!el) return null;
  const fallback = (): CaretClientRect => {
    const box = el.getBoundingClientRect();
    return { x: box.left + 8, y: box.top + 6, bottom: box.top + 22, height: 16 };
  };
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return fallback();
  const range = selection.getRangeAt(0);
  if (!el.contains(range.startContainer)) return fallback();
  let rect = range.getBoundingClientRect();
  if ((rect.width === 0 && rect.height === 0) || (rect.top === 0 && rect.left === 0)) {
    const list = range.getClientRects();
    if (list.length > 0) rect = list[0]!;
    else return fallback();
  }
  return {
    x: rect.left,
    y: rect.top,
    bottom: rect.bottom || rect.top + (rect.height || 16),
    height: rect.height || 16,
  };
}

function emitCaret(): void {
  emit("update:cursor", getCaretOffset());
  emit("update:caret-rect", getCaretClientRect());
}

function emitModel(): void {
  const text = serializeEditor();
  // 再跑一遍 segment→serialize，合并相邻文本并确保 skill 空格边界
  const normalized = serializeComposerSegments(segmentComposerText(text, props.knownNames));
  const next = normalized === text ? text : normalized;
  const dirty = hasForeignFormatting();
  const caret = getCaretOffset();
  syncing = true;
  emit("update:modelValue", next);
  emitCaret();
  void nextTick(() => {
    // 清掉粘贴/历史遗留的 font-size 碎片，保证可视 DOM 与单一字号模型一致
    if (dirty) {
      renderFromText(next);
      setCaretOffset(Math.min(caret, next.length));
    }
    syncing = false;
    emit("update:caret-rect", getCaretClientRect());
  });
}

function onInput(): void {
  if (composing.value) return;
  emitModel();
}

/** 粘贴纯文本时插入并强制渲染芯片（避免 DOM 里仍是裸 `@ATTACHMENTS` / `/skill`）。 */
function onPaste(event: ClipboardEvent): void {
  emit("paste", event);
  if (event.defaultPrevented || props.disabled) return;
  const plain = event.clipboardData?.getData("text/plain");
  if (plain == null || plain === "") return;
  event.preventDefault();
  const { start, end } = getSelectionOffsets();
  const base = serializeEditor();
  const next = `${base.slice(0, start)}${plain}${base.slice(end)}`;
  const cursor = start + plain.length;
  preferredCaret = cursor;
  syncing = true;
  emit("update:modelValue", next);
  emit("update:cursor", cursor);
  renderFromText(next);
  void nextTick(() => {
    if (!commitCaret(cursor)) scheduleCommitCaret(cursor);
    syncing = false;
    emit("update:caret-rect", getCaretClientRect());
  });
}

function getSelectionOffsets(): { start: number; end: number } {
  const el = editorRef.value;
  const selection = window.getSelection();
  if (!el || !selection || selection.rangeCount === 0) {
    const n = serializeEditor().length;
    return { start: n, end: n };
  }
  const range = selection.getRangeAt(0);
  if (!el.contains(range.startContainer) && !el.contains(range.endContainer)) {
    const n = serializeEditor().length;
    return { start: n, end: n };
  }
  const preStart = range.cloneRange();
  preStart.selectNodeContents(el);
  preStart.setEnd(range.startContainer, range.startOffset);
  const start = measureRangeText(preStart).length;
  const preEnd = range.cloneRange();
  preEnd.selectNodeContents(el);
  preEnd.setEnd(range.endContainer, range.endOffset);
  const end = measureRangeText(preEnd).length;
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

function onKeydown(event: KeyboardEvent): void {
  emit("keydown", event);
  if (event.defaultPrevented) return;
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault();
  }
}

function onClick(): void {
  emitCaret();
}

function onKeyup(): void {
  emitCaret();
}

function onCompositionStart(): void {
  composing.value = true;
}

function onCompositionEnd(): void {
  composing.value = false;
  emitModel();
}

function focus(): void {
  editorRef.value?.focus();
}

/** DOM 与 model 已对齐时才消费 preferredCaret，避免 nextTick 抢跑在旧 DOM 上把目标清掉。 */
function canApplyCaret(offset: number): boolean {
  if (offset > props.modelValue.length) return false;
  // 旧 DOM 更短时绝不能落地（文末插入的典型竞态）
  return serializeEditor().length >= props.modelValue.length;
}

function commitCaret(offset: number): boolean {
  if (!canApplyCaret(offset)) return false;
  const el = editorRef.value;
  if (!el) return false;
  el.focus();
  const clamped = Math.max(0, Math.min(offset, props.modelValue.length));
  setCaretOffset(clamped);
  preferredCaret = null;
  emit("update:cursor", clamped);
  emit("update:caret-rect", getCaretClientRect());
  return true;
}

function scheduleCommitCaret(offset: number): void {
  preferredCaret = Math.max(0, offset);
  const tryApply = () => {
    if (preferredCaret === null) return;
    if (commitCaret(preferredCaret)) return;
    // 再等一帧：父级 setText / Teleport 关闭后 DOM 才稳定
    requestAnimationFrame(() => {
      if (preferredCaret === null) return;
      void commitCaret(preferredCaret);
    });
  };
  void nextTick(tryApply);
}

/**
 * 须在外部 setText 之前调用，只记录目标光标。
 * 真正落地由 modelValue watch / scheduleCommitCaret 在 DOM 对齐后完成。
 */
function setCursor(offset: number): void {
  scheduleCommitCaret(offset);
}

defineExpose({ focus, setCursor, getCaretOffset, getCaretClientRect });
</script>

<template>
  <!-- 可在任意位置插入 skill 芯片的 contenteditable 输入 -->
  <div class="relative min-h-0 w-full">
    <div
      v-if="!modelValue"
      class="pointer-events-none absolute inset-0 px-0.5 py-1 text-sm text-muted-foreground/70"
    >
      {{ placeholder }}
    </div>
    <div
      ref="editorRef"
      role="textbox"
      aria-multiline="true"
      :aria-label="placeholder || '消息输入'"
      :aria-disabled="disabled ? 'true' : undefined"
      class="min-h-[1.5rem] w-full whitespace-pre-wrap break-words px-0.5 py-1 text-medium leading-snug outline-none"
      :style="{ minHeight: `${height}px` }"
      :contenteditable="disabled ? 'false' : 'true'"
      @input="onInput"
      @keydown="onKeydown"
      @keyup="onKeyup"
      @click="onClick"
      @paste="onPaste"
      @compositionstart="onCompositionStart"
      @compositionend="onCompositionEnd"
    />
  </div>
</template>

<script setup lang="ts">
import { PaperclipIcon, SmileIcon, SparklesIcon } from "@lucide/vue";
import { nextTick, onBeforeUnmount, ref, watch } from "vue";

import EmojiPicker, { type EmojiPickerAnchor } from "./EmojiPicker.vue";

withDefaults(
  defineProps<{
    /** 禁用 Skill / 附件等可操作项（模型未就绪等）。 */
    disabled?: boolean;
    /** 是否展示附件入口（编辑气泡默认也开）。 */
    showAttachments?: boolean;
  }>(),
  { disabled: false, showAttachments: true },
);

const emit = defineEmits<{
  "open-skill-picker": [];
  "open-emoji-picker": [];
  "insert-emoji": [emoji: string];
  "pick-files": [files: File[]];
}>();

const fileInputRef = ref<HTMLInputElement | null>(null);

const emojiOpen = ref(false);
const emojiBtnRef = ref<HTMLButtonElement | null>(null);
const emojiAnchor = ref<EmojiPickerAnchor | null>(null);

function readEmojiAnchor(): EmojiPickerAnchor | null {
  const el = emojiBtnRef.value;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    bottom: rect.bottom,
    width: rect.width,
  };
}

function syncEmojiAnchor(): void {
  emojiAnchor.value = readEmojiAnchor();
}

function bindAnchorTracking(open: boolean): void {
  window.removeEventListener("scroll", syncEmojiAnchor, true);
  window.removeEventListener("resize", syncEmojiAnchor);
  if (!open) return;
  window.addEventListener("scroll", syncEmojiAnchor, true);
  window.addEventListener("resize", syncEmojiAnchor);
}

function toggleEmojiPicker(): void {
  if (emojiOpen.value) {
    emojiOpen.value = false;
    return;
  }
  syncEmojiAnchor();
  emojiOpen.value = true;
  emit("open-emoji-picker");
  void nextTick(syncEmojiAnchor);
}

function closeEmojiPicker(): void {
  emojiOpen.value = false;
}

function onOpenSkill(): void {
  closeEmojiPicker();
  emit("open-skill-picker");
}

function onInsertEmoji(emoji: string): void {
  emit("insert-emoji", emoji);
}

function onOpenAttach(): void {
  closeEmojiPicker();
  fileInputRef.value?.click();
}

function onFileInputChange(event: Event): void {
  const input = event.target as HTMLInputElement;
  const files = input.files ? Array.from(input.files) : [];
  input.value = "";
  if (files.length) emit("pick-files", files);
}

watch(emojiOpen, bindAnchorTracking, { immediate: true });
onBeforeUnmount(() => bindAnchorTracking(false));

defineExpose({ closeEmojiPicker });
</script>

<template>
  <!-- 输入区工具条：表情 / Skill / 附件 -->
  <div class="flex items-center gap-0.5 pb-1">
    <button
      ref="emojiBtnRef"
      type="button"
      data-emoji-trigger
      class="grid size-8 place-items-center rounded-md border-0 bg-transparent text-muted-foreground transition duration-200 hover:bg-muted hover:text-foreground disabled:opacity-40"
      aria-label="表情"
      title="表情"
      :aria-expanded="emojiOpen"
      :disabled="disabled"
      @click="toggleEmojiPicker"
    >
      <SmileIcon class="size-4" />
    </button>
    <button
      type="button"
      class="grid size-8 place-items-center rounded-md border-0 bg-transparent text-muted-foreground transition duration-200 hover:bg-muted hover:text-foreground disabled:opacity-40"
      aria-label="插入 Skill"
      title="输入 / 选择 Skill"
      :disabled="disabled"
      @click="onOpenSkill"
    >
      <SparklesIcon class="size-4" />
    </button>
    <template v-if="showAttachments">
      <input
        ref="fileInputRef"
        type="file"
        class="hidden"
        multiple
        @change="onFileInputChange"
      />
      <button
        type="button"
        class="grid size-8 place-items-center rounded-md border-0 bg-transparent text-muted-foreground transition duration-200 hover:bg-muted hover:text-foreground disabled:opacity-40"
        aria-label="添加附件"
        title="添加图片或文件"
        :disabled="disabled"
        @click="onOpenAttach"
      >
        <PaperclipIcon class="size-4" />
      </button>
    </template>

    <EmojiPicker
      v-if="emojiOpen"
      :anchor="emojiAnchor"
      @select="onInsertEmoji"
      @close="closeEmojiPicker"
    />
  </div>
</template>

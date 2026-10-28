<script setup lang="ts">
import { ComposerPrimitiveCancel, useAui, useAuiState } from "@assistant-ui/vue";
import type {} from "@assistant-ui/core/store";
import { SendIcon } from "@lucide/vue";
import { computed, nextTick, ref } from "vue";

import { useDesktop } from "../../../../../../../app/desktop";
import { t } from "../../../../../../../shared/model/ui/ui-locale";
import { isImageFile, useComposerFiles } from "../../../../../composables/useComposerFiles";
import { useComposerMentions } from "../../../../../composables/useComposerMentions";
import { useComposerSkills } from "../../../../../composables/useComposerSkills";
import { insertEmojiAt } from "../../../../../model/composer/emoji-data";
import { firstMentionedMemberId } from "../../../../../model/composer/mention-text";
import {
  composerResourceAgentId,
  injectChatSurface,
} from "../../../../../model/thread/chat-surface";
import { injectThreadAgentId } from "../../../../../model/thread/thread-agent-id";
import MentionPicker from "../composer/chips/MentionPicker.vue";
import SkillPicker from "../composer/chips/SkillPicker.vue";
import ComposerSkillInput, {
  type CaretClientRect,
} from "../composer/toolbar/ComposerSkillInput.vue";
import ComposerToolbar from "../composer/toolbar/ComposerToolbar.vue";

const emit = defineEmits<{
  /** 编辑区准备完毕（关选择器、trim），父级决定是否弹回滚确认或直接 send。 */
  resend: [];
}>();

const aui = useAui();
const { session } = useDesktop();
const agentId = injectThreadAgentId();
const surface = injectChatSurface();
const composerText = useAuiState((s) => s.composer.text);

const cursor = ref(0);
const caretRect = ref<CaretClientRect | null>(null);
const skillInputRef = ref<{
  focus: () => void;
  setCursor: (n: number) => void;
  getCaretClientRect: () => CaretClientRect | null;
} | null>(null);
const toolbarRef = ref<{ closeEmojiPicker: () => void } | null>(null);

const token = computed(() => session.value?.token ?? "");
const userId = computed(() => session.value?.userId ?? "");
const members = computed(() => surface.value.mentions);
const editFileAgentId = computed(() =>
  composerResourceAgentId({
    threadAgentId: agentId,
    memberIds: members.value.map((member) => member.id),
    holderId: surface.value.defaultResourceAgentId,
    draftMentionId: firstMentionedMemberId(composerText.value, members.value),
  }),
);
const editPlaceholder = computed(() =>
  members.value.length > 0 ? t("groupEditMessagePlaceholder") : t("editMessagePlaceholder"),
);

const setComposerText = (text: string, nextCursor?: number) => {
  if (typeof nextCursor === "number") {
    cursor.value = nextCursor;
    skillInputRef.value?.setCursor(nextCursor);
    void nextTick(() => {
      caretRect.value = skillInputRef.value?.getCaretClientRect() ?? caretRect.value;
    });
  }
  aui.composer.setText(text);
};

const {
  open: skillPickerOpen,
  filtered: skillPickerItems,
  highlight: skillHighlight,
  knownNames,
  openPicker: openSkillPicker,
  closePicker: closeSkillPicker,
  selectSkill,
  onPickerKeydown: onSkillPickerKeydown,
} = useComposerSkills({
  agentId: computed(() => (surface.value.skills ? agentId : "")),
  token,
  userId,
  composerText,
  cursor,
  setText: setComposerText,
});

const {
  open: mentionOpen,
  filtered: mentionItems,
  highlight: mentionHighlight,
  knownNames: knownMentions,
  openPicker: openMentionPicker,
  closePicker: closeMentionPicker,
  selectMention,
  onPickerKeydown: onMentionPickerKeydown,
} = useComposerMentions({
  members,
  composerText,
  cursor,
  setText: setComposerText,
});

const { stageAndInsertFiles, removeFileRef } = useComposerFiles({
  agentId: editFileAgentId,
  token,
  userId,
  composerText,
  cursor,
  setText: setComposerText,
});

function syncCaret(): void {
  void nextTick(() => {
    caretRect.value = skillInputRef.value?.getCaretClientRect() ?? caretRect.value;
  });
}

function prepareResend(): void {
  closeSkillPicker();
  closeMentionPicker();
  toolbarRef.value?.closeEmojiPicker();
  const text = aui.composer.getState().text;
  const trimmed = text.trim();
  if (trimmed !== text) aui.composer.setText(trimmed);
}

function requestResend(): void {
  prepareResend();
  emit("resend");
}

function onEditTextUpdate(text: string): void {
  aui.composer.setText(text);
}

function onSelectSkill(name: string): void {
  selectSkill(name);
  syncCaret();
}

function onSelectMention(member: { id: string; name: string }): void {
  selectMention(member);
  syncCaret();
}

function onOpenMentionPicker(): void {
  closeSkillPicker();
  openMentionPicker();
  skillInputRef.value?.focus();
  syncCaret();
}

function onOpenSkillPicker(): void {
  if (!surface.value.skills) return;
  closeMentionPicker();
  openSkillPicker();
  skillInputRef.value?.focus();
  syncCaret();
}

function onOpenEmojiPicker(): void {
  closeSkillPicker();
  closeMentionPicker();
  skillInputRef.value?.focus();
}

function onInsertEmoji(emoji: string): void {
  const next = insertEmojiAt(composerText.value, cursor.value, emoji);
  setComposerText(next.text, next.cursor);
}

function onEditPickFiles(files: File[]): void {
  const images = files.filter(isImageFile);
  const others = files.filter((file) => !isImageFile(file));
  for (const image of images) void aui.composer.addAttachment(image);
  void stageAndInsertFiles(others);
}

function onEditPaste(event: ClipboardEvent): void {
  const list = event.clipboardData?.files;
  if (!list?.length) return;
  const files = Array.from(list);
  const others = files.filter((file) => !isImageFile(file));
  if (others.length === 0) return;
  event.preventDefault();
  for (const image of files.filter(isImageFile)) void aui.composer.addAttachment(image);
  void stageAndInsertFiles(others);
}

/** Enter 提交前拦截：先处理 @ / Skill 选择器。 */
function onEditKeydown(event: KeyboardEvent): void {
  if (onMentionPickerKeydown(event)) return;
  if (surface.value.skills && onSkillPickerKeydown(event)) return;
  if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) {
    return;
  }
  event.preventDefault();
  requestResend();
}

function onCancel(): void {
  closeSkillPicker();
  closeMentionPicker();
  toolbarRef.value?.closeEmojiPicker();
}

defineExpose({ prepareResend });
</script>

<template>
  <div
    class="relative flex w-full flex-col gap-2 rounded-lg border border-border bg-background p-2 shadow-sm"
  >
    <SkillPicker
      v-if="surface.skills && skillPickerOpen"
      :skills="skillPickerItems"
      :highlight="skillHighlight"
      :anchor="caretRect"
      @select="onSelectSkill"
      @close="closeSkillPicker"
    />
    <MentionPicker
      v-if="mentionOpen"
      :members="mentionItems"
      :highlight="mentionHighlight"
      :anchor="caretRect"
      @select="onSelectMention"
      @close="closeMentionPicker"
    />
    <ComposerToolbar
      ref="toolbarRef"
      :show-mentions="members.length > 0"
      :show-skills="surface.skills"
      :show-attachments="surface.attachments"
      @open-mention-picker="onOpenMentionPicker"
      @open-skill-picker="onOpenSkillPicker"
      @open-emoji-picker="onOpenEmojiPicker"
      @insert-emoji="onInsertEmoji"
      @pick-files="onEditPickFiles"
    />
    <ComposerSkillInput
      ref="skillInputRef"
      :model-value="composerText"
      :known-names="knownNames"
      :known-mentions="knownMentions"
      :height="96"
      :placeholder="editPlaceholder"
      @update:model-value="onEditTextUpdate"
      @update:cursor="cursor = $event"
      @update:caret-rect="caretRect = $event"
      @keydown="onEditKeydown"
      @remove-file="removeFileRef"
      @paste="onEditPaste"
    />
    <div class="flex justify-end gap-2 text-sm">
      <ComposerPrimitiveCancel
        class="rounded-lg px-2 py-1 text-muted-foreground"
        @click="onCancel"
      >
        Cancel
      </ComposerPrimitiveCancel>
      <button
        type="button"
        class="inline-flex min-h-5 items-center justify-center rounded-lg bg-primary px-2.5 text-xs text-primary-foreground disabled:opacity-50"
        aria-label="重发"
        @click="requestResend"
      >
        <SendIcon class="mr-1 size-3.5" />Send
      </button>
    </div>
  </div>
</template>

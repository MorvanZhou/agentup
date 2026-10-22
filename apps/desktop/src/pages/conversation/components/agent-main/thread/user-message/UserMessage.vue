<script setup lang="ts">
import {
  ActionBarPrimitiveCopy,
  ActionBarPrimitiveEdit,
  ComposerPrimitiveCancel,
  MessagePrimitiveAttachments,
  MessagePrimitiveParts,
  useAui,
  useAuiState,
} from "@assistant-ui/vue";
import type {} from "@assistant-ui/core/store";
import { CheckIcon, CopyIcon, PencilIcon, SendIcon } from "@lucide/vue";
import { computed, nextTick, ref, toRef } from "vue";

import { useDesktop } from "../../../../../../app/desktop";
import AppDialog from "../../../../../../shared/components/AppDialog.vue";
import UserAvatar from "../../../../../../shared/components/UserAvatar.vue";
import { sessionDisplayNickname } from "../../../../../../shared/model/session";
import { isImageFile, useComposerFiles } from "../../../../composables/useComposerFiles";
import { useComposerSkills } from "../../../../composables/useComposerSkills";
import { sanitizeCopiedText, selectionToComposerText } from "../../../../model/composer/copy-text";
import {
  displayRollbackPath,
  filesAffectedByEditResend,
  wouldRollbackFilesOnEdit,
  type RollbackFileImpact,
} from "../../../../model/message/edit-resend-confirm";
import { insertEmojiAt } from "../../../../model/composer/emoji-data";
import { injectThreadAgentId } from "../../../../model/thread/thread-agent-id";
import ImageAttachmentPreview from "../composer/chips/ImageAttachmentPreview.vue";
import SkillPicker from "../composer/chips/SkillPicker.vue";
import ComposerSkillInput, {
  type CaretClientRect,
} from "../composer/toolbar/ComposerSkillInput.vue";
import ComposerToolbar from "../composer/toolbar/ComposerToolbar.vue";
import UserText from "./UserText.vue";

const aui = useAui();
const { session, skipEditResendConfirm, setSkipEditResendConfirm } = useDesktop();
const agentId = injectThreadAgentId();
const editing = useAuiState((s) => s.composer.isEditing);
const composerText = useAuiState((s) => s.composer.text);
const copied = useAuiState((s) => s.message.isCopied);
const messageId = useAuiState((s) => s.message.id);
const threadMessages = useAuiState((s) => s.thread.messages);
const hasAttachments = useAuiState((s) => {
  if (s.message.role !== "user") return false;
  const list = s.message.submission?.attachments ?? s.message.attachments;
  // 气泡附件区只展示图片；文件引用在正文芯片里。
  return (list ?? []).some((item) => item.type === "image" || item.contentType?.startsWith("image/"));
});

const confirmOpen = ref(false);
const skipConfirm = ref(false);
const rollbackFiles = ref<RollbackFileImpact[]>([]);
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
  onPickerKeydown,
} = useComposerSkills({
  agentId: toRef(() => agentId),
  token,
  userId,
  composerText,
  cursor,
  setText: setComposerText,
});

const { stageAndInsertFiles, removeFileRef } = useComposerFiles({
  agentId: toRef(() => agentId),
  token,
  userId,
  composerText,
  cursor,
  setText: setComposerText,
});

/** 选区复制：芯片写成 `/skill`、`@ATTACHMENTS/...`，粘贴进 Composer 可还原。 */
function onBubbleCopy(event: ClipboardEvent): void {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  const cleaned = selectionToComposerText(range);
  if (!cleaned) return;
  event.clipboardData?.setData("text/plain", cleaned);
  event.preventDefault();
}

/** 操作栏复制：消息原文（含 skill / 文件引用标记）。 */
function onActionCopyClick(event: MouseEvent): void {
  event.preventDefault();
  event.stopPropagation();
  const cleaned = sanitizeCopiedText(aui.message.getCopyText());
  if (!cleaned) return;
  void navigator.clipboard.writeText(cleaned).then(() => {
    aui.message.setIsCopied(true);
    window.setTimeout(() => aui.message.setIsCopied(false), 3000);
  });
}

function needsRollbackConfirm(): boolean {
  return wouldRollbackFilesOnEdit(threadMessages.value, messageId.value);
}

function trimEditTextBeforeSend(): void {
  const text = aui.composer.getState().text;
  const trimmed = text.trim();
  if (trimmed !== text) aui.composer.setText(trimmed);
}

function prepareResend(): void {
  closeSkillPicker();
  toolbarRef.value?.closeEmojiPicker();
  trimEditTextBeforeSend();
}

function requestResend(): void {
  prepareResend();
  if (needsRollbackConfirm() && !skipEditResendConfirm.value) {
    skipConfirm.value = false;
    rollbackFiles.value = filesAffectedByEditResend(threadMessages.value, messageId.value);
    confirmOpen.value = true;
    return;
  }
  aui.composer.send();
}

async function confirmResend(): Promise<void> {
  confirmOpen.value = false;
  if (skipConfirm.value) {
    try {
      await setSkipEditResendConfirm(true);
    } catch {
      /* 已 toast；仍继续重发 */
    }
  }
  prepareResend();
  aui.composer.send();
}

function onEditTextUpdate(text: string): void {
  aui.composer.setText(text);
}

function onSelectSkill(name: string): void {
  selectSkill(name);
  void nextTick(() => {
    caretRect.value = skillInputRef.value?.getCaretClientRect() ?? caretRect.value;
  });
}

function onOpenSkillPicker(): void {
  openSkillPicker();
  skillInputRef.value?.focus();
  void nextTick(() => {
    caretRect.value = skillInputRef.value?.getCaretClientRect() ?? caretRect.value;
  });
}

function onOpenEmojiPicker(): void {
  closeSkillPicker();
  skillInputRef.value?.focus();
}

function onInsertEmoji(emoji: string): void {
  const next = insertEmojiAt(composerText.value, cursor.value, emoji);
  cursor.value = next.cursor;
  skillInputRef.value?.setCursor(next.cursor);
  aui.composer.setText(next.text);
  void nextTick(() => {
    caretRect.value = skillInputRef.value?.getCaretClientRect() ?? caretRect.value;
  });
}

function onCaretRect(rect: CaretClientRect | null): void {
  caretRect.value = rect;
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

/** Enter 提交前拦截：先处理 Skill 选择器，再确认回滚。 */
function onEditKeydown(event: KeyboardEvent): void {
  if (onPickerKeydown(event)) return;
  if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) {
    return;
  }
  event.preventDefault();
  requestResend();
}
</script>

<template>
  <li data-role="user" class="group flex flex-row-reverse gap-2.5">
    <!-- 用户头像 -->
    <UserAvatar :name="sessionDisplayNickname(session)" :avatar-url="session?.avatarUrl" size="lg" />

    <div
      class="flex min-w-0 flex-col items-end gap-1"
      :class="editing ? 'w-full max-w-full' : 'max-w-[min(32rem,75%)]'"
    >
      <!-- 编辑（支持 / 插入 Skill，与底栏 Composer 一致） -->
      <div
        v-if="editing"
        class="relative flex w-full flex-col gap-2 rounded-lg border border-border bg-background p-2 shadow-sm"
      >
        <SkillPicker
          v-if="skillPickerOpen"
          :skills="skillPickerItems"
          :highlight="skillHighlight"
          :anchor="caretRect"
          @select="onSelectSkill"
          @close="closeSkillPicker"
        />
        <ComposerToolbar
          ref="toolbarRef"
          @open-skill-picker="onOpenSkillPicker"
          @open-emoji-picker="onOpenEmojiPicker"
          @insert-emoji="onInsertEmoji"
          @pick-files="onEditPickFiles"
        />
        <ComposerSkillInput
          ref="skillInputRef"
          :model-value="composerText"
          :known-names="knownNames"
          :height="96"
          placeholder="编辑消息，输入 / 插入 Skill…"
          @update:model-value="onEditTextUpdate"
          @update:cursor="cursor = $event"
          @update:caret-rect="onCaretRect"
          @keydown="onEditKeydown"
          @remove-file="removeFileRef"
          @paste="onEditPaste"
        />
        <div class="flex justify-end gap-2 text-sm">
          <ComposerPrimitiveCancel
            class="rounded-lg px-2 py-1 text-muted-foreground"
            @click="
              closeSkillPicker();
              toolbarRef?.closeEmojiPicker();
            "
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

      <!-- 用户气泡 -->
      <div
        v-else
        class="min-w-0 max-w-full wrap-break-word overflow-x-hidden rounded-lg rounded-tr-sm bg-primary px-3 py-3 text-sm font-medium leading-snug text-on-primary shadow-sm"
        @copy="onBubbleCopy"
      >
        <!-- 图片缩略图条；非图片文件由 UserText 抽到下方附件行 -->
        <div
          v-if="hasAttachments"
          class="mb-2 flex flex-wrap gap-1.5"
          aria-label="图片附件"
        >
          <MessagePrimitiveAttachments>
            <ImageAttachmentPreview />
          </MessagePrimitiveAttachments>
        </div>
        <MessagePrimitiveParts>
          <template #text>
            <UserText />
          </template>
        </MessagePrimitiveParts>
      </div>

      <!-- 操作栏 -->
      <div
        class="flex flex-row-reverse items-center gap-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
      >
        <ActionBarPrimitiveEdit class="rounded p-1 hover:text-foreground" aria-label="编辑消息">
          <PencilIcon class="size-3.5" />
        </ActionBarPrimitiveEdit>
        <ActionBarPrimitiveCopy
          class="rounded p-1 hover:text-foreground"
          aria-label="复制消息"
          @click="onActionCopyClick"
        >
          <CheckIcon v-if="copied" class="size-3.5" />
          <CopyIcon v-else class="size-3.5" />
        </ActionBarPrimitiveCopy>
      </div>
    </div>

    <!-- 回滚确认 -->
    <AppDialog
      :open="confirmOpen"
      title="重新发送并回滚文件？"
      description="将丢弃这条消息之后的对话，并还原期间经 Write / Edit 改过的工作区文件。Bash 等命令产生的改动不会自动还原。"
      @update:open="confirmOpen = $event"
    >
      <div class="grid gap-3">
        <!-- 将回滚的文件 -->
        <div v-if="rollbackFiles.length" class="grid gap-1.5">
          <p class="m-0 text-xs font-medium text-muted-foreground">
            将回滚 {{ rollbackFiles.length }} 个文件
          </p>
          <ul
            class="m-0 max-h-36 list-none overflow-y-auto rounded-lg border border-rule bg-paper px-2.5 py-1.5"
            aria-label="将回滚的文件"
          >
            <li
              v-for="file in rollbackFiles"
              :key="file.path"
              class="flex min-w-0 items-center gap-2 py-0.5 font-mono text-xs"
              :title="file.path"
            >
              <span class="min-w-0 flex-1 truncate text-foreground">
                {{ displayRollbackPath(file.path) }}
              </span>
              <span
                v-if="file.added > 0 || file.removed > 0"
                class="shrink-0 tabular-nums"
              >
                <span v-if="file.added > 0" class="text-success-foreground">+{{ file.added }}</span>
                <span v-if="file.added > 0 && file.removed > 0" class="text-muted-foreground"> </span>
                <span v-if="file.removed > 0" class="text-destructive">−{{ file.removed }}</span>
              </span>
            </li>
          </ul>
        </div>
        <label class="flex cursor-pointer items-center gap-2 text-sm text-foreground">
          <input
            v-model="skipConfirm"
            type="checkbox"
            class="size-4 rounded border-rule text-accent accent-accent"
          />
          <span>不再提醒</span>
        </label>
      </div>
      <template #footer>
        <button
          type="button"
          class="min-h-8 rounded-lg border border-rule px-3 text-sm font-medium transition duration-200 hover:bg-paper-deep"
          @click="confirmOpen = false"
        >
          取消
        </button>
        <button
          type="button"
          class="min-h-8 rounded-lg bg-accent px-3 text-sm font-semibold text-white transition duration-200 hover:bg-accent-deep"
          @click="confirmResend"
        >
          回滚并重发
        </button>
      </template>
    </AppDialog>
  </li>
</template>

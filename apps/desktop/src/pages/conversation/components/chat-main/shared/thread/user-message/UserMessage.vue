<script setup lang="ts">
import {
  ActionBarPrimitiveCopy,
  ActionBarPrimitiveEdit,
  MessagePrimitiveAttachments,
  MessagePrimitiveParts,
  useAui,
  useAuiState,
} from "@assistant-ui/vue";
import type {} from "@assistant-ui/core/store";
import { CheckIcon, CopyIcon, PencilIcon } from "@lucide/vue";
import { ref } from "vue";

import { useDesktop } from "../../../../../../../app/desktop";
import UserAvatar from "../../../../../../../shared/components/avatar/UserAvatar.vue";
import { sessionDisplayNickname } from "../../../../../../../shared/model/session/session";
import { sanitizeCopiedText, selectionToComposerText } from "../../../../../model/composer/copy-text";
import {
  filesAffectedByEditResend,
  wouldRollbackFilesOnEdit,
  type RollbackFileImpact,
} from "../../../../../model/message/edit-resend-confirm";
import { injectChatMessageFooter, injectChatSurface } from "../../../../../model/thread/chat-surface";
import ImageAttachmentPreview from "../composer/chips/ImageAttachmentPreview.vue";
import ChatBubble from "../../ChatBubble.vue";
import EditResendConfirmDialog from "./EditResendConfirmDialog.vue";
import UserMessageEdit from "./UserMessageEdit.vue";
import UserText from "./UserText.vue";

const aui = useAui();
const { session, skipEditResendConfirm, setSkipEditResendConfirm } = useDesktop();
const surface = injectChatSurface();
const messageFooter = injectChatMessageFooter();
const editing = useAuiState((s) => s.composer.isEditing);
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
const editRef = ref<{ prepareResend: () => void } | null>(null);

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

function onEditResend(): void {
  if (
    wouldRollbackFilesOnEdit(threadMessages.value, messageId.value) &&
    !skipEditResendConfirm.value
  ) {
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
  editRef.value?.prepareResend();
  aui.composer.send();
}
</script>

<template>
  <ChatBubble side="user" :surface="!editing" @copy="onBubbleCopy">
    <template #avatar>
      <UserAvatar :name="sessionDisplayNickname(session)" :avatar-url="session?.avatarUrl" size="lg" />
    </template>

    <UserMessageEdit v-if="editing" ref="editRef" @resend="onEditResend" />
    <template v-else>
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
    </template>
    <template #footer>
      <component :is="messageFooter" v-if="messageFooter && !editing" />
      <!-- 操作栏不进拖选复制 -->
      <div
        class="flex flex-row-reverse items-center gap-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 select-none"
        data-copy-ignore
      >
        <ActionBarPrimitiveEdit
          v-if="surface.editResend"
          class="rounded p-1 hover:text-foreground"
          aria-label="编辑消息"
        >
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
    </template>
  </ChatBubble>

  <EditResendConfirmDialog
    v-model:open="confirmOpen"
    v-model:skip-confirm="skipConfirm"
    :files="rollbackFiles"
    @confirm="confirmResend"
  />
</template>

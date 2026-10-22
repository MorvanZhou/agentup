<script setup lang="ts">
import {
  AttachmentPrimitiveRemove,
  ComposerPrimitiveAttachmentDropzone,
  ComposerPrimitiveAttachments,
  ComposerPrimitiveSend,
  useAui,
  useAuiState,
} from "@assistant-ui/vue";
import type {} from "@assistant-ui/core/store";
import { RouterLink } from "vue-router";
import { SquareIcon, XIcon } from "@lucide/vue";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRef } from "vue";

import { useDesktop } from "../../../../../../app/desktop";
import { t } from "../../../../../../shared/model/ui-locale";
import { useComposerFiles, isImageFile } from "../../../../composables/useComposerFiles";
import { useComposerInputHeight } from "../../../../composables/useComposerHeight";
import { useComposerSkills } from "../../../../composables/useComposerSkills";
import { useSessionModel } from "../../../../composables/useSessionModel";
import { rememberComposerDraft, takeComposerDraft } from "../../../../model/composer-draft";
import { insertEmojiAt } from "../../../../model/emoji-data";
import { injectThreadActions } from "../../../../model/thread-actions";
import { injectThreadAgentId } from "../../../../model/thread-agent-id";
import { injectThreadApproval } from "../../../../model/thread-approval";
import { injectThreadAskUser } from "../../../../model/thread-ask-user";
import { injectThreadExtras } from "../../../../model/thread-extras";
import ImageAttachmentPreview from "./chips/ImageAttachmentPreview.vue";
import SkillPicker from "./chips/SkillPicker.vue";
import ComposerModelPicker from "./toolbar/ComposerModelPicker.vue";
import ComposerSkillInput, {
  type CaretClientRect,
} from "./toolbar/ComposerSkillInput.vue";
import ComposerToolbar from "./toolbar/ComposerToolbar.vue";

const aui = useAui();
const { session } = useDesktop();
const agentId = injectThreadAgentId();
const agentIdRef = computed(() => agentId);
const {
  models: sessionModels,
  currentLabel: sessionModelLabel,
  busy: sessionModelBusy,
  select: selectSessionModel,
} = useSessionModel(agentIdRef);
const extras = injectThreadExtras();
const actions = injectThreadActions();
const askUser = injectThreadAskUser();
const approval = injectThreadApproval();
const composerEl = ref<HTMLElement | null>(null);
const skillInputRef = ref<{
  focus: () => void;
  setCursor: (n: number) => void;
  getCaretClientRect: () => CaretClientRect | null;
} | null>(null);
const toolbarRef = ref<{ closeEmojiPicker: () => void } | null>(null);
const { inputHeight, startResize } = useComposerInputHeight();
const isRunning = useAuiState((state) => state.thread.isRunning);
const messageCount = useAuiState((state) => state.thread.messages.length);
const composerText = useAuiState((state) => state.composer.text);
const cursor = ref(0);
const caretRect = ref<CaretClientRect | null>(null);

const token = computed(() => session.value?.token ?? "");
const userId = computed(() => session.value?.userId ?? "");

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
  setText: (text, nextCursor) => {
    // 先记下目标光标，再改文本，避免 contenteditable 重渲染把光标留在旧位置
    if (typeof nextCursor === "number") {
      cursor.value = nextCursor;
      skillInputRef.value?.setCursor(nextCursor);
    }
    aui.composer.setText(text);
  },
});

const { stageAndInsertFiles, removeFileRef } = useComposerFiles({
  agentId: toRef(() => agentId),
  token,
  userId,
  composerText,
  cursor,
  setText: (text, nextCursor) => {
    if (typeof nextCursor === "number") {
      cursor.value = nextCursor;
      skillInputRef.value?.setCursor(nextCursor);
    }
    aui.composer.setText(text);
  },
});

function onComposerResize(event: PointerEvent): void {
  const host = composerEl.value?.parentElement;
  if (!host) return;
  startResize(event, host);
}

/** AskUser / 审批等待时 isRunning 常为 false，仍应能停止并收起浮层。 */
const hitlPending = computed(() => Boolean(askUser?.value || approval?.value));
const showStop = computed(() => isRunning.value || hitlPending.value);
const synced = computed(() => ({
  ready: Boolean(extras.value.syncedVersion),
  recruited: extras.value.recruited,
  hasMessages: messageCount.value > 0,
  modelConfigured: extras.value.modelConfigured,
  modelLoaded: extras.value.modelLoaded,
}));

const inputDisabled = computed(
  () => !synced.value.ready || !synced.value.modelLoaded || !synced.value.modelConfigured,
);

onMounted(() => {
  const draft = takeComposerDraft(agentId);
  if (draft) aui.composer.setText(draft);
});
onBeforeUnmount(() => {
  rememberComposerDraft(agentId, aui.composer.getState().text);
});

function onComposerTextUpdate(text: string): void {
  aui.composer.setText(text);
}

function trimComposerTextBeforeSend() {
  const text = aui.composer.getState().text;
  const trimmed = text.trim();
  if (trimmed !== text) aui.composer.setText(trimmed);
}

function prepareSend() {
  closeSkillPicker();
  toolbarRef.value?.closeEmojiPicker();
  trimComposerTextBeforeSend();
}

function trySend(): void {
  prepareSend();
  void aui.composer.send();
}

function onComposerSendClick(): void {
  prepareSend();
}

function onComposerInputKeydown(event: KeyboardEvent) {
  if (onPickerKeydown(event)) return;
  if (
    event.key !== "Enter" ||
    event.shiftKey ||
    event.isComposing ||
    event.keyCode === 229
  ) {
    return;
  }
  event.preventDefault();
  trySend();
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

async function onStopTurn() {
  // 先断客户端流（触发 prompt signal abort），再等 runtime busy 真正解开。
  aui.thread.cancelRun();
  aui.composer.cancel();
  await actions?.value.stopTurn();
}

/** 非图片走芯片；图片仍交给附件条。捕获阶段拦截以免 adapter 拒收非图。 */
function onAttachmentDropCapture(event: DragEvent): void {
  const list = event.dataTransfer?.files;
  if (!list?.length) return;
  const files = Array.from(list);
  const images = files.filter(isImageFile);
  const others = files.filter((file) => !isImageFile(file));
  if (others.length === 0) return;
  event.preventDefault();
  event.stopPropagation();
  for (const image of images) void aui.composer.addAttachment(image);
  void stageAndInsertFiles(others);
}

function onComposerPaste(event: ClipboardEvent): void {
  const list = event.clipboardData?.files;
  if (!list?.length) return;
  const files = Array.from(list);
  const images = files.filter(isImageFile);
  const others = files.filter((file) => !isImageFile(file));
  if (others.length === 0 && images.length === 0) return;
  if (others.length > 0) {
    event.preventDefault();
    for (const image of images) void aui.composer.addAttachment(image);
    void stageAndInsertFiles(others);
  }
}

/** 工具栏回形针：可选任意文件，图片进附件条，其它插芯片。 */
function onToolbarPickFiles(files: File[]): void {
  const images = files.filter(isImageFile);
  const others = files.filter((file) => !isImageFile(file));
  for (const image of images) void aui.composer.addAttachment(image);
  void stageAndInsertFiles(others);
}
</script>

<template>
  <div ref="composerEl" class="relative shrink-0 border-t border-border bg-paper">
    <!-- 上缘拖拽：调整输入区高度占比 -->
    <button
      type="button"
      class="app-no-drag absolute inset-x-0 top-0 z-10 h-1.5 -translate-y-1/2 cursor-row-resize border-0 bg-transparent p-0 outline-none transition duration-200 hover:bg-accent/30 focus-visible:bg-accent/40"
      :aria-label="t('composerResize')"
      @pointerdown="onComposerResize"
    />
    <div class="mx-auto w-full">
      <p v-if="synced.ready && !synced.modelLoaded" class="mb-2 text-center text-xs text-muted-foreground" role="status">
        {{ t("composerCheckingModel") }}
      </p>
      <div
        v-if="synced.ready && synced.modelLoaded && !synced.modelConfigured"
        class="mb-2 flex flex-col gap-2 rounded-lg border border-amber-300/40 bg-warning-soft px-3 py-2 text-warning-foreground sm:flex-row sm:items-center sm:justify-between"
        role="status"
      >
        <div>
          <p class="m-0 text-sm font-semibold">{{ t("composerNeedModelTitle") }}</p>
          <p class="mb-0 mt-0.5 text-xs leading-snug opacity-80">
            {{ t("composerNeedModelBody") }}
          </p>
        </div>
        <RouterLink
          :to="{ name: 'settings', query: { section: 'provider' } }"
          class="min-h-8 shrink-0 rounded-lg bg-warning-foreground px-3 py-1.5 text-center text-sm font-semibold text-white no-underline transition duration-200 hover:opacity-90"
        >
          {{ t("composerGoSettings") }}
        </RouterLink>
      </div>
      <p v-if="!synced.ready && synced.hasMessages" class="text-muted-foreground mb-2 text-center text-xs">
        {{ synced.recruited ? t("composerNeedSync") : t("composerNeedRecruit") }}
      </p>

      <ComposerPrimitiveAttachmentDropzone
        class="data-[dragging=true]:border-accent/40 data-[dragging=true]:bg-primary/5 relative flex w-full flex-col bg-background px-2 py-1.5 transition duration-200 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/15"
        @drop.capture="onAttachmentDropCapture"
      >
        <SkillPicker
          v-if="skillPickerOpen && !inputDisabled"
          :skills="skillPickerItems"
          :highlight="skillHighlight"
          :anchor="caretRect"
          @select="onSelectSkill"
          @close="closeSkillPicker"
        />

        <!-- 工具条 -->
        <ComposerToolbar
          ref="toolbarRef"
          :disabled="inputDisabled"
          @open-skill-picker="onOpenSkillPicker"
          @open-emoji-picker="onOpenEmojiPicker"
          @insert-emoji="onInsertEmoji"
          @pick-files="onToolbarPickFiles"
        />

        <!-- 仅图片缩略图 -->
        <div class="flex flex-wrap gap-1.5 empty:hidden px-0.5 pb-1">
          <ComposerPrimitiveAttachments>
            <div class="relative">
              <ImageAttachmentPreview />
              <AttachmentPrimitiveRemove
                class="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full border border-border bg-background text-muted-foreground shadow-sm hover:text-foreground"
                :aria-label="t('composerRemoveImage')"
              >
                <XIcon class="size-2.5" />
              </AttachmentPrimitiveRemove>
            </div>
          </ComposerPrimitiveAttachments>
        </div>

        <ComposerSkillInput
          ref="skillInputRef"
          :model-value="composerText"
          :known-names="knownNames"
          :disabled="inputDisabled"
          :height="inputHeight"
          :placeholder="t('composerPlaceholder')"
          @update:model-value="onComposerTextUpdate"
          @update:cursor="cursor = $event"
          @update:caret-rect="onCaretRect"
          @keydown="onComposerInputKeydown"
          @remove-file="removeFileRef"
          @paste="onComposerPaste"
        />

        <div class="flex items-center justify-end gap-2 pt-2 pb-2 pr-2">
          <!-- 会话级模型：绑定当前 Pi session -->
          <ComposerModelPicker
            :models="sessionModels"
            :current-label="sessionModelLabel"
            :disabled="inputDisabled || showStop"
            :busy="sessionModelBusy"
            @select="selectSessionModel"
          />
          <ComposerPrimitiveSend
            v-if="!showStop"
            class="bg-primary text-primary-foreground min-h-8 rounded-lg px-3 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
            :aria-label="t('composerSend')"
            @click="onComposerSendClick"
          >
            {{ t("composerSend") }}
          </ComposerPrimitiveSend>
          <!-- HITL 等待时 isRunning 常为 false，PrimitiveCancel 会禁用；统一走 stopTurn -->
          <button
            v-else
            type="button"
            class="flex min-h-8 items-center gap-1.5 rounded-lg bg-destructive px-3 text-sm font-semibold text-white transition duration-200 hover:bg-destructive/90"
            :aria-label="t('composerStopAria')"
            @click="onStopTurn"
          >
            <SquareIcon class="size-3 fill-current" />
            {{ t("composerStop") }}
          </button>
        </div>
      </ComposerPrimitiveAttachmentDropzone>
    </div>
  </div>
</template>

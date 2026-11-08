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
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import { useDesktop } from "../../../../../../../app/desktop";
import { DesktopApi, DesktopApiError } from "../../../../../../../shared/api/runtime";
import { readUiLocale, t } from "../../../../../../../shared/model/ui/ui-locale";
import type { ModelAssignmentMode, SessionModelOption } from "../../../../../../../shared/model/runtime/runtime";
import { useComposerFiles, isImageFile } from "../../../../../composables/useComposerFiles";
import { useComposerInputHeight } from "../../../../../composables/useComposerHeight";
import { addComposerImage } from "../../../../../model/composer/add-composer-image";
import {
  injectComposerAttach,
  type ComposerAttachApi,
} from "../../../../../model/composer/composer-attach";
import { useComposerMentions } from "../../../../../composables/useComposerMentions";
import { useComposerSkills } from "../../../../../composables/useComposerSkills";
import { useSessionModel } from "../../../../../composables/useSessionModel";
import {
  composerRunActions,
  composerUsesFollowUpQueue,
} from "../../../../../model/composer/composer-actions";
import { rememberComposerDraft, takeComposerDraft } from "../../../../../model/composer/composer-draft";
import { insertEmojiAt } from "../../../../../model/composer/emoji-data";
import { firstMentionedMemberId } from "../../../../../model/composer/mention-text";
import { injectThreadActions } from "../../../../../model/thread/thread-actions";
import { injectThreadAgentId } from "../../../../../model/thread/thread-agent-id";
import { injectThreadApproval } from "../../../../../model/thread/thread-approval";
import { injectThreadAskUser } from "../../../../../model/thread/thread-ask-user";
import { injectThreadBusyTurn } from "../../../../../model/thread/thread-busy-turn";
import {
  composerResourceAgentId,
  composerShowAttachments,
  injectChatModelMode,
  injectChatSurface,
  injectChatWaveBusy,
  sessionModelAgentId,
} from "../../../../../model/thread/chat-surface";
import { injectThreadExtras } from "../../../../../model/thread/thread-extras";
import { injectThreadRoster, resolveRosterAgent } from "../../../../../model/thread/thread-roster";
import { showToast } from "../../../../../../../shared/model/ui/toast";
import ImageAttachmentPreview from "./chips/ImageAttachmentPreview.vue";
import MentionPicker from "./chips/MentionPicker.vue";
import SkillPicker from "./chips/SkillPicker.vue";
import ComposerModelPicker from "./toolbar/ComposerModelPicker.vue";
import ComposerSkillInput, {
  type CaretClientRect,
} from "./toolbar/ComposerSkillInput.vue";
import ComposerToolbar from "./toolbar/ComposerToolbar.vue";
import ChatComposerFrame from "../../ChatComposerFrame.vue";

const aui = useAui();
const { session } = useDesktop();
const surface = injectChatSurface();
const agentId = injectThreadAgentId();
const roster = injectThreadRoster();
const extras = injectThreadExtras();
const actions = injectThreadActions();
const askUser = injectThreadAskUser();
const approval = injectThreadApproval();
const skillInputRef = ref<{
  focus: () => void;
  setCursor: (n: number) => void;
  getCaretClientRect: () => CaretClientRect | null;
} | null>(null);
const toolbarRef = ref<{ closeEmojiPicker: () => void } | null>(null);
const { inputHeight, startResize } = useComposerInputHeight();
const isRunning = useAuiState((state) => state.thread.isRunning);
const busyTurn = injectThreadBusyTurn();
const messageCount = useAuiState((state) => state.thread.messages.length);
const composerText = useAuiState((state) => state.composer.text);
const modelAgentId = computed(() =>
  sessionModelAgentId({
    threadAgentId: agentId,
    memberIds: surface.value.mentions.map((member) => member.id),
    holderId: surface.value.defaultResourceAgentId,
    draftMentionId: firstMentionedMemberId(composerText.value, surface.value.mentions),
  }),
);
const {
  models: sessionModels,
  current: sessionModelCurrent,
  currentLabel: sessionModelLabel,
  busy: sessionModelBusy,
  modelMode: sessionModelMode,
  select: selectSessionModel,
  setMode: setSessionModelMode,
  state: sessionModelState,
} = useSessionModel(modelAgentId);
const groupModelMode = injectChatModelMode();
/** 群的开关记在房间上；一对一记在这个 Agent 的会话上。 */
const assignmentMode = computed<ModelAssignmentMode>(() =>
  surface.value.groupId
    ? (groupModelMode?.mode.value ?? "unified")
    : sessionModelMode.value,
);
const roomModel = computed(() => groupModelMode?.roomModel.value ?? null);
function namedModel(ref: { templateId: string; modelId: string } | null | undefined): string {
  if (!ref) return "";
  return (
    sessionModels.value.find(
      (model) => model.templateId === ref.templateId && model.modelId === ref.modelId,
    )?.name ?? ref.modelId
  );
}
/** 群单配的按钮是「供应商标叠放 + 各用各的」；统一是「共用 + 供应商标 + 模型名」。 */
const pickerLabel = computed(() => {
  if (surface.value.groupId && assignmentMode.value === "perAgent") {
    return t("composerModelEach");
  }
  if (surface.value.groupId) {
    const ref = roomModel.value ?? sessionModelCurrent.value;
    return namedModel(ref) || sessionModelLabel.value;
  }
  return sessionModelLabel.value;
});
/** 群统一时写在供应商标前面；单配和一对一没有这段。 */
const pickerLabelPrefix = computed(() =>
  surface.value.groupId && assignmentMode.value !== "perAgent" ? t("composerModelRoom") : "",
);
/** 一对一单配只把当前这位放进名单，头像和名字来自侧栏名片。 */
const directMember = computed(() => {
  if (surface.value.groupId || !agentId) return null;
  const card = resolveRosterAgent(roster.value, agentId);
  const named = (card.remark || card.name).trim();
  return {
    id: agentId,
    name: named && named !== agentId ? named : "",
    ...(card.avatarUrl ? { avatarUrl: card.avatarUrl } : {}),
  };
});
const pickerMembers = computed(() =>
  surface.value.groupId ? surface.value.mentions : directMember.value ? [directMember.value] : [],
);
const pickerCurrent = computed(() => {
  if (surface.value.groupId && assignmentMode.value === "perAgent") return null;
  if (surface.value.groupId) return roomModel.value ?? sessionModelCurrent.value;
  return sessionModelCurrent.value;
});
const memberModelApi = new DesktopApi();
const memberModels = ref<Record<string, { templateId: string; modelId: string; name: string }>>({});
/** 会话当前模型就是本地 Agent App（SDK）接入：单聊回合中发送进 followUp 队列。 */
const sdkAccess = computed(() => sessionModelState.value?.followUp === true);
/** 群不接 followUp 队列（走 post+inject）；误入队会被 GroupThread 空实现吞掉。 */
const useFollowUpQueue = computed(() =>
  composerUsesFollowUpQueue({
    followUp: sdkAccess.value,
    groupId: surface.value.groupId,
  }),
);
async function loadMemberModels(): Promise<void> {
  if (!surface.value.groupId || assignmentMode.value !== "perAgent" || !session.value) {
    memberModels.value = {};
    return;
  }
  const tokenValue = session.value.token;
  const user = session.value.userId;
  const locale = readUiLocale();
  const rows = await Promise.all(
    surface.value.mentions.map(async (member) => {
      try {
        const state = await memberModelApi.sessionModel(tokenValue, member.id, user, locale);
        const current = state.current;
        if (!current) return [member.id, null] as const;
        const name =
          state.models.find(
            (model) => model.templateId === current.templateId && model.modelId === current.modelId,
          )?.name ?? current.modelId;
        return [member.id, { templateId: current.templateId, modelId: current.modelId, name }] as const;
      } catch {
        return [member.id, null] as const;
      }
    }),
  );
  const next: Record<string, { templateId: string; modelId: string; name: string }> = {};
  for (const [id, model] of rows) {
    if (model) next[id] = model;
  }
  memberModels.value = next;
}

// 房间每秒刷新会换新的 mentions 数组。用字符串比较，成员没变就不重拉每人的一对一模型。
watch(
  () =>
    [
      assignmentMode.value,
      surface.value.groupId ?? "",
      surface.value.mentions.map((member) => member.id).join("\0"),
    ].join("|"),
  () => {
    void loadMemberModels();
  },
  { immediate: true },
);

async function onSetModelMode(mode: ModelAssignmentMode): Promise<void> {
  if (surface.value.groupId) {
    const hadRoomModel = Boolean(roomModel.value);
    await groupModelMode?.setMode(mode);
    // 第一次切到全员时，把当前开口者的模型抄进这间群，之后私聊再改也不带动群。
    if (mode === "unified" && !hadRoomModel && sessionModelCurrent.value) {
      try {
        await groupModelMode?.setRoomModel(sessionModelCurrent.value);
      } catch (caught) {
        showToast(caught instanceof DesktopApiError ? caught.message : t("composerModelSwitchFailed"), "error");
      }
    }
    return;
  }
  await setSessionModelMode(mode);
}

async function onSelectShownModel(model: SessionModelOption): Promise<void> {
  if (surface.value.groupId && assignmentMode.value === "unified") {
    try {
      await groupModelMode?.setRoomModel({ templateId: model.templateId, modelId: model.modelId });
    } catch (caught) {
      showToast(caught instanceof DesktopApiError ? caught.message : t("composerModelSwitchFailed"), "error");
    }
    return;
  }
  await selectSessionModel(model);
}

async function onSelectMemberModel(agentId: string, model: SessionModelOption): Promise<void> {
  memberModels.value = {
    ...memberModels.value,
    [agentId]: { templateId: model.templateId, modelId: model.modelId, name: model.name },
  };
  if (agentId === modelAgentId.value) {
    await selectSessionModel(model);
    return;
  }
  if (!session.value) return;
  try {
    await memberModelApi.setSessionModel(
      session.value.token,
      agentId,
      session.value.userId,
      { templateId: model.templateId, modelId: model.modelId },
      readUiLocale(),
    );
  } catch (caught) {
    showToast(caught instanceof DesktopApiError ? caught.message : t("composerModelSwitchFailed"), "error");
  }
}

const cursor = ref(0);
const caretRect = ref<CaretClientRect | null>(null);

const token = computed(() => session.value?.token ?? "");
const userId = computed(() => session.value?.userId ?? "");
const members = computed(() => surface.value.mentions);
const resourceAgentId = computed(() =>
  composerResourceAgentId({
    threadAgentId: agentId,
    memberIds: members.value.map((member) => member.id),
    holderId: surface.value.defaultResourceAgentId,
    draftMentionId: firstMentionedMemberId(composerText.value, members.value),
  }),
);
const showAttachments = computed(() =>
  surface.value.groupId
    ? surface.value.attachments && members.value.length > 0
    : composerShowAttachments(surface.value.attachments, resourceAgentId.value),
);

const setComposerText = (text: string, nextCursor?: number) => {
  // 先记下目标光标，再改文本，避免 contenteditable 重渲染把光标留在旧位置
  if (typeof nextCursor === "number") {
    cursor.value = nextCursor;
    skillInputRef.value?.setCursor(nextCursor);
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
  agentId: computed(() => (surface.value.skills ? resourceAgentId.value : "")),
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
  openPicker: openMentionPickerBase,
  closePicker: closeMentionPicker,
  selectMention,
  onPickerKeydown: onMentionPickerKeydown,
} = useComposerMentions({
  members,
  composerText,
  cursor,
  setText: setComposerText,
});

const { stageAndInsertFiles, attachWorkspaceFile, removeFileRef } = useComposerFiles({
  agentId: resourceAgentId,
  groupId: computed(() => surface.value.groupId ?? ""),
  token,
  userId,
  composerText,
  cursor,
  setText: setComposerText,
});

function canTakeFiles(): boolean {
  return surface.value.attachments && Boolean(resourceAgentId.value || surface.value.groupId);
}

/** 侧栏工作区与 Composer 是兄弟节点，经父级 provide 的挂接位注册插入能力。 */
const composerAttachSlot = injectComposerAttach();
const composerAttachApi: ComposerAttachApi = {
  attachWorkspaceFile: async (input) => {
    if (!canTakeFiles()) {
      showToast(t("wsAddToChatUnavailable"), "error");
      return;
    }
    await attachWorkspaceFile(input);
    skillInputRef.value?.focus();
  },
};

function onComposerResize(event: PointerEvent, host: HTMLElement): void {
  startResize(event, host);
}

/** AskUser / 审批 / wake 编排时 isRunning 常为 false，仍应能停止。 */
const hitlPending = computed(() => Boolean(askUser?.value || approval?.value));
const wakeBusy = computed(() => busyTurn?.value?.phase === "wake");
const waveBusy = injectChatWaveBusy();
const tasksBusy = computed(() => waveBusy.value && !isRunning.value);
const turnBusy = computed(
  () => isRunning.value || hitlPending.value || Boolean(wakeBusy.value) || waveBusy.value,
);
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
const hasDraft = computed(() => composerText.value.trim().length > 0);
/** AskUser / 审批 / wake 已经在等用户，不再把自由文本插进当前回复。 */
const steerBlocked = computed(() => hitlPending.value || Boolean(wakeBusy.value));
/**
 * SDK 接入且正处于消费轮（wake）：第二轮不走 assistant-ui 线程，isRunning 不会亮，
 * 但发送仍是入队语义（runtime 的 slot.busy=true 收 POST /follow-ups），
 * 不能被 steerBlocked 封死成「只有停止」。AskUser/审批仍只停不发。
 */
const queueWhileBusy = computed(
  () => useFollowUpQueue.value && Boolean(wakeBusy.value) && !hitlPending.value,
);
const runActions = computed(() =>
  composerRunActions({
    streaming: isRunning.value,
    stopVisible: turnBusy.value,
    tasksBusy: tasksBusy.value,
    queueWhileBusy: queueWhileBusy.value,
    hasText: hasDraft.value,
    inputDisabled: inputDisabled.value,
    steerBlocked: steerBlocked.value,
  }),
);
const showStop = computed(() => runActions.value.stop);
const showSend = computed(() => runActions.value.send);
const showInterruptSend = computed(() => runActions.value.interrupt);
const interrupting = ref(false);
const enqueueing = ref(false);

onMounted(() => {
  if (composerAttachSlot) composerAttachSlot.value = composerAttachApi;
  const draft = takeComposerDraft(agentId);
  if (draft) aui.composer.setText(draft);
});
onBeforeUnmount(() => {
  if (composerAttachSlot?.value === composerAttachApi) composerAttachSlot.value = null;
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
  closeMentionPicker();
  toolbarRef.value?.closeEmojiPicker();
  trimComposerTextBeforeSend();
}

async function trySend(): Promise<void> {
  prepareSend();
  // 单聊 SDK 且这一轮还在跑（含消费轮 wake）：走队列。群聊不进此分支。
  if (useFollowUpQueue.value && (isRunning.value || queueWhileBusy.value)) {
    const text = aui.composer.getState().text.trim();
    if (!text) return;
    await enqueueFollowUp(text);
    return;
  }
  void aui.composer.send();
}

/** 队列发送串行化：避免双击/连按回车重复入队，失败时保留草稿并明确提示。 */
async function enqueueFollowUp(text: string): Promise<void> {
  if (enqueueing.value) return;
  enqueueing.value = true;
  try {
    await actions?.value.enqueueFollowUp?.(text);
    if (aui.composer.getState().text.trim() === text) aui.composer.setText("");
  } catch {
    showToast(t("followUpSendFailed"), "error");
  } finally {
    enqueueing.value = false;
  }
}

function onComposerSendClick(): void {
  prepareSend();
}

function onComposerInputKeydown(event: KeyboardEvent) {
  if (onMentionPickerKeydown(event)) return;
  if (surface.value.skills && onSkillPickerKeydown(event)) return;
  if (
    event.key !== "Enter" ||
    event.shiftKey ||
    event.isComposing ||
    event.keyCode === 229
  ) {
    return;
  }
  event.preventDefault();
  if (showInterruptSend.value) {
    void interruptAndSend();
    return;
  }
  if (showStop.value) return;
  trySend();
}

/**
 * 输出中再发送：先停掉当前 stream，再把这段文字当成新的用户消息发出，
 * 下一条助手消息另起。
 */
function whenRunStops(): Promise<void> {
  if (!isRunning.value) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = watch(isRunning, (running) => {
      if (running) return;
      stop();
      resolve();
    });
  });
}

async function interruptAndSend(): Promise<void> {
  if (interrupting.value || !showInterruptSend.value) return;
  prepareSend();
  const text = aui.composer.getState().text.trim();
  if (!text) return;
  // 群：流中发送 = 落盘用户行 + inject 进当前执掌回合，不停、不进单聊 followUp。
  if (surface.value.groupId) {
    void aui.composer.send();
    return;
  }
  // 单聊 SDK：回合中的新消息进 runtime followUp 队列，不中断当前轮。
  if (useFollowUpQueue.value) {
    await enqueueFollowUp(text);
    return;
  }
  // API / Pi 原生：先试 Pi 原生 steer——插到当前工具批次之后，保留已做的工作（§12.8）。
  // 插不上（会话其实没在跑）才退回「停止 + 重发」。
  // 闪缩高亮只做群聊中途插入（GroupThread）；单聊 steer 不闪，避免每条新消息都晃眼。
  if (await actions?.value.steerTurn?.(text)) {
    aui.composer.setText("");
    return;
  }
  interrupting.value = true;
  try {
    aui.thread.cancelRun();
    await Promise.all([actions?.value.stopTurn(), whenRunStops()]);
    aui.composer.setText(text);
    await nextTick();
    void aui.composer.send();
  } finally {
    interrupting.value = false;
  }
}

function syncCaret(): void {
  void nextTick(() => {
    caretRect.value = skillInputRef.value?.getCaretClientRect() ?? caretRect.value;
  });
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
  openMentionPickerBase();
  skillInputRef.value?.focus();
  syncCaret();
}

function onOpenSkillPicker(): void {
  if (!surface.value.skills || !resourceAgentId.value) return;
  openSkillPicker();
  skillInputRef.value?.focus();
  syncCaret();
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

/** 图片进附件条，其余落盘成芯片。一对一 / 群聊走同一个入口，差别在线程的附件适配器。 */
function takeComposerFiles(files: readonly File[]): void {
  const images = files.filter(isImageFile);
  const others = files.filter((file) => !isImageFile(file));
  for (const image of images) addComposerImage((file) => aui.composer.addAttachment(file), image);
  void stageAndInsertFiles(others);
}

/** 拖拽落进输入区：捕获阶段自己接手，避免附件条拒收非图片，也避免图片被加两次。 */
function onAttachmentDropCapture(event: DragEvent): void {
  if (!canTakeFiles()) return;
  const list = event.dataTransfer?.files;
  if (!list?.length) return;
  event.preventDefault();
  event.stopPropagation();
  takeComposerFiles(Array.from(list));
}

function onComposerPaste(event: ClipboardEvent): void {
  if (!canTakeFiles()) return;
  const list = event.clipboardData?.files;
  if (!list?.length) return;
  const files = Array.from(list);
  if (!files.some((file) => file.size > 0 || file.name)) return;
  // 拦下默认粘贴，避免 contenteditable 写入 [Image: ...] 说明或原尺寸 img。
  event.preventDefault();
  takeComposerFiles(files);
}

/** 工具栏回形针：图片进附件条，其它插芯片。 */
function onToolbarPickFiles(files: File[]): void {
  if (!canTakeFiles()) return;
  takeComposerFiles(files);
}
</script>

<template>
  <ChatComposerFrame @resize="onComposerResize">
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
        class="data-[dragging=true]:border-accent/40 data-[dragging=true]:bg-primary/5 relative flex w-full flex-col bg-transparent px-2 py-1.5 transition duration-200 focus-within:ring-2 focus-within:ring-accent/15"
        @drop.capture="onAttachmentDropCapture"
      >
        <SkillPicker
          v-if="surface.skills && skillPickerOpen && !inputDisabled"
          :skills="skillPickerItems"
          :highlight="skillHighlight"
          :anchor="caretRect"
          @select="onSelectSkill"
          @close="closeSkillPicker"
        />
        <MentionPicker
          v-if="mentionOpen && !inputDisabled"
          :members="mentionItems"
          :highlight="mentionHighlight"
          :anchor="caretRect"
          @select="onSelectMention"
          @close="closeMentionPicker"
        />

        <!-- 工具条 -->
        <ComposerToolbar
          ref="toolbarRef"
          :disabled="inputDisabled"
          :show-mentions="members.length > 0"
          :show-skills="surface.skills && Boolean(resourceAgentId)"
          :show-attachments="showAttachments"
          @open-mention-picker="onOpenMentionPicker"
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
          :known-mentions="knownMentions"
          :disabled="inputDisabled"
          :height="inputHeight"
          :placeholder="surface.placeholder || t('composerPlaceholder')"
          @update:model-value="onComposerTextUpdate"
          @update:cursor="cursor = $event"
          @update:caret-rect="onCaretRect"
          @keydown="onComposerInputKeydown"
          @remove-file="removeFileRef"
          @paste="onComposerPaste"
        />

        <div class="flex items-center justify-end gap-2 pt-2 pb-2 pr-2">
          <!-- 会话级模型：绑定当前 Pi session -->
          <!-- 回合进行中仍可改：只作用于下一次开口或下一张工单 -->
          <ComposerModelPicker
            v-if="surface.modelPicker"
            :models="sessionModels"
            :current="pickerCurrent"
            :current-label="pickerLabel"
            :label-prefix="pickerLabelPrefix"
            :mode="assignmentMode"
            :scope="surface.groupId ? 'group' : 'direct'"
            :show-logo="!(surface.groupId && assignmentMode === 'perAgent')"
            :members="pickerMembers"
            :speaker-id="modelAgentId"
            :member-models="memberModels"
            :disabled="inputDisabled"
            :busy="sessionModelBusy"
            @select="onSelectShownModel"
            @select-member="onSelectMemberModel"
            @set-mode="onSetModelMode"
          />
          <!-- HITL 等待时 isRunning 常为 false，PrimitiveCancel 会禁用；统一走 stopTurn -->
          <button
            v-if="showStop"
            type="button"
            class="flex min-h-8 items-center gap-1.5 rounded-lg bg-destructive px-3 text-sm font-semibold text-white transition duration-200 hover:bg-destructive/90"
            :aria-label="t('composerStopAria')"
            @click="onStopTurn"
          >
            <SquareIcon class="size-3 fill-current" />
            {{ t("composerStop") }}
          </button>
          <button
            v-if="showInterruptSend"
            type="button"
            class="bg-primary text-primary-foreground min-h-8 rounded-lg px-3 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
            :aria-label="t('composerSend')"
            :disabled="interrupting"
            @click="interruptAndSend"
          >
            {{ t("composerSend") }}
          </button>
          <!-- SDK 消费轮（wake）：发送即入队（POST /follow-ups），不走 assistant-ui 的 composer.send -->
          <button
            v-if="showSend && queueWhileBusy"
            type="button"
            class="bg-primary text-primary-foreground min-h-8 rounded-lg px-3 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
            :aria-label="t('composerSend')"
            @click="trySend"
          >
            {{ t("composerSend") }}
          </button>
          <ComposerPrimitiveSend
            v-else-if="showSend && !showInterruptSend"
            class="bg-primary text-primary-foreground min-h-8 rounded-lg px-3 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
            :aria-label="t('composerSend')"
            @click="onComposerSendClick"
          >
            {{ t("composerSend") }}
          </ComposerPrimitiveSend>
        </div>
      </ComposerPrimitiveAttachmentDropzone>
  </ChatComposerFrame>
</template>

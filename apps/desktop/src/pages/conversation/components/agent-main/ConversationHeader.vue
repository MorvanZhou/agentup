<script setup lang="ts">
import { useAuiState } from "@assistant-ui/vue";
import {
  EllipsisVerticalIcon,
  FolderIcon,
  MessageSquarePlusIcon,
  SettingsIcon,
  Trash2Icon,
  UserMinusIcon,
} from "@lucide/vue";
import { computed, ref } from "vue";
import { useRouter } from "vue-router";

import { useDesktop } from "../../../../app/desktop";
import AppDialog from "../../../../shared/components/AppDialog.vue";
import AppDropdownMenu, { type AppDropdownItem } from "../../../../shared/components/AppDropdownMenu.vue";
import { showToast } from "../../../../shared/model/toast";
import { t } from "../../../../shared/model/ui-locale";
import {
  rememberSkipClearContextConfirm,
  shouldSkipClearContextConfirm,
} from "../../model/clear-context-confirm";
import { injectThreadActions } from "../../model/thread-actions";
import { injectThreadApproval } from "../../model/thread-approval";
import { injectThreadAskUser } from "../../model/thread-ask-user";
import { injectThreadExtras } from "../../model/thread-extras";

defineProps<{
  workspaceOpen?: boolean;
}>();

const emit = defineEmits<{
  "toggle-workspace": [];
}>();

const router = useRouter();
const { session } = useDesktop();
const extras = injectThreadExtras();
const actions = injectThreadActions();
const name = computed(() => extras.value.name);
const remark = computed(() => extras.value.remark);
const role = computed(() => extras.value.role);
const title = computed(() => remark.value || name.value || t("threadPick"));
const syncedVersion = computed(() => extras.value.syncedVersion);
const isRunning = useAuiState((state) => state.thread.isRunning);
// AskUser / 审批等待时也视为忙碌（此时 isRunning 常为 false）
const askUser = injectThreadAskUser();
const approval = injectThreadApproval();
const turnBusy = computed(
  () => isRunning.value || Boolean(askUser?.value || approval?.value),
);
const confirmOpen = ref(false);
const skipConfirm = ref(false);
const remarkOpen = ref(false);
const remarkDraft = ref("");
const savingRemark = ref(false);
const confirmDismiss = ref(false);
const confirmClearHistory = ref(false);

const clearDisabled = computed(
  () =>
    !name.value ||
    !syncedVersion.value ||
    extras.value.busy ||
    (actions?.value.clearing ?? false) ||
    (actions?.value.clearingHistory ?? false) ||
    // AskUser 等待时可开新对话（会收起浮层）；仅真正 stream 中禁用
    isRunning.value,
);

const menuItems = computed<AppDropdownItem[]>(() => [
  ...(extras.value.personal
    ? [
        {
          id: "assistant-settings",
          label: t("threadAssistantSettings"),
          icon: SettingsIcon,
        } satisfies AppDropdownItem,
      ]
    : [
        {
          id: "edit-remark",
          label: t("threadRemark"),
          disabled: !name.value || extras.value.busy,
        } satisfies AppDropdownItem,
      ]),
  {
    id: "clear-history",
    label: actions?.value.clearingHistory ? t("threadClearing") : t("threadClear"),
    icon: Trash2Icon,
    disabled: clearDisabled.value,
    danger: true,
  },
  ...(!extras.value.personal
    ? [
        {
          id: "dismiss",
          label: extras.value.busy ? t("threadDismissing") : t("threadDismiss"),
          icon: UserMinusIcon,
          disabled: !name.value || extras.value.busy,
          danger: true,
        } satisfies AppDropdownItem,
      ]
    : []),
]);

function onSelect(id: string): void {
  if (id === "assistant-settings") {
    void router.push({ name: "agents-assistant" });
    return;
  }
  if (!actions) return;
  if (id === "edit-remark") {
    remarkDraft.value = remark.value;
    remarkOpen.value = true;
    return;
  }
  if (id === "clear-history") {
    if (clearDisabled.value) return;
    confirmClearHistory.value = true;
    return;
  }
  if (id === "dismiss") confirmDismiss.value = true;
}

function openClearConfirm(): void {
  if (clearDisabled.value || !actions) return;
  const userId = session.value?.userId ?? "";
  if (shouldSkipClearContextConfirm(userId)) {
    void runClearContext();
    return;
  }
  skipConfirm.value = false;
  confirmOpen.value = true;
}

async function confirmClear(): Promise<void> {
  if (!actions) return;
  const userId = session.value?.userId ?? "";
  if (skipConfirm.value) rememberSkipClearContextConfirm(userId);
  confirmOpen.value = false;
  await runClearContext();
}

async function runClearContext(): Promise<void> {
  if (!actions) return;
  try {
    await actions.value.clearContext();
  } catch (error) {
    showToast(error instanceof Error && error.message ? error.message : t("threadNewFailed"), "error");
  }
}

async function confirmClearHistoryAction(): Promise<void> {
  if (!actions) return;
  confirmClearHistory.value = false;
  try {
    await actions.value.clearHistory();
  } catch (error) {
    showToast(error instanceof Error && error.message ? error.message : t("threadClearFailed"), "error");
  }
}

async function confirmRemark(): Promise<void> {
  if (!actions || savingRemark.value) return;
  savingRemark.value = true;
  try {
    await actions.value.setRemark(remarkDraft.value);
    remarkOpen.value = false;
  } catch (error) {
    showToast(error instanceof Error && error.message ? error.message : t("threadRemarkFailed"), "error");
  } finally {
    savingRemark.value = false;
  }
}

async function confirmDismissAction(): Promise<void> {
  if (!actions) return;
  confirmDismiss.value = false;
  try {
    await actions.value.dismiss();
  } catch (error) {
    showToast(error instanceof Error && error.message ? error.message : t("threadDismissFailed"), "error");
  }
}
</script>

<template>
  <header class="app-drag shrink-0 border-b border-border bg-paper-deep px-1 py-2">
    <!-- 会话顶栏（Electron 可拖拽 / 双击缩放；菜单除外） -->
    <div class="flex h-12 items-center gap-2 px-4">
      <div class="min-w-0 flex-1">
        <h1 class="m-0 truncate text-base font-semibold tracking-tight text-foreground">{{ title }}</h1>
        <p v-if="name && (role || remark || turnBusy)" class="m-0 truncate text-xs text-muted-foreground">
          <span v-if="role">{{ role }}</span>
          <span v-if="remark">{{ role ? " · " : "" }}{{ name }}</span>
          <span v-if="turnBusy">{{ role || remark ? " · " : "" }}{{ t("threadReplying") }}</span>
        </p>
      </div>
      <button
        v-if="name && actions"
        type="button"
        class="app-no-drag inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg border-0 bg-transparent px-3 text-sm font-medium text-foreground outline-none transition duration-200 hover:bg-paper disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-accent/40"
        :disabled="clearDisabled"
        @click="openClearConfirm"
      >
        <MessageSquarePlusIcon class="size-3.5" aria-hidden="true" />
        {{ actions.clearing ? t("threadCreating") : t("threadNew") }}
      </button>
      <button
        v-if="name && actions"
        type="button"
        class="app-no-drag grid size-8 shrink-0 place-items-center rounded-lg border-0 bg-transparent outline-none transition duration-200 hover:bg-paper hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40"
        :class="workspaceOpen ? 'bg-paper text-foreground' : 'text-muted-foreground'"
        :aria-label="t('threadWorkspace')"
        :aria-pressed="Boolean(workspaceOpen)"
        @click="emit('toggle-workspace')"
      >
        <FolderIcon class="size-4" aria-hidden="true" />
      </button>
      <AppDropdownMenu v-if="name && actions" :items="menuItems" @select="onSelect">
        <template #trigger>
          <button
            type="button"
            class="app-no-drag grid size-8 shrink-0 place-items-center rounded-lg border-0 bg-transparent text-muted-foreground outline-none transition duration-200 hover:bg-paper hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40"
            :aria-label="t('threadMenu')"
          >
            <EllipsisVerticalIcon class="size-4" />
          </button>
        </template>
      </AppDropdownMenu>
    </div>
    <AppDialog
      :open="confirmOpen"
      :title="t('threadNewTitle')"
      :description="t('threadNewBody')"
      @update:open="confirmOpen = $event"
    >
      <!-- 不再提醒 -->
      <label class="flex cursor-pointer items-center gap-2 text-sm text-foreground">
        <input
          v-model="skipConfirm"
          type="checkbox"
          class="size-4 rounded border-rule text-accent accent-accent"
        />
        <span>{{ t("threadDontAsk") }}</span>
      </label>
      <template #footer>
        <button
          type="button"
          class="min-h-8 rounded-lg border border-rule px-3 text-sm font-medium transition duration-200 hover:bg-paper-deep"
          @click="confirmOpen = false"
        >
          {{ t("cancel") }}
        </button>
        <button
          type="button"
          class="min-h-8 rounded-lg bg-accent px-3 text-sm font-semibold text-white transition duration-200 hover:bg-accent-deep"
          @click="confirmClear"
        >
          {{ t("threadNew") }}
        </button>
      </template>
    </AppDialog>
    <AppDialog
      :open="remarkOpen"
      :title="t('threadRemarkTitle')"
      :description="t('threadRemarkBody')"
      @update:open="remarkOpen = $event"
    >
      <label class="grid gap-1.5 text-sm">
        <span class="text-muted-foreground">{{ t("threadRemarkLabel") }}</span>
        <input
          v-model="remarkDraft"
          type="text"
          maxlength="40"
          class="min-h-8 rounded-lg border border-rule bg-paper px-3 text-sm outline-none transition duration-200 focus:border-accent focus:ring-2 focus:ring-accent/15"
          :placeholder="t('threadRemarkPlaceholder')"
          @keydown.enter.prevent="confirmRemark"
        />
      </label>
      <template #footer>
        <button
          type="button"
          class="min-h-8 rounded-lg border border-rule px-3 text-sm font-medium transition duration-200 hover:bg-paper-deep"
          :disabled="savingRemark"
          @click="remarkOpen = false"
        >
          {{ t("cancel") }}
        </button>
        <button
          type="button"
          class="min-h-8 rounded-lg bg-accent px-3 text-sm font-semibold text-white transition duration-200 hover:bg-accent-deep disabled:opacity-50"
          :disabled="savingRemark"
          @click="confirmRemark"
        >
          {{ savingRemark ? t("saving") : t("save") }}
        </button>
      </template>
    </AppDialog>
    <AppDialog
      :open="confirmClearHistory"
      :title="t('threadClearTitle')"
      :description="t('threadClearBody')"
      @update:open="confirmClearHistory = $event"
    >
      <template #footer>
        <button
          type="button"
          class="min-h-8 cursor-pointer rounded-lg border border-rule px-3 text-sm font-medium transition duration-200 hover:bg-paper-deep"
          @click="confirmClearHistory = false"
        >
          {{ t("cancel") }}
        </button>
        <button
          type="button"
          class="min-h-8 cursor-pointer rounded-lg bg-destructive px-3 text-sm font-semibold text-white transition duration-200 hover:opacity-90"
          @click="confirmClearHistoryAction"
        >
          {{ t("threadClearConfirm") }}
        </button>
      </template>
    </AppDialog>
    <AppDialog
      :open="confirmDismiss"
      :title="t('threadDismissTitle')"
      :description="t('threadDismissBody')"
      @update:open="confirmDismiss = $event"
    >
      <template #footer>
        <button
          type="button"
          class="min-h-8 cursor-pointer rounded-lg border border-rule px-3 text-sm font-medium transition duration-200 hover:bg-paper-deep"
          @click="confirmDismiss = false"
        >
          {{ t("cancel") }}
        </button>
        <button
          type="button"
          class="min-h-8 cursor-pointer rounded-lg bg-destructive px-3 text-sm font-semibold text-white transition duration-200 hover:opacity-90"
          @click="confirmDismissAction"
        >
          {{ t("threadDismiss") }}
        </button>
      </template>
    </AppDialog>
  </header>
</template>

<script setup lang="ts">
import {
  CheckIcon,
  ChevronLeftIcon,
  EllipsisIcon,
  FilePlusIcon,
  FolderPlusIcon,
  LayoutGridIcon,
  ListIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  XIcon,
} from "@lucide/vue";
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "reka-ui";
import { computed, ref, toRef, watch } from "vue";

import AppDialog from "../../../../../../shared/components/AppDialog.vue";
import PreviewRevealButton from "../../../../../../shared/components/preview/PreviewRevealButton.vue";
import type { WorkspaceEntry } from "../../../../../../shared/api/runtime/workspace";
import { t, tf } from "../../../../../../shared/model/ui/ui-locale";
import { useWorkspace } from "../../../../composables/useWorkspace";
import { joinWorkspacePath } from "../../../../model/workspace/workspace-path";
import { WORKSPACE_TABS, workspaceTabLabel } from "../../../../model/workspace/workspace-roots";
import {
  readWorkspaceSortBy,
  readWorkspaceViewMode,
  sortWorkspaceEntries,
  writeWorkspaceSortBy,
  writeWorkspaceViewMode,
  type WorkspaceSortBy,
  type WorkspaceViewMode,
} from "../../../../model/workspace/workspace-sort";
import WorkspaceBrowser from "./WorkspaceBrowser.vue";
import WorkspacePreview from "./WorkspacePreview.vue";

const props = withDefaults(defineProps<{
  token: string;
  userId: string;
  agentId: string;
  personal: boolean;
  generation: number;
  group?: boolean;
}>(), { group: false });

const emit = defineEmits<{
  close: [];
}>();

const {
  tab,
  setTab,
  directory,
  entries,
  loading,
  error,
  previewPath,
  file,
  draft,
  saving,
  busy,
  previewing,
  dirty,
  title,
  canGoUp,
  canCreate,
  canAddProject,
  atProjectList,
  openEntry,
  back,
  refresh,
  save,
  create,
  rename,
  removeMany,
  reveal,
  revealPreview,
  loadThumbnail,
  attachToChat,
  addProject,
} = useWorkspace({
  token: toRef(props, "token"),
  userId: toRef(props, "userId"),
  agentId: toRef(props, "agentId"),
  personal: toRef(props, "personal"),
  generation: toRef(props, "generation"),
});

const nameOpen = ref(false);
const nameTitle = ref("");
const nameDraft = ref("");
const nameKind = ref<"file" | "dir">("file");
const renameEntry = ref<WorkspaceEntry | null>(null);
const renameDraft = ref("");
const deleteTargets = ref<string[]>([]);
const selected = ref<string[]>([]);
const sortBy = ref<WorkspaceSortBy>(readWorkspaceSortBy());
const viewMode = ref<WorkspaceViewMode>(readWorkspaceViewMode());
const actionsOpen = ref(false);
const createOpen = ref(false);

const showTreeTools = computed(() => !previewing.value);
const showCreateTools = computed(() => showTreeTools.value && canCreate.value);
/** 排序 / 刷新 / 批量删除仍在 … 菜单；新建与挂载提到外层 + */
const showActionsMenu = computed(() => showTreeTools.value);
const sortedEntries = computed(() => sortWorkspaceEntries(entries.value, sortBy.value));
const deleteDescription = computed(() => {
  const targets = deleteTargets.value;
  if (targets.length === 0) return "";
  if (atProjectList.value) {
    if (targets.length === 1) return tf("wsUnmountOne", { name: targets[0] ?? "" });
    return tf("wsUnmountMany", { n: targets.length });
  }
  if (targets.length === 1) {
    const name = targets[0]?.includes("/")
      ? targets[0].slice(targets[0].lastIndexOf("/") + 1)
      : targets[0];
    return tf("wsDeleteOne", { name: name ?? "" });
  }
  return tf("wsDeleteMany", { n: targets.length });
});
const batchSelected = computed(() => selected.value.length > 0);
// 群聊与一对一共用全部 Tab：群的项目挂载由 runtime 群接口提供
const workspaceTabs = computed(() => WORKSPACE_TABS);

watch(directory, () => {
  selected.value = [];
});

watch(entries, (list) => {
  const names = new Set(list.map((entry) => entry.name));
  selected.value = selected.value.filter((name) => names.has(name));
});

function setSortBy(next: WorkspaceSortBy): void {
  sortBy.value = next;
  writeWorkspaceSortBy(next);
}

function setViewMode(next: WorkspaceViewMode): void {
  viewMode.value = next;
  writeWorkspaceViewMode(next);
}

function openCreate(kind: "file" | "dir"): void {
  createOpen.value = false;
  actionsOpen.value = false;
  nameKind.value = kind;
  nameTitle.value = kind === "file" ? t("wsNewFile") : t("wsNewFolder");
  nameDraft.value = "";
  nameOpen.value = true;
}

async function confirmCreate(): Promise<void> {
  const ok = await create(nameKind.value, nameDraft.value);
  if (ok) nameOpen.value = false;
}

function openRename(entry: WorkspaceEntry): void {
  if (atProjectList.value) return;
  renameEntry.value = entry;
  renameDraft.value = entry.name;
}

async function confirmRename(): Promise<void> {
  if (!renameEntry.value) return;
  const ok = await rename(renameEntry.value, renameDraft.value);
  if (ok) renameEntry.value = null;
}

function askRemove(entry: WorkspaceEntry): void {
  deleteTargets.value = [joinWorkspacePath(directory.value, entry.name)];
}

function askRemoveSelected(): void {
  actionsOpen.value = false;
  if (!selected.value.length) return;
  deleteTargets.value = selected.value.map((name) => joinWorkspacePath(directory.value, name));
}

function askRemovePreview(): void {
  if (!previewPath.value) return;
  deleteTargets.value = [previewPath.value];
}

function onRenameOpen(open: boolean): void {
  if (!open) renameEntry.value = null;
}

function onDeleteOpen(open: boolean): void {
  if (!open) deleteTargets.value = [];
}

async function confirmRemove(): Promise<void> {
  const targets = deleteTargets.value;
  deleteTargets.value = [];
  if (!targets.length) return;
  const ok = await removeMany(targets);
  if (ok) selected.value = [];
}

function onRefresh(): void {
  actionsOpen.value = false;
  refresh();
}

function onAddProject(): void {
  actionsOpen.value = false;
  void addProject();
}
</script>

<template>
  <aside class="flex h-full min-h-0 w-full flex-col border-l border-rule bg-paper text-foreground shadow-lg min-[730px]:shadow-none">
    <!-- 工作空间分区 -->
    <nav class="flex h-10 shrink-0 items-stretch gap-1 border-b border-rule px-2" :aria-label="t('wsSections')">
      <button
        v-for="item in workspaceTabs"
        :key="item.id"
        type="button"
        class="min-w-0 flex-1 truncate rounded-lg px-2 text-sm font-medium transition duration-200"
        :class="
          tab === item.id
            ? 'bg-paper-deep text-foreground'
            : 'text-muted-foreground hover:bg-paper-deep/60 hover:text-foreground'
        "
        :aria-pressed="tab === item.id"
        @click="setTab(item.id)"
      >
        {{ workspaceTabLabel(item.id) }}
      </button>
    </nav>
    <!-- 工作空间顶栏 -->
    <header class="flex h-12 shrink-0 items-center gap-1 border-b border-rule px-2">
      <button
        v-if="canGoUp"
        type="button"
        class="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition duration-200 hover:bg-paper-deep hover:text-foreground"
        :aria-label="t('wsBack')"
        @click="back"
      >
        <ChevronLeftIcon class="size-4" />
      </button>
      <h2 class="m-0 min-w-0 flex-1 truncate text-sm font-semibold">{{ title }}</h2>
      <!-- 列表 / 图标视图切换 -->
      <div
        v-if="showTreeTools"
        class="flex shrink-0 items-center rounded-lg border border-rule bg-paper p-0.5"
        role="group"
        :aria-label="t('wsViewMode')"
      >
        <button
          type="button"
          class="grid size-7 place-items-center rounded-md transition duration-200"
          :class="
            viewMode === 'list'
              ? 'bg-paper-deep text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          "
          :aria-label="t('wsViewList')"
          :aria-pressed="viewMode === 'list'"
          @click="setViewMode('list')"
        >
          <ListIcon class="size-3.5" />
        </button>
        <button
          type="button"
          class="grid size-7 place-items-center rounded-md transition duration-200"
          :class="
            viewMode === 'icons'
              ? 'bg-paper-deep text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          "
          :aria-label="t('wsViewIcons')"
          :aria-pressed="viewMode === 'icons'"
          @click="setViewMode('icons')"
        >
          <LayoutGridIcon class="size-3.5" />
        </button>
      </div>
      <!-- 挂载目录：外层 + 直接添加项目目录 -->
      <button
        v-if="canAddProject"
        type="button"
        class="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none transition duration-200 hover:bg-paper-deep hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
        :aria-label="t('wsAddProject')"
        :disabled="busy"
        @click="onAddProject"
      >
        <PlusIcon class="size-4" />
      </button>
      <!-- 输出产物 / 已进挂载目录：+ 下拉新建文件或文件夹 -->
      <DropdownMenuRoot v-if="showCreateTools" v-model:open="createOpen">
        <DropdownMenuTrigger as-child>
          <button
            type="button"
            class="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none transition duration-200 hover:bg-paper-deep hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40"
            :aria-label="t('wsNewActions')"
          >
            <PlusIcon class="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuContent
            align="end"
            :side-offset="6"
            class="app-no-drag z-50 min-w-40 rounded-lg border border-rule bg-paper p-1 text-foreground shadow-md"
          >
            <DropdownMenuItem
              class="flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm outline-none data-[highlighted]:bg-paper-deep"
              @select="openCreate('file')"
            >
              <FilePlusIcon class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span class="min-w-0 flex-1 truncate">{{ t("wsNewFile") }}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              class="flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm outline-none data-[highlighted]:bg-paper-deep"
              @select="openCreate('dir')"
            >
              <FolderPlusIcon class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span class="min-w-0 flex-1 truncate">{{ t("wsNewFolder") }}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </DropdownMenuRoot>
      <!-- 排序 / 刷新 / 批量删除收进 … 菜单 -->
      <DropdownMenuRoot v-if="showActionsMenu" v-model:open="actionsOpen">
        <DropdownMenuTrigger as-child>
          <button
            type="button"
            class="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none transition duration-200 hover:bg-paper-deep hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40"
            :aria-label="t('wsActions')"
          >
            <EllipsisIcon class="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuContent
            align="end"
            :side-offset="6"
            class="app-no-drag z-50 min-w-44 rounded-lg border border-rule bg-paper p-1 text-foreground shadow-md"
          >
            <DropdownMenuLabel class="px-2 py-1.5 text-xs text-muted-foreground">
              {{ t("wsSortBy") }}
            </DropdownMenuLabel>
            <DropdownMenuItem
              class="flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm outline-none data-[highlighted]:bg-paper-deep"
              @select="setSortBy('name')"
            >
              <span class="min-w-0 flex-1 truncate">{{ t("wsSortByName") }}</span>
              <CheckIcon v-if="sortBy === 'name'" class="size-3.5 shrink-0 text-accent" aria-hidden="true" />
            </DropdownMenuItem>
            <DropdownMenuItem
              class="flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm outline-none data-[highlighted]:bg-paper-deep"
              @select="setSortBy('updated')"
            >
              <span class="min-w-0 flex-1 truncate">{{ t("wsSortByUpdated") }}</span>
              <CheckIcon v-if="sortBy === 'updated'" class="size-3.5 shrink-0 text-accent" aria-hidden="true" />
            </DropdownMenuItem>
            <DropdownMenuItem
              class="flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm outline-none data-[highlighted]:bg-paper-deep"
              @select="setSortBy('created')"
            >
              <span class="min-w-0 flex-1 truncate">{{ t("wsSortByCreated") }}</span>
              <CheckIcon v-if="sortBy === 'created'" class="size-3.5 shrink-0 text-accent" aria-hidden="true" />
            </DropdownMenuItem>
            <DropdownMenuSeparator class="my-1 h-px bg-rule" />
            <DropdownMenuItem
              class="flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm outline-none data-[highlighted]:bg-paper-deep data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50"
              :disabled="loading"
              @select="onRefresh"
            >
              <RefreshCwIcon class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span class="min-w-0 flex-1 truncate">{{ t("wsRefresh") }}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              v-if="batchSelected"
              class="flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm text-destructive outline-none data-[highlighted]:bg-danger-soft data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50"
              :disabled="busy"
              @select="askRemoveSelected"
            >
              <Trash2Icon class="size-3.5 shrink-0" aria-hidden="true" />
              <span class="min-w-0 flex-1 truncate">{{ t("wsDeleteSelected") }}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </DropdownMenuRoot>
      <button
        v-if="dirty"
        type="button"
        class="min-h-8 shrink-0 rounded-lg bg-accent px-2 text-sm font-semibold text-white transition duration-200 hover:bg-accent-deep disabled:opacity-50"
        :disabled="saving"
        @click="save"
      >
        {{ saving ? t("saving") : t("save") }}
      </button>
      <PreviewRevealButton v-if="previewing" @click="revealPreview" />
      <button
        v-if="previewing"
        type="button"
        class="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition duration-200 hover:bg-paper-deep hover:text-destructive"
        :aria-label="t('wsDeleteFile')"
        @click="askRemovePreview"
      >
        <Trash2Icon class="size-3.5" />
      </button>
      <button
        type="button"
        class="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition duration-200 hover:bg-paper-deep hover:text-foreground"
        :aria-label="t('wsClose')"
        @click="emit('close')"
      >
        <XIcon class="size-4" />
      </button>
    </header>
    <WorkspaceBrowser
      v-if="!previewing"
      :entries="sortedEntries"
      :directory="directory"
      :loading="loading"
      :error="error"
      :selected="selected"
      :view-mode="viewMode"
      :allow-attach="!atProjectList"
      :load-thumbnail="loadThumbnail"
      @update:selected="selected = $event"
      @open="openEntry"
      @rename="openRename"
      @remove="askRemove"
      @reveal="reveal"
      @attach="attachToChat"
      @retry="refresh"
    />
    <WorkspacePreview
      v-else
      :file="file"
      :loading="loading"
      :draft="draft"
      @update:draft="draft = $event"
      @reveal="revealPreview"
    />
    <AppDialog :open="nameOpen" :title="nameTitle" @update:open="nameOpen = $event">
      <!-- 新建名称 -->
      <label class="grid gap-1.5 text-sm">
        <span class="text-muted-foreground">{{ t("wsName") }}</span>
        <input
          v-model="nameDraft"
          type="text"
          maxlength="255"
          class="min-h-8 rounded-lg border border-rule bg-paper px-3 text-sm outline-none transition duration-200 focus:border-accent focus:ring-2 focus:ring-accent/15"
          @keydown.enter.prevent="confirmCreate"
        />
      </label>
      <template #footer>
        <button
          type="button"
          class="min-h-8 rounded-lg border border-rule px-3 text-sm font-medium transition duration-200 hover:bg-paper-deep"
          @click="nameOpen = false"
        >
          {{ t("cancel") }}
        </button>
        <button
          type="button"
          class="min-h-8 rounded-lg bg-accent px-3 text-sm font-semibold text-white transition duration-200 hover:bg-accent-deep disabled:opacity-50"
          :disabled="busy"
          @click="confirmCreate"
        >
          {{ t("wsCreate") }}
        </button>
      </template>
    </AppDialog>
    <AppDialog
      :open="renameEntry !== null"
      :title="t('wsRename')"
      @update:open="onRenameOpen"
    >
      <!-- 新名称 -->
      <label class="grid gap-1.5 text-sm">
        <span class="text-muted-foreground">{{ t("wsName") }}</span>
        <input
          v-model="renameDraft"
          type="text"
          maxlength="255"
          class="min-h-8 rounded-lg border border-rule bg-paper px-3 text-sm outline-none transition duration-200 focus:border-accent focus:ring-2 focus:ring-accent/15"
          @keydown.enter.prevent="confirmRename"
        />
      </label>
      <template #footer>
        <button
          type="button"
          class="min-h-8 rounded-lg border border-rule px-3 text-sm font-medium transition duration-200 hover:bg-paper-deep"
          @click="renameEntry = null"
        >
          {{ t("cancel") }}
        </button>
        <button
          type="button"
          class="min-h-8 rounded-lg bg-accent px-3 text-sm font-semibold text-white transition duration-200 hover:bg-accent-deep disabled:opacity-50"
          :disabled="busy"
          @click="confirmRename"
        >
          {{ t("save") }}
        </button>
      </template>
    </AppDialog>
    <AppDialog
      :open="deleteTargets.length > 0"
      :title="t('wsDeleteConfirm')"
      :description="deleteDescription"
      @update:open="onDeleteOpen"
    >
      <template #footer>
        <button
          type="button"
          class="min-h-8 rounded-lg border border-rule px-3 text-sm font-medium transition duration-200 hover:bg-paper-deep"
          @click="deleteTargets = []"
        >
          {{ t("cancel") }}
        </button>
        <button
          type="button"
          class="min-h-8 rounded-lg bg-destructive px-3 text-sm font-semibold text-white transition duration-200 hover:opacity-90"
          @click="confirmRemove"
        >
          {{ t("wsDelete") }}
        </button>
      </template>
    </AppDialog>
  </aside>
</template>

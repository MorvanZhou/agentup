<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  EllipsisVerticalIcon,
  FileIcon,
  FolderIcon,
  FolderOpenIcon,
  ImageIcon,
  MessageSquarePlusIcon,
  PencilIcon,
  Trash2Icon,
} from "@lucide/vue";

import AppDropdownMenu, { type AppDropdownItem } from "../../../../../../shared/components/AppDropdownMenu.vue";
import type { WorkspaceEntry } from "../../../../../../shared/api/runtime/workspace";
import { isWorkspaceImagePath } from "../../../../../../shared/workspace-media";
import { t, tf, uiLocale } from "../../../../../../shared/model/ui/ui-locale";
import {
  detectDesktopPlatform,
  revealInFolderLabel,
} from "../../../../../../shared/model/ui/reveal-in-folder";
import { joinWorkspacePath } from "../../../../model/workspace/workspace-path";
import type { WorkspaceViewMode } from "../../../../model/workspace/workspace-sort";
import { formatWorkspaceUpdatedAt } from "../../../../model/workspace/workspace-time";
import {
  shouldLoadWorkspaceThumb,
  workspaceThumbDataUrl,
  type WorkspaceThumbLoader,
} from "../../../../model/workspace/workspace-thumb";

const props = withDefaults(
  defineProps<{
    entries: WorkspaceEntry[];
    directory?: string;
    loading: boolean;
    error: string;
    selected: string[];
    viewMode?: WorkspaceViewMode;
    /** 挂载列表根不提供「添加到对话」。 */
    allowAttach?: boolean;
    loadThumbnail?: WorkspaceThumbLoader;
  }>(),
  { allowAttach: true, viewMode: "list", directory: "" },
);

const emit = defineEmits<{
  open: [entry: WorkspaceEntry];
  rename: [entry: WorkspaceEntry];
  remove: [entry: WorkspaceEntry];
  reveal: [entry: WorkspaceEntry];
  attach: [entry: WorkspaceEntry];
  "update:selected": [names: string[]];
  retry: [];
}>();

const selectedSet = computed(() => new Set(props.selected));
const allSelected = computed(
  () => props.entries.length > 0 && props.entries.every((entry) => selectedSet.value.has(entry.name)),
);
const someSelected = computed(() => props.selected.length > 0);
const isIcons = computed(() => props.viewMode === "icons");
/** name → data URL；加载中 / 失败不写键。 */
const thumbUrls = ref<Record<string, string>>({});
let thumbTicket = 0;

/** 文件与文件夹都可「添加到对话」（挂载列表根由 allowAttach 关掉）。 */
function itemMenu(_entry: WorkspaceEntry): AppDropdownItem[] {
  const items: AppDropdownItem[] = [];
  if (props.allowAttach) {
    items.push({ id: "attach", label: t("wsAddToChat"), icon: MessageSquarePlusIcon });
  }
  items.push(
    { id: "reveal", label: revealInFolderLabel(detectDesktopPlatform()), icon: FolderOpenIcon },
    { id: "rename", label: t("wsRename"), icon: PencilIcon },
    { id: "remove", label: t("wsDelete"), icon: Trash2Icon, danger: true },
  );
  return items;
}

function isSelected(name: string): boolean {
  return selectedSet.value.has(name);
}

function toggle(name: string, checked: boolean): void {
  const next = new Set(props.selected);
  if (checked) next.add(name);
  else next.delete(name);
  emit("update:selected", [...next]);
}

function toggleAll(checked: boolean): void {
  emit("update:selected", checked ? props.entries.map((entry) => entry.name) : []);
}

function onItemMenu(entry: WorkspaceEntry, id: string): void {
  if (id === "attach") emit("attach", entry);
  if (id === "reveal") emit("reveal", entry);
  if (id === "rename") emit("rename", entry);
  if (id === "remove") emit("remove", entry);
}

function updatedLabel(entry: WorkspaceEntry): string {
  return formatWorkspaceUpdatedAt(entry.mtimeMs, uiLocale.value);
}

function isImageEntry(entry: WorkspaceEntry): boolean {
  return entry.kind === "file" && isWorkspaceImagePath(entry.name);
}

watch(
  () =>
    [
      props.viewMode,
      props.directory,
      props.entries.map((entry) => `${entry.name}:${entry.size}:${entry.mtimeMs ?? 0}`).join("|"),
    ] as const,
  () => {
    void loadThumbs();
  },
  { immediate: true },
);

async function loadThumbs(): Promise<void> {
  const ticket = ++thumbTicket;
  thumbUrls.value = {};
  const loader = props.loadThumbnail;
  if (props.viewMode !== "icons" || !loader) return;
  const targets = props.entries.filter(shouldLoadWorkspaceThumb);
  if (!targets.length) return;

  const queue = [...targets];
  const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
    while (queue.length) {
      if (ticket !== thumbTicket) return;
      const entry = queue.shift();
      if (!entry) return;
      const relative = joinWorkspacePath(props.directory, entry.name);
      const payload = await loader(relative);
      if (ticket !== thumbTicket) return;
      if (!payload) continue;
      thumbUrls.value = {
        ...thumbUrls.value,
        [entry.name]: workspaceThumbDataUrl(payload),
      };
    }
  });
  await Promise.all(workers);
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <!-- 批量栏 -->
    <div
      v-if="!loading && !error && entries.length > 0"
      class="flex shrink-0 items-center gap-2 border-b border-rule px-2 py-1.5"
    >
      <label class="flex min-h-7 cursor-pointer items-center gap-2 px-1 text-sm text-foreground">
        <input
          type="checkbox"
          class="size-3.5 rounded border-rule text-accent accent-accent"
          :checked="allSelected"
          :indeterminate.prop="someSelected && !allSelected"
          :aria-label="t('wsSelectAll')"
          @change="toggleAll(($event.target as HTMLInputElement).checked)"
        />
        <span class="text-muted-foreground">
          {{ someSelected ? tf("wsSelected", { n: selected.length }) : t("wsSelectAll") }}
        </span>
      </label>
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto">
      <!-- 目录 -->
      <p v-if="loading" class="px-3 py-6 text-center text-sm text-muted-foreground">{{ t("wsReading") }}</p>
      <div v-else-if="error" class="grid gap-2 px-3 py-6 text-center">
        <p class="text-sm text-destructive">{{ error }}</p>
        <button
          type="button"
          class="mx-auto min-h-8 rounded-lg px-3 text-sm text-foreground transition duration-200 hover:bg-paper-deep"
          @click="emit('retry')"
        >
          {{ t("wsRetry") }}
        </button>
      </div>
      <!-- 空状态 -->
      <p v-else-if="entries.length === 0" class="px-3 py-6 text-center text-sm text-muted-foreground">
        {{ t("wsEmpty") }}
      </p>
      <!-- 图标网格 -->
      <ul
        v-else-if="isIcons"
        class="grid grid-cols-3 gap-1 p-2 sm:grid-cols-4"
      >
        <li
          v-for="entry in entries"
          :key="entry.name"
          class="group relative flex flex-col rounded-xl border border-transparent p-1.5 transition duration-200 hover:border-rule hover:bg-paper-deep/60"
          :class="isSelected(entry.name) ? 'border-rule bg-paper-deep/60' : ''"
        >
          <label class="absolute left-1 top-1 z-10 grid size-5 place-items-center">
            <input
              type="checkbox"
              class="size-3.5 rounded border-rule text-accent accent-accent"
              :checked="isSelected(entry.name)"
              :aria-label="tf('wsSelectEntry', { name: entry.name })"
              @change="toggle(entry.name, ($event.target as HTMLInputElement).checked)"
            />
          </label>
          <AppDropdownMenu :items="itemMenu(entry)" @select="onItemMenu(entry, $event)">
            <template #trigger>
              <button
                type="button"
                class="absolute right-0.5 top-0.5 z-10 grid size-6 place-items-center rounded-md border-0 bg-transparent text-muted-foreground opacity-0 outline-none transition duration-200 hover:bg-paper hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent/40 group-hover:opacity-100"
                :aria-label="tf('wsMoreEntry', { name: entry.name })"
              >
                <EllipsisVerticalIcon class="size-3.5" />
              </button>
            </template>
          </AppDropdownMenu>
          <button
            type="button"
            class="flex w-full flex-col items-center gap-1 rounded-lg px-1 pb-1 pt-4 text-center"
            @click="emit('open', entry)"
          >
            <span
              class="grid size-12 shrink-0 place-items-center overflow-hidden rounded-lg"
              :class="isImageEntry(entry) ? 'bg-muted' : ''"
            >
              <FolderIcon
                v-if="entry.kind === 'dir'"
                class="size-8 text-accent"
                aria-hidden="true"
              />
              <img
                v-else-if="thumbUrls[entry.name]"
                :src="thumbUrls[entry.name]"
                :alt="entry.name"
                class="size-full object-cover"
                draggable="false"
              />
              <ImageIcon
                v-else-if="isImageEntry(entry)"
                class="size-7 text-muted-foreground"
                aria-hidden="true"
              />
              <FileIcon v-else class="size-8 text-muted-foreground" aria-hidden="true" />
            </span>
            <span class="line-clamp-2 w-full break-all text-xs text-foreground">{{ entry.name }}</span>
            <span
              v-if="updatedLabel(entry)"
              class="w-full truncate text-[10px] text-muted-foreground"
            >{{ updatedLabel(entry) }}</span>
          </button>
        </li>
      </ul>
      <!-- 列表 -->
      <ul v-else class="flex flex-col py-1">
        <li
          v-for="entry in entries"
          :key="entry.name"
          class="group flex items-center gap-0.5 px-1"
        >
          <label class="grid size-7 shrink-0 place-items-center">
            <input
              type="checkbox"
              class="size-3.5 rounded border-rule text-accent accent-accent"
              :checked="isSelected(entry.name)"
              :aria-label="tf('wsSelectEntry', { name: entry.name })"
              @change="toggle(entry.name, ($event.target as HTMLInputElement).checked)"
            />
          </label>
          <button
            type="button"
            class="flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left text-sm text-foreground transition duration-200 hover:bg-paper-deep"
            @click="emit('open', entry)"
          >
            <FolderIcon
              v-if="entry.kind === 'dir'"
              class="size-3.5 shrink-0 text-accent"
              aria-hidden="true"
            />
            <FileIcon v-else class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span class="min-w-0 flex-1 truncate">{{ entry.name }}</span>
            <span
              v-if="updatedLabel(entry)"
              class="shrink-0 text-xs text-muted-foreground"
            >{{ updatedLabel(entry) }}</span>
          </button>
          <AppDropdownMenu :items="itemMenu(entry)" @select="onItemMenu(entry, $event)">
            <template #trigger>
              <button
                type="button"
                class="grid size-7 shrink-0 place-items-center rounded-lg border-0 bg-transparent text-muted-foreground outline-none transition duration-200 hover:bg-paper-deep hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40"
                :aria-label="tf('wsMoreEntry', { name: entry.name })"
              >
                <EllipsisVerticalIcon class="size-3.5" />
              </button>
            </template>
          </AppDropdownMenu>
        </li>
      </ul>
    </div>
  </div>
</template>

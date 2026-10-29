<script setup lang="ts">
import { FileIcon, FolderIcon, XIcon } from "@lucide/vue";
import { computed } from "vue";

import {
  isAttachmentFolderPath,
  middleEllipsisFileName,
} from "../../../../../../model/composer/attachment-ref";

const props = withDefaults(
  defineProps<{
    name: string;
    path?: string;
    /** 图片附件的缩略 dataURL；有则显示缩略图代替文件图标（reference 模式附件条）。 */
    image?: string;
    removable?: boolean;
    /** 点击用系统默认应用打开（历史附件行）。 */
    openable?: boolean;
    /** 显式文件夹；未传时看 path 是否以 `/` 结尾。 */
    folder?: boolean;
    /** Composer 用 accent；用户气泡用 on-primary。 */
    variant?: "accent" | "on-primary";
    /** chip：内联；row：历史气泡附件条（单行、不换行）。 */
    layout?: "chip" | "row";
  }>(),
  { variant: "accent", layout: "chip", openable: false },
);

const isFolder = computed(
  () => props.folder === true || (props.path ? isAttachmentFolderPath(props.path) : false),
);

const emit = defineEmits<{
  remove: [];
  open: [];
}>();

const displayName = computed(() =>
  middleEllipsisFileName(props.name, props.layout === "row" ? 22 : 28),
);

const rootClass = computed(() => {
  const interactive = props.openable
    ? props.variant === "on-primary"
      ? " cursor-pointer transition duration-200 hover:bg-white/20"
      : " cursor-pointer transition duration-200 hover:bg-accent/20"
    : "";
  if (props.layout === "row") {
    const base =
      props.variant === "on-primary"
        ? "flex w-full min-w-0 items-center gap-1.5 rounded-md bg-white/12 px-2 py-1.5 text-xs font-medium text-inherit"
        : "flex w-full min-w-0 items-center gap-1.5 rounded-md border border-accent/25 bg-accent/10 px-2 py-1.5 text-xs font-medium text-accent";
    return base + interactive;
  }
  const base =
    props.variant === "on-primary"
      ? "inline-flex max-w-full items-center gap-1 rounded-md border border-white/25 bg-white/15 px-1.5 py-0.5 text-xs font-medium text-inherit"
      : "inline-flex max-w-full items-center gap-1 rounded-md border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-xs font-medium text-accent";
  return base + interactive;
});

const removeClass = computed(() =>
  props.variant === "on-primary"
    ? "opacity-70 hover:bg-white/20 hover:opacity-100"
    : "text-accent/70 hover:bg-accent/15 hover:text-accent",
);

function onActivate(): void {
  if (props.openable) emit("open");
}

function onKeydown(event: KeyboardEvent): void {
  if (!props.openable) return;
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  emit("open");
}
</script>

<template>
  <!-- 文件引用：内联芯片或历史附件行 -->
  <span
    class="font-medium"
    :class="rootClass"
    :data-file="path || undefined"
    :title="path ? `@${path}` : name"
    :role="openable ? 'button' : undefined"
    :tabindex="openable ? 0 : undefined"
    @click="onActivate"
    @keydown="onKeydown"
  >
    <!-- 目录用文件夹图标；图片缩略优先；其余文件图标 -->
    <FolderIcon v-if="!image && isFolder" class="size-3.5 shrink-0 opacity-90" aria-hidden="true" />
    <FileIcon v-else-if="!image" class="size-3.5 shrink-0 opacity-90" aria-hidden="true" />
    <img v-else :src="image" :alt="name" class="shrink-0 rounded-md object-cover" :class="layout === 'row' ? 'size-8' : 'size-5'" />
    <span class="min-w-0 flex-1 truncate whitespace-nowrap font-mono">{{ displayName }}</span>
    <button
      v-if="removable"
      type="button"
      class="grid size-3.5 shrink-0 place-items-center rounded-sm border-0 bg-transparent p-0 transition duration-200"
      :class="removeClass"
      :aria-label="`移除 ${name}`"
      @mousedown.prevent="emit('remove')"
      @click.stop
    >
      <XIcon class="size-3" />
    </button>
  </span>
</template>

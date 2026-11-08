<script setup lang="ts">
import type { Component } from "vue";
import { computed } from "vue";
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "reka-ui";

import AgentAvatar from "./avatar/AgentAvatar.vue";

export type AppDropdownItem = {
  id: string;
  label: string;
  disabled?: boolean;
  /** 禁用或补充说明（次行小字，如职业） */
  hint?: string;
  /** 左侧图标（如 Lucide 组件）；有头像时优先头像 */
  icon?: Component;
  /** 左侧头像：展示名（缺省用 label） */
  avatarName?: string;
  /** 左侧头像 URL；可与 avatarName 搭配 */
  avatarUrl?: string;
  /** 危险操作（如解雇），用破坏性语义色 */
  danger?: boolean;
  /** 选项右侧小红点，仅作提示，不含业务语义 */
  dot?: boolean;
};

const props = withDefaults(
  defineProps<{
    items: AppDropdownItem[];
    align?: "start" | "center" | "end";
    sideOffset?: number;
  }>(),
  {
    align: "end",
    sideOffset: 6,
  },
);

defineEmits<{ select: [id: string] }>();

const hasAvatarRow = computed(() =>
  props.items.some((item) => item.avatarName !== undefined || item.avatarUrl !== undefined),
);

/** 行前是否需要分隔：危险项与上方普通项拉开层次 */
function showSeparatorBefore(index: number): boolean {
  const item = props.items[index];
  const prev = props.items[index - 1];
  return Boolean(item?.danger && prev && !prev.danger);
}

function hasAvatar(item: AppDropdownItem): boolean {
  return item.avatarName !== undefined || item.avatarUrl !== undefined;
}

/** 有次行说明时顶对齐；单行垂直居中 */
function itemAlignClass(item: AppDropdownItem): string {
  return item.hint ? "items-start" : "items-center";
}
</script>

<template>
  <DropdownMenuRoot>
    <!-- 通用下拉菜单：内边距与行距偏松，带 hint / 危险项有独立层次 -->
    <DropdownMenuTrigger as-child>
      <slot name="trigger" />
    </DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent
        :align="align"
        :side-offset="sideOffset"
        class="app-no-drag z-50 flex flex-col gap-0.5 rounded-xl border border-rule bg-paper p-1.5 text-foreground shadow-md"
        :class="hasAvatarRow ? 'min-w-56' : 'min-w-44'"
      >
        <template v-for="(item, index) in items" :key="item.id">
          <!-- 危险操作前分隔线 -->
          <DropdownMenuSeparator
            v-if="showSeparatorBefore(index)"
            class="my-1 h-px bg-rule"
          />
          <DropdownMenuItem
            class="flex cursor-pointer gap-2.5 rounded-lg px-2.5 py-2 text-sm outline-none transition duration-200 data-[disabled]:cursor-not-allowed data-[highlighted]:bg-muted data-[disabled]:opacity-50"
            :class="[
              item.danger ? 'text-destructive data-[highlighted]:bg-danger-soft' : 'text-foreground',
              itemAlignClass(item),
              hasAvatar(item) || item.hint ? 'min-h-11' : 'min-h-9',
            ]"
            :disabled="item.disabled"
            @select="$emit('select', item.id)"
          >
            <!-- 多行时左侧视觉顶对齐主标题行 -->
            <span
              v-if="hasAvatar(item)"
              class="shrink-0"
              :class="item.hint ? 'mt-0.5' : ''"
            >
              <AgentAvatar
                :name="item.avatarName || item.label"
                :avatar-url="item.avatarUrl"
                size="sm"
                round
              />
            </span>
            <component
              :is="item.icon"
              v-else-if="item.icon"
              class="size-4 shrink-0"
              :class="[
                item.danger ? '' : 'text-muted-foreground',
                item.hint ? 'mt-0.5' : '',
              ]"
              aria-hidden="true"
            />
            <span class="min-w-0 flex-1 leading-snug">
              <span class="block truncate">{{ item.label }}</span>
              <span
                v-if="item.hint"
                class="mt-1 block truncate text-xs leading-snug text-muted-foreground"
              >{{ item.hint }}</span>
            </span>
            <span
              v-if="item.dot"
              class="size-1.5 shrink-0 rounded-full bg-destructive"
              :class="item.hint || hasAvatar(item) ? 'mt-1.5' : ''"
              aria-hidden="true"
            />
          </DropdownMenuItem>
        </template>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>

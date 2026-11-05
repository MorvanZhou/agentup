<script setup lang="ts">
import type { Component } from "vue";
import { computed } from "vue";
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
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
</script>

<template>
  <DropdownMenuRoot>
    <!-- 通用下拉菜单 -->
    <DropdownMenuTrigger as-child>
      <slot name="trigger" />
    </DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent
        :align="align"
        :side-offset="sideOffset"
        class="app-no-drag z-50 rounded-lg border border-rule bg-paper p-1 text-foreground shadow-md"
        :class="hasAvatarRow ? 'min-w-56' : 'min-w-36'"
      >
        <DropdownMenuItem
          v-for="item in items"
          :key="item.id"
          class="flex cursor-pointer items-center gap-2 rounded-md px-2 text-sm outline-none transition duration-200 data-[disabled]:cursor-not-allowed data-[highlighted]:bg-paper-deep data-[disabled]:opacity-50"
          :class="[
            item.danger ? 'text-destructive data-[highlighted]:bg-danger-soft' : 'text-foreground',
            item.avatarName !== undefined || item.avatarUrl !== undefined ? 'min-h-10 py-1.5' : 'min-h-8',
          ]"
          :disabled="item.disabled"
          @select="$emit('select', item.id)"
        >
          <AgentAvatar
            v-if="item.avatarName !== undefined || item.avatarUrl !== undefined"
            :name="item.avatarName || item.label"
            :avatar-url="item.avatarUrl"
            size="sm"
            round
          />
          <component
            :is="item.icon"
            v-else-if="item.icon"
            class="size-3.5 shrink-0"
            :class="item.danger ? '' : 'text-muted-foreground'"
            aria-hidden="true"
          />
          <span class="min-w-0 flex-1">
            <span class="block truncate">{{ item.label }}</span>
            <span
              v-if="item.hint"
              class="mt-0.5 block truncate text-xs text-muted-foreground"
            >{{ item.hint }}</span>
          </span>
          <span
            v-if="item.dot"
            class="size-1.5 shrink-0 rounded-full bg-destructive"
            aria-hidden="true"
          />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>

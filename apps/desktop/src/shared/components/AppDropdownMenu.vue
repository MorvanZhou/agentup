<script setup lang="ts">
import type { Component } from "vue";
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from "reka-ui";

export type AppDropdownItem = {
  id: string;
  label: string;
  disabled?: boolean;
  /** 左侧图标（如 Lucide 组件） */
  icon?: Component;
  /** 危险操作（如解雇），用破坏性语义色 */
  danger?: boolean;
  /** 选项右侧小红点，仅作提示，不含业务语义 */
  dot?: boolean;
};

withDefaults(
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
        class="app-no-drag z-50 min-w-36 rounded-lg border border-rule bg-paper p-1 text-foreground shadow-md"
      >
        <DropdownMenuItem
          v-for="item in items"
          :key="item.id"
          class="flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm outline-none transition duration-200 data-[disabled]:cursor-not-allowed data-[highlighted]:bg-paper-deep data-[disabled]:opacity-50"
          :class="item.danger ? 'text-destructive data-[highlighted]:bg-danger-soft' : 'text-foreground'"
          :disabled="item.disabled"
          @select="$emit('select', item.id)"
        >
          <component
            :is="item.icon"
            v-if="item.icon"
            class="size-3.5 shrink-0"
            :class="item.danger ? '' : 'text-muted-foreground'"
            aria-hidden="true"
          />
          <span class="min-w-0 flex-1">{{ item.label }}</span>
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

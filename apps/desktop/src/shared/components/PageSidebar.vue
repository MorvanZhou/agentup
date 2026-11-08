<script setup lang="ts">
import type { Component } from "vue";
import { RouterLink, type RouteLocationRaw } from "vue-router";

export type PageSidebarItem = {
  id: string;
  label: string;
  /** 有 to 时渲染为 RouterLink；否则点选后 emit select */
  to?: RouteLocationRaw;
  /** 可选前缀图标（Lucide 等） */
  icon?: Component;
};

defineProps<{
  title: string;
  ariaLabel: string;
  items: PageSidebarItem[];
  active: string;
  /** 窄屏隐藏标题（Agents 管理侧栏） */
  hideTitleOnNarrow?: boolean;
}>();

const emit = defineEmits<{
  select: [id: string];
}>();

const itemClass =
  "inline-flex min-h-12 shrink-0 items-center gap-2 rounded-lg border-0 bg-transparent px-2.5 text-base font-medium text-muted-foreground no-underline transition duration-200 hover:bg-muted hover:text-foreground min-[730px]:w-full min-[730px]:justify-start";
</script>

<template>
  <!-- 页内分区侧栏：标题 + 横向/纵向导航项 -->
  <nav
    class="app-drag app-titlebar-pad flex max-h-36 min-h-0 flex-col overflow-auto px-2 py-2 min-[730px]:max-h-none min-[730px]:flex-1 min-[730px]:overflow-y-auto min-[730px]:px-2 min-[730px]:py-3"
    :aria-label="ariaLabel"
  >
    <h2
      class="mx-1 mb-3 text-base font-semibold tracking-tight text-foreground min-[730px]:mx-1.5"
      :class="{ 'hidden min-[730px]:block': hideTitleOnNarrow }"
    >
      {{ title }}
    </h2>

    <div
      class="app-no-drag flex gap-1.5 overflow-x-auto min-[730px]:flex-col min-[730px]:gap-0.5 min-[730px]:overflow-visible"
    >
      <template v-for="item in items" :key="item.id">
        <!-- 路由项 -->
        <RouterLink
          v-if="item.to"
          :to="item.to"
          :class="[itemClass, { 'bg-muted! text-foreground!': item.id === active }]"
          :aria-current="item.id === active ? 'page' : undefined"
        >
          <component
            :is="item.icon"
            v-if="item.icon"
            class="size-5 shrink-0"
            aria-hidden="true"
          />
          {{ item.label }}
        </RouterLink>
        <!-- 本页分区项 -->
        <button
          v-else
          type="button"
          :class="[itemClass, { 'bg-muted! text-foreground!': item.id === active }]"
          :aria-current="item.id === active ? 'page' : undefined"
          @click="emit('select', item.id)"
        >
          <component
            :is="item.icon"
            v-if="item.icon"
            class="size-5 shrink-0"
            aria-hidden="true"
          />
          {{ item.label }}
        </button>
      </template>
    </div>
  </nav>
</template>

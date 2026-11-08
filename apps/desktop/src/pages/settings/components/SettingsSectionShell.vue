<script setup lang="ts">
import PageChromeHeader from "../../../shared/components/PageChromeHeader.vue";

withDefaults(
  defineProps<{
    title: string;
    /** 内容区说明；也可用 lead 插槽做条件文案 */
    lead?: string;
    /** 宽内容区（技能网格等）；默认表单宽 max-w-3xl */
    wide?: boolean;
  }>(),
  { wide: false },
);
</script>

<template>
  <!-- 设置主区：顶栏同 Agents/Market，正文滚动；标题在 chrome，说明进内容区 -->
  <main class="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background">
    <PageChromeHeader :title="title">
      <template v-if="$slots.actions" #actions>
        <slot name="actions" />
      </template>
    </PageChromeHeader>

    <div class="min-h-0 flex-1 overflow-auto">
      <div
        class="mx-auto w-full px-4 py-4 sm:px-5 sm:py-5"
        :class="wide ? 'max-w-5xl' : 'max-w-3xl'"
      >
        <p
          v-if="lead || $slots.lead"
          class="mb-6 max-w-xl text-sm leading-snug text-muted-foreground"
        >
          <slot name="lead">{{ lead }}</slot>
        </p>
        <div class="grid gap-6">
          <slot />
        </div>
      </div>
    </div>
  </main>
</template>

<script setup lang="ts">
defineProps<{
  title?: string;
  description?: string;
}>();
</script>

<template>
  <!-- 设置扁平分区：h2 主标题 + 说明，不加 kicker / 纸面卡 -->
  <section class="grid gap-3">
    <header
      v-if="title || description || $slots.actions"
      class="flex flex-wrap items-start justify-between gap-2"
    >
      <div class="min-w-0 flex-1">
        <h2 v-if="title" class="m-0 text-sm font-semibold tracking-tight text-foreground">
          {{ title }}
        </h2>
        <p
          v-if="description"
          class="mb-0 max-w-xl text-xs leading-snug text-muted-foreground"
          :class="title ? 'mt-1' : undefined"
        >
          {{ description }}
        </p>
      </div>
      <div v-if="$slots.actions" class="flex shrink-0 flex-wrap items-center gap-2">
        <slot name="actions" />
      </div>
    </header>
    <slot />
  </section>
</template>

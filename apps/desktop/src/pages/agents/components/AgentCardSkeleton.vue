<script setup lang="ts">
import UiSkeleton from "../../../shared/components/UiSkeleton.vue";
</script>

<template>
  <!-- Agent 市场紧凑卡骨架：身份 + 两行简介 + 底栏 CTA -->
  <article
    class="flex h-full flex-col gap-1.5 rounded-xl border border-rule bg-paper p-2.5 shadow-sm"
    aria-hidden="true"
  >
    <div class="flex items-start gap-2.5">
      <UiSkeleton class="size-12 shrink-0" rounded="lg" />
      <div class="grid min-w-0 flex-1 gap-1.5 pt-0.5">
        <UiSkeleton class="h-4 w-24" />
        <UiSkeleton class="h-3 w-14" />
      </div>
    </div>
    <div class="grid min-h-[2.5rem] flex-1 gap-1">
      <UiSkeleton class="h-3 w-full" />
      <UiSkeleton class="h-3 w-[72%]" />
    </div>
    <div class="mt-auto flex items-center justify-between gap-2 pt-0.5">
      <UiSkeleton class="h-2.5 w-14" />
      <UiSkeleton class="h-7 w-14 shrink-0" rounded="lg" />
    </div>
  </article>
</template>

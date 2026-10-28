<script setup lang="ts">
import type { FileDiffLine } from "./tool-file-view";

defineProps<{
  lines: readonly FileDiffLine[];
}>();

function rowClass(kind: FileDiffLine["kind"]): string {
  if (kind === "add") return "bg-success-soft/70 text-success-foreground";
  if (kind === "remove") return "bg-danger-soft/80 text-destructive";
  return "text-muted-foreground";
}

function gutter(kind: FileDiffLine["kind"]): string {
  if (kind === "add") return "+";
  if (kind === "remove") return "−";
  return " ";
}
</script>

<template>
  <!-- 类 git diff 行块 -->
  <div class="bg-paper min-w-0 overflow-hidden rounded-md">
    <div class="max-h-72 overflow-auto font-mono text-xs leading-5" role="text">
      <div
        v-for="(line, index) in lines"
        :key="index"
        class="flex w-max min-w-full"
        :class="rowClass(line.kind)"
      >
        <span
          class="w-4 shrink-0 select-none text-center opacity-70"
          aria-hidden="true"
        >{{ gutter(line.kind) }}</span>
        <span class="whitespace-pre pr-2">{{
          line.text.length ? line.text : " "
        }}</span>
      </div>
    </div>
  </div>
</template>

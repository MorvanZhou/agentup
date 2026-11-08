<script setup lang="ts">
defineProps<{
  selected?: boolean;
  disabled?: boolean;
  /** 主文案旁的次要说明 */
  hint?: string;
}>();
</script>

<template>
  <!-- 设置选项砖：灰阶选中，与侧栏 activated 同构 -->
  <button
    type="button"
    :disabled="disabled"
    class="rounded-xl border px-3 py-3 text-left transition duration-200 disabled:opacity-50"
    :class="
      selected
        ? 'border-foreground/20 bg-muted text-foreground'
        : 'border-rule bg-paper text-foreground hover:bg-muted'
    "
  >
    <span class="block text-sm font-semibold text-foreground">
      <slot />
    </span>
    <span
      v-if="hint || $slots.hint"
      class="mt-1 block text-xs leading-snug text-muted-foreground"
    >
      <slot name="hint">{{ hint }}</slot>
    </span>
  </button>
</template>

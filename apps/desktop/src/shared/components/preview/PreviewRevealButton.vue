<script setup lang="ts">
import { computed } from "vue";
import { FolderOpenIcon } from "@lucide/vue";

import { detectDesktopPlatform, revealInFolderLabel } from "../../model/ui/reveal-in-folder";

const props = withDefaults(
  defineProps<{
    disabled?: boolean;
  }>(),
  { disabled: false },
);

const emit = defineEmits<{
  click: [];
}>();

const label = computed(() => revealInFolderLabel(detectDesktopPlatform()));
</script>

<template>
  <!-- 在系统文件管理器中显示文件所在位置 -->
  <button
    type="button"
    class="grid size-7 place-items-center rounded-lg text-muted-foreground transition duration-200 hover:bg-paper-deep hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
    :aria-label="label"
    :title="label"
    :disabled="props.disabled"
    @click="emit('click')"
  >
    <FolderOpenIcon class="size-3.5" aria-hidden="true" />
  </button>
</template>

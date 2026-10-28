<script setup lang="ts">
import { t } from "../../../../../shared/model/ui/ui-locale";

defineProps<{ label: string; busy?: boolean }>();
const emit = defineEmits<{ cancel: [] }>();
</script>

<template>
  <article class="w-full rounded-xl border border-rule bg-paper p-3">
    <p class="m-0 text-sm text-foreground">{{ label }}</p>
    <button
      type="button"
      class="mt-2 inline-flex min-h-8 cursor-pointer items-center rounded-lg border border-rule bg-paper px-3 text-sm"
      :disabled="busy"
      @click="emit('cancel')"
    >
      {{ t("groupQueueCancel") }}
    </button>
  </article>
</template>

<script setup lang="ts">
import { ChevronDownIcon } from "@lucide/vue";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { RouterLink } from "vue-router";

import type { SessionModelOption } from "../../../../../../../shared/model/runtime/runtime";
import { t } from "../../../../../../../shared/model/ui/ui-locale";

const props = defineProps<{
  models: SessionModelOption[];
  currentLabel: string;
  disabled?: boolean;
  busy?: boolean;
}>();

const emit = defineEmits<{
  select: [model: SessionModelOption];
}>();

const open = ref(false);
const rootRef = ref<HTMLElement | null>(null);

const hasModels = computed(() => props.models.length > 0);

function toggle(): void {
  if (props.disabled || props.busy || !hasModels.value) return;
  open.value = !open.value;
}

function close(): void {
  open.value = false;
}

function onSelect(model: SessionModelOption): void {
  emit("select", model);
  close();
}

function onDocPointer(event: PointerEvent): void {
  if (!open.value || !rootRef.value) return;
  if (rootRef.value.contains(event.target as Node)) return;
  close();
}

watch(open, (value) => {
  if (value) document.addEventListener("pointerdown", onDocPointer, true);
  else document.removeEventListener("pointerdown", onDocPointer, true);
});
onBeforeUnmount(() => document.removeEventListener("pointerdown", onDocPointer, true));
</script>

<template>
  <div ref="rootRef" class="relative">
    <button
      v-if="hasModels"
      type="button"
      class="flex max-w-[12rem] items-center gap-1 rounded-lg border border-rule bg-paper px-2 py-1 text-xs font-medium text-foreground transition duration-200 hover:bg-muted disabled:opacity-40"
      :disabled="disabled || busy"
      :aria-expanded="open"
      :aria-label="t('composerModelPickerAria')"
      @click="toggle"
    >
      <span class="truncate">{{ currentLabel || t("composerModelPick") }}</span>
      <ChevronDownIcon class="size-3.5 shrink-0 text-muted-foreground" />
    </button>
    <RouterLink
      v-else
      :to="{ name: 'settings', query: { section: 'provider' } }"
      class="rounded-lg border border-rule bg-paper px-2 py-1 text-xs font-medium text-muted-foreground no-underline transition duration-200 hover:text-foreground"
    >
      {{ t("composerModelSetup") }}
    </RouterLink>

    <ul
      v-if="open && hasModels"
      class="absolute bottom-full right-0 z-20 mb-1 max-h-56 min-w-[14rem] list-none overflow-auto rounded-lg border border-rule bg-background p-1 shadow-sm"
      role="listbox"
    >
      <li v-for="model in models" :key="`${model.templateId}::${model.modelId}`" class="m-0 p-0">
        <button
          type="button"
          class="flex w-full flex-col items-start gap-0.5 rounded-md border-0 bg-transparent px-2 py-1.5 text-left transition duration-200 hover:bg-paper"
          role="option"
          @click="onSelect(model)"
        >
          <span class="truncate text-sm font-medium text-foreground">{{ model.name }}</span>
          <span class="truncate text-xs text-muted-foreground">
            {{ model.vendorLabel }}
            <template v-if="model.optionLabel !== model.vendorLabel">
              · {{ model.optionLabel }}
            </template>
          </span>
        </button>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { ChevronLeftIcon, ChevronRightIcon } from "@lucide/vue";
import { computed, ref, watch } from "vue";

import {
  OFFICIAL_AVATARS,
  OFFICIAL_AVATAR_PAGE_SIZE,
  type OfficialAvatarId,
} from "../../model/avatar/official-avatars";
import { t } from "../../model/ui/ui-locale";

const props = defineProps<{
  selectedId?: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  select: [id: OfficialAvatarId];
}>();

const page = ref(0);
const pageCount = Math.ceil(OFFICIAL_AVATARS.length / OFFICIAL_AVATAR_PAGE_SIZE);
const visible = computed(() => {
  const start = page.value * OFFICIAL_AVATAR_PAGE_SIZE;
  return OFFICIAL_AVATARS.slice(start, start + OFFICIAL_AVATAR_PAGE_SIZE);
});

function shift(delta: number): void {
  page.value = (page.value + delta + pageCount) % pageCount;
}

watch(
  () => props.selectedId,
  (id) => {
    if (!id) return;
    const index = OFFICIAL_AVATARS.findIndex((item) => item.id === id);
    if (index < 0) return;
    page.value = Math.floor(index / OFFICIAL_AVATAR_PAGE_SIZE);
  },
);
</script>

<template>
  <div class="grid gap-1.5">
    <div class="flex items-center justify-between gap-2">
      <span class="text-xs font-medium text-muted-foreground">{{ t("officialAvatars") }}</span>
      <span class="text-xs tabular-nums text-muted-foreground">{{ page + 1 }}/{{ pageCount }}</span>
    </div>
    <div class="flex items-start gap-1">
      <button
        type="button"
        class="mt-3.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-rule bg-paper text-foreground outline-none transition duration-200 hover:bg-accent/10 focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-50"
        :aria-label="t('officialAvatarsPrev')"
        :disabled="disabled"
        @click="shift(-1)"
      >
        <ChevronLeftIcon class="size-3.5" aria-hidden="true" />
      </button>
      <div class="grid min-w-0 flex-1 grid-cols-5 gap-1" role="listbox" :aria-label="t('officialAvatars')">
        <button
          v-for="avatar in visible"
          :key="avatar.id"
          type="button"
          role="option"
          class="flex min-w-0 flex-col items-center gap-1 rounded-lg px-0.5 py-1 outline-none transition duration-200 hover:bg-muted focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-50"
          :aria-selected="selectedId === avatar.id"
          :disabled="disabled"
          @click="emit('select', avatar.id)"
        >
          <span class="rounded-lg p-0.5" :class="selectedId === avatar.id ? 'bg-accent' : 'bg-transparent'">
            <img :src="avatar.url" alt="" class="size-12 rounded-md object-cover" draggable="false" />
          </span>
          <span class="w-full truncate text-center text-[11px] leading-none text-muted-foreground">
            {{ t(avatar.labelKey) }}
          </span>
        </button>
      </div>
      <button
        type="button"
        class="mt-3.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-rule bg-paper text-foreground outline-none transition duration-200 hover:bg-accent/10 focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-50"
        :aria-label="t('officialAvatarsNext')"
        :disabled="disabled"
        @click="shift(1)"
      >
        <ChevronRightIcon class="size-3.5" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>

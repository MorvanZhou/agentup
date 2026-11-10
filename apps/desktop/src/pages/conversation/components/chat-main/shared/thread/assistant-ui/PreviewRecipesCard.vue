<script setup lang="ts">
import { computed } from "vue";
import { PinIcon, PlayIcon, SquareIcon } from "@lucide/vue";

import { t } from "../../../../../../../shared/model/ui/ui-locale";
import type { AgentUpPreview } from "../../../../../model/message/message-preview";
import { injectThreadPreview } from "../../../../../model/thread/thread-preview";

const props = defineProps<{
  preview: AgentUpPreview;
}>();

const threadPreview = injectThreadPreview();
const busy = computed(() => threadPreview?.busy.value ?? false);

/** 工作区里同 id 的配方（含 header_pinned）；气泡投影可能尚未带钉态。 */
function workspaceRecipe(id: string) {
  return threadPreview?.recipes.value.find((item) => item.id === id);
}

function isOpen(id: string): boolean {
  return (
    threadPreview?.open.value === true && threadPreview.active.value?.id === id
  );
}

function isPinned(id: string): boolean {
  return workspaceRecipe(id)?.header_pinned === true;
}

async function onStart(id: string): Promise<void> {
  const recipe =
    workspaceRecipe(id) ?? props.preview.recipes.find((item) => item.id === id);
  if (!recipe || !threadPreview) return;
  await threadPreview.start(recipe);
}

async function onStop(id: string): Promise<void> {
  const recipe =
    workspaceRecipe(id) ?? props.preview.recipes.find((item) => item.id === id);
  if (!recipe || !threadPreview) return;
  await threadPreview.stop(recipe);
}

async function onTogglePin(id: string): Promise<void> {
  const recipe =
    workspaceRecipe(id) ?? props.preview.recipes.find((item) => item.id === id);
  if (!recipe || !threadPreview) return;
  await threadPreview.setHeaderPinned(recipe, !isPinned(id));
}
</script>

<template>
  <!-- 气泡脚：Launch Recipe 卡（开发场景主入口） -->
  <div
    v-if="preview.recipes.length > 0"
    class="mt-2 w-full min-w-0 select-none"
    data-copy-ignore
    role="group"
    :aria-label="t('msgPreviewRecipes')"
  >
    <ul class="flex flex-col gap-2">
      <li
        v-for="recipe in preview.recipes"
        :key="recipe.id"
        class="flex min-w-0 items-center gap-2 rounded-xl border border-rule/70 bg-bubble px-3 py-2"
      >
        <div class="min-w-0 flex-1">
          <p class="truncate text-xs font-medium text-foreground">{{ recipe.title }}</p>
          <p class="truncate font-mono text-[11px] text-muted-foreground">{{ recipe.preview_url }}</p>
        </div>
        <button
          type="button"
          class="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-medium transition focus-visible:ring-2 focus-visible:ring-accent/30"
          :class="
            isPinned(recipe.id)
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          "
          :disabled="busy"
          :aria-pressed="isPinned(recipe.id)"
          :title="isPinned(recipe.id) ? t('msgPreviewUnpinHeader') : t('msgPreviewPinHeader')"
          @click="onTogglePin(recipe.id)"
        >
          <PinIcon class="size-3.5" aria-hidden="true" />
          <span class="hidden sm:inline">
            {{ isPinned(recipe.id) ? t("msgPreviewUnpinHeader") : t("msgPreviewPinHeader") }}
          </span>
        </button>
        <button
          v-if="isOpen(recipe.id)"
          type="button"
          class="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-lg bg-muted px-2.5 text-xs font-medium text-foreground transition hover:bg-muted/80 focus-visible:ring-2 focus-visible:ring-accent/30"
          :disabled="busy"
          @click="onStop(recipe.id)"
        >
          <SquareIcon class="size-3.5" aria-hidden="true" />
          {{ t("msgPreviewStop") }}
        </button>
        <button
          v-else
          type="button"
          class="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-lg bg-muted px-2.5 text-xs font-medium text-foreground transition hover:bg-muted/80 focus-visible:ring-2 focus-visible:ring-accent/30"
          :disabled="busy"
          @click="onStart(recipe.id)"
        >
          <PlayIcon class="size-3.5" aria-hidden="true" />
          {{ t("msgPreviewStart") }}
        </button>
      </li>
    </ul>
  </div>
</template>

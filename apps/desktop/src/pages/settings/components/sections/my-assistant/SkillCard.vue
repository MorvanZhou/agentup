<script setup lang="ts">
import { EllipsisVerticalIcon, FolderUpIcon, Trash2Icon, UploadIcon } from "@lucide/vue";
import { computed } from "vue";

import AppDropdownMenu, { type AppDropdownItem } from "../../../../../shared/components/AppDropdownMenu.vue";
import type { UserSkill } from "../../../../../shared/model/runtime/runtime";
import { t, tf } from "../../../../../shared/model/ui/ui-locale";

const props = defineProps<{
  skill: UserSkill;
  busy?: boolean;
}>();

const emit = defineEmits<{
  "update:enabled": [enabled: boolean];
  update: [kind: "directory" | "zip"];
  delete: [];
}>();

const menuItems = computed((): AppDropdownItem[] => [
  { id: "update-directory", label: t("skillsUpdateDir"), icon: FolderUpIcon, disabled: props.busy },
  { id: "update-zip", label: t("skillsUpdateZip"), icon: UploadIcon, disabled: props.busy },
  { id: "delete", label: t("skillsDelete"), icon: Trash2Icon, danger: true, disabled: props.busy },
]);

function onMenu(id: string): void {
  if (id === "update-directory") emit("update", "directory");
  if (id === "update-zip") emit("update", "zip");
  if (id === "delete") emit("delete");
}
</script>

<template>
  <article class="flex min-w-0 flex-col rounded-xl border border-rule bg-background p-3 shadow-sm">
    <div class="flex items-start gap-2">
      <div class="min-w-0 flex-1">
        <h3 class="m-0 truncate text-sm font-semibold tracking-tight text-foreground">{{ skill.name }}</h3>
        <p class="mb-0 mt-1 line-clamp-2 text-xs leading-snug text-muted-foreground">
          {{ skill.description || t("skillsNoDesc") }}
        </p>
      </div>
      <AppDropdownMenu :items="menuItems" @select="onMenu">
        <template #trigger>
          <button
            type="button"
            class="grid size-7 shrink-0 place-items-center rounded-lg border-0 bg-transparent text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
            :aria-label="t('skillsMore')"
            :disabled="busy"
          >
            <EllipsisVerticalIcon class="size-4" aria-hidden="true" />
          </button>
        </template>
      </AppDropdownMenu>
    </div>

    <div class="mt-3 flex items-center justify-between gap-2 border-t border-rule pt-3">
      <span class="text-xs text-muted-foreground">{{ skill.enabled ? t("skillsEnabled") : t("skillsDisabled") }}</span>
      <button
        type="button"
        role="switch"
        :aria-checked="skill.enabled"
        :aria-label="skill.enabled ? tf('skillsDisableAria', { name: skill.name }) : tf('skillsEnableAria', { name: skill.name })"
        :disabled="busy"
        class="relative h-5 w-9 shrink-0 rounded-full transition duration-200 disabled:opacity-50"
        :class="skill.enabled ? 'bg-accent' : 'bg-rule'"
        @click="emit('update:enabled', !skill.enabled)"
      >
        <span
          class="absolute top-0.5 size-4 rounded-full bg-paper shadow-sm transition duration-200"
          :class="skill.enabled ? 'left-4' : 'left-0.5'"
          aria-hidden="true"
        />
      </button>
    </div>
  </article>
</template>

<script setup lang="ts">
import { FolderUpIcon, SearchIcon, UploadIcon } from "@lucide/vue";
import { computed, onMounted, ref } from "vue";

import AppDropdownMenu, { type AppDropdownItem } from "../../../../../shared/components/AppDropdownMenu.vue";
import CommunitySkillDialog from "../../../../../shared/components/CommunitySkillDialog.vue";
import { t } from "../../../../../shared/model/ui-locale";
import { useUserSkills } from "../../../composables/useUserSkills";
import SkillCard from "./SkillCard.vue";

const { skills, busy, load, upload, installFromPath, setEnabled, remove } = useUserSkills();
const communityOpen = ref(false);

const uploadItems = computed((): AppDropdownItem[] => [
  { id: "directory", label: t("skillsPickDir"), icon: FolderUpIcon },
  { id: "zip", label: t("skillsPickZip"), icon: UploadIcon },
]);

onMounted(() => void load());

function onUpload(id: string): void {
  if (id === "directory" || id === "zip") void upload(id);
}

function onCommunityFetched(path: string): void {
  void installFromPath(path);
}
</script>

<template>
  <main class="min-h-0 min-w-0 overflow-auto bg-background">
    <div class="mx-auto w-full max-w-5xl px-4 py-4 sm:px-5 sm:py-5">
      <!-- 页头 -->
      <header class="mb-4 border-b border-rule pb-4">
        <p class="m-0 text-xs font-medium tracking-wider text-accent">{{ t("assistantKicker") }}</p>
        <div class="mt-2 flex flex-col items-start gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
          <div class="min-w-0">
            <h1 class="m-0 text-lg font-semibold tracking-tight text-foreground">{{ t("skillsTitle") }}</h1>
            <p class="mb-0 mt-1.5 max-w-2xl text-sm leading-snug text-muted-foreground">
              {{ t("skillsLeadBefore") }}
              <code class="font-mono text-xs">~/.agents/skills</code>
              {{ t("skillsLeadAfter") }}
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-rule bg-paper px-3 text-sm font-medium text-foreground transition hover:bg-paper-deep disabled:opacity-50"
              :disabled="busy"
              @click="communityOpen = true"
            >
              <SearchIcon class="size-3.5" aria-hidden="true" />
              {{ t("skillsCommunitySearchEntry") }}
            </button>
            <AppDropdownMenu :items="uploadItems" @select="onUpload">
              <template #trigger>
                <button
                  type="button"
                  class="inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-semibold text-white transition hover:bg-accent-deep disabled:opacity-50"
                  :disabled="busy"
                >
                  <UploadIcon class="size-3.5" aria-hidden="true" />
                  {{ t("skillsUpload") }}
                </button>
              </template>
            </AppDropdownMenu>
          </div>
        </div>
      </header>

      <CommunitySkillDialog v-model:open="communityOpen" @fetched="onCommunityFetched" />

      <!-- 空状态 -->
      <section
        v-if="!skills.length"
        class="rounded-xl border border-dashed border-rule bg-paper-deep/70 px-4 py-10 text-center"
        :aria-label="t('skillsEmptyAria')"
      >
        <p class="m-0 text-sm font-medium text-foreground">{{ t("skillsEmptyTitle") }}</p>
        <p class="mb-0 mt-1.5 text-xs text-muted-foreground">{{ t("skillsEmptyBody") }}</p>
      </section>

      <!-- 技能网格 -->
      <section v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" :aria-label="t('skillsInstalled')">
        <SkillCard
          v-for="skill in skills"
          :key="skill.name"
          :skill="skill"
          :busy="busy"
          @update:enabled="setEnabled(skill.name, $event)"
          @update="upload($event, skill.name)"
          @delete="remove(skill.name)"
        />
      </section>
    </div>
  </main>
</template>

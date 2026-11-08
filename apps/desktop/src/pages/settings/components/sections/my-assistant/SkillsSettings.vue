<script setup lang="ts">
import { FolderUpIcon, SearchIcon, UploadIcon } from "@lucide/vue";
import { computed, onMounted, ref, watch } from "vue";

import AppDropdownMenu, { type AppDropdownItem } from "../../../../../shared/components/AppDropdownMenu.vue";
import CommunitySkillDialog from "../../../../../shared/components/skills/CommunitySkillDialog.vue";
import SkillOverwriteDialog from "../../../../../shared/components/skills/SkillOverwriteDialog.vue";
import { t } from "../../../../../shared/model/ui/ui-locale";
import { useUserSkills } from "../../../composables/useUserSkills";
import SettingsSectionShell from "../../SettingsSectionShell.vue";
import SkillCard from "./SkillCard.vue";

const { skills, busy, load, upload, installFromPath, setEnabled, remove } = useUserSkills();
const communityOpen = ref(false);
const overwriteOpen = ref(false);
const overwriteName = ref("");
let overwriteResolve: ((ok: boolean) => void) | null = null;

const uploadItems = computed((): AppDropdownItem[] => [
  { id: "directory", label: t("skillsPickDir"), icon: FolderUpIcon },
  { id: "zip", label: t("skillsPickZip"), icon: UploadIcon },
]);

onMounted(() => void load());

function askOverwrite(name: string): Promise<boolean> {
  overwriteName.value = name;
  overwriteOpen.value = true;
  return new Promise((resolve) => {
    overwriteResolve = resolve;
  });
}

function onOverwriteConfirm(): void {
  overwriteResolve?.(true);
  overwriteResolve = null;
}

watch(overwriteOpen, (open) => {
  if (open || !overwriteResolve) return;
  overwriteResolve(false);
  overwriteResolve = null;
});

function onCommunityFetched(result: { path: string; name: string }): void {
  void installFromPath(result.path, {
    knownName: result.name,
    confirmOverwrite: askOverwrite,
  });
}

async function onUploadSelect(id: string): Promise<void> {
  if (id !== "directory" && id !== "zip") return;
  const bridge = window.agentUp;
  if (!bridge?.selectSkillPackage) return;
  const packagePath = await bridge.selectSkillPackage(id);
  if (!packagePath) return;
  await installFromPath(packagePath, { confirmOverwrite: askOverwrite });
}
</script>

<template>
  <SettingsSectionShell wide :title="t('skillsTitle')">
    <template #lead>
      {{ t("skillsLeadBefore") }}
      <code class="font-mono text-xs">~/.agents/skills</code>
      {{ t("skillsLeadAfter") }}
    </template>

    <template #actions>
      <button
        type="button"
        class="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-rule bg-paper px-3 text-sm font-medium text-foreground transition hover:bg-muted disabled:opacity-50"
        :disabled="busy"
        @click="communityOpen = true"
      >
        <SearchIcon class="size-3.5" aria-hidden="true" />
        {{ t("skillsCommunitySearchEntry") }}
      </button>
      <AppDropdownMenu :items="uploadItems" @select="onUploadSelect">
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
    </template>

    <CommunitySkillDialog v-model:open="communityOpen" @fetched="onCommunityFetched" />
    <SkillOverwriteDialog
      v-model:open="overwriteOpen"
      :skill-name="overwriteName"
      kind="immediate"
      @confirm="onOverwriteConfirm"
    />

    <!-- 空状态 -->
    <section
      v-if="!skills.length"
      class="rounded-xl border border-dashed border-rule bg-paper px-4 py-10 text-center"
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
  </SettingsSectionShell>
</template>

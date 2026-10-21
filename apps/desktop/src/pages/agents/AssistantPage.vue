<script setup lang="ts">
import { ChevronDownIcon, FolderUpIcon, Trash2Icon, UploadIcon } from "@lucide/vue";
import { computed, onMounted, ref } from "vue";

import AppDropdownMenu, { type AppDropdownItem } from "../../shared/components/AppDropdownMenu.vue";
import { DesktopApi, DesktopApiError } from "../../shared/api/runtime";
import { useDesktop } from "../../app/desktop";
import { showToast } from "../../shared/model/toast";
import { readUiLocale, t } from "../../shared/model/ui-locale";
import type { UserSkill } from "../../shared/model/runtime";
import { MCP_PLACEHOLDER } from "../settings/composables/useUserMcp";

const api = new DesktopApi();
const { session, refresh } = useDesktop();

const name = ref("");
const role = ref("");
const background = ref("");
const mcpText = ref("");
const rulesText = ref("");
const skills = ref<UserSkill[]>([]);
const advancedOpen = ref(false);
const loading = ref(true);
const saving = ref(false);

const skillUploadItems = computed((): AppDropdownItem[] => [
  { id: "directory", label: t("skillsPickDir"), icon: FolderUpIcon },
  { id: "zip", label: t("skillsPickZip"), icon: UploadIcon },
]);

const canSubmit = computed(
  () =>
    name.value.trim().length > 0 &&
    role.value.trim().length > 0 &&
    background.value.trim().length > 0,
);

onMounted(() => {
  void loadAll();
});

async function loadAll(): Promise<void> {
  if (!session.value) return;
  loading.value = true;
  try {
    const current = session.value;
    const locale = readUiLocale();
    const [profile, mcp, rules, skillList] = await Promise.all([
      api.personalAssistantProfile(current.token, current.userId, locale),
      api.userMcp(current.token, current.userId),
      api.userAgentsMd(current.token, current.userId),
      api.userSkills(current.token, current.userId),
    ]);
    name.value = profile.name;
    role.value = profile.role;
    background.value = profile.background;
    mcpText.value =
      mcp && Object.keys(mcp).length ? `${JSON.stringify(mcp, null, 2)}\n` : "";
    rulesText.value = rules;
    skills.value = skillList;
    if (skills.value.length || mcpText.value.trim() || rulesText.value.trim()) {
      advancedOpen.value = true;
    }
  } catch (caught) {
    showToast(caught instanceof DesktopApiError ? caught.message : t("assistantProfileLoadFailed"), "error");
  } finally {
    loading.value = false;
  }
}

function parseMcpServers(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      showToast(t("agentsLocalMcpObjectInvalid"), "error");
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    showToast(t("agentsLocalMcpJsonInvalid"), "error");
    return null;
  }
}

async function addSkill(kind: string): Promise<void> {
  if (!session.value || (kind !== "directory" && kind !== "zip")) return;
  const bridge = window.agentUp;
  if (!bridge?.selectSkillPackage) {
    showToast(t("agentsLocalSkillNeedDesktop"), "error");
    return;
  }
  const packagePath = await bridge.selectSkillPackage(kind);
  if (!packagePath) return;
  try {
    await api.installUserSkill(session.value.token, session.value.userId, packagePath);
    skills.value = await api.userSkills(session.value.token, session.value.userId);
    showToast(t("skillsInstalled"), "success");
  } catch (caught) {
    showToast(caught instanceof DesktopApiError ? caught.message : t("skillsInstallFailed"), "error");
  }
}

async function removeSkill(skillName: string): Promise<void> {
  if (!session.value) return;
  try {
    await api.deleteUserSkill(session.value.token, session.value.userId, skillName);
    skills.value = skills.value.filter((item) => item.name !== skillName);
  } catch (caught) {
    showToast(caught instanceof DesktopApiError ? caught.message : t("skillsRemoveFailed"), "error");
  }
}

async function submit(): Promise<void> {
  if (!session.value || !canSubmit.value || saving.value) return;
  const mcpServers = parseMcpServers(mcpText.value);
  if (mcpServers === null) return;
  saving.value = true;
  try {
    await api.savePersonalAssistantProfile(
      session.value.token,
      session.value.userId,
      {
        name: name.value.trim(),
        role: role.value.trim(),
        background: background.value.trim(),
      },
      readUiLocale(),
    );
    await api.saveUserMcp(session.value.token, session.value.userId, mcpServers);
    await api.saveUserAgentsMd(session.value.token, session.value.userId, rulesText.value);
    await refresh();
    showToast(t("assistantProfileSaved"), "success");
  } catch (caught) {
    showToast(caught instanceof DesktopApiError ? caught.message : t("assistantProfileSaveFailed"), "error");
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <!-- 我的助理：布局对齐本地 Agent 编辑 -->
  <div class="mx-auto w-full max-w-2xl">
    <p v-if="loading" class="m-0 text-sm text-muted-foreground">{{ t("agentsLocalLoading") }}</p>
    <form v-else class="flex flex-col gap-4" @submit.prevent="submit">
      <label class="grid gap-1.5">
        <span class="text-sm font-medium text-foreground">
          {{ t("assistantName") }}
          <span class="text-destructive" aria-hidden="true">*</span>
        </span>
        <input
          v-model="name"
          type="text"
          required
          maxlength="40"
          class="min-h-8 rounded-lg border border-rule bg-paper px-2.5 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
          :placeholder="t('assistantNamePlaceholder')"
        />
      </label>

      <label class="grid gap-1.5">
        <span class="text-sm font-medium text-foreground">
          {{ t("agentsLocalRole") }}
          <span class="text-destructive" aria-hidden="true">*</span>
        </span>
        <input
          v-model="role"
          type="text"
          required
          maxlength="40"
          class="min-h-8 rounded-lg border border-rule bg-paper px-2.5 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
          :placeholder="t('agentsLocalRolePlaceholder')"
        />
      </label>

      <label class="grid gap-1.5">
        <span class="text-sm font-medium text-foreground">
          {{ t("agentsLocalBackground") }}
          <span class="text-destructive" aria-hidden="true">*</span>
        </span>
        <textarea
          v-model="background"
          rows="4"
          maxlength="300"
          required
          class="min-h-24 resize-y rounded-lg border border-rule bg-paper px-2.5 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
          :placeholder="t('agentsLocalBackgroundPlaceholder')"
        />
        <span class="text-xs font-normal text-muted-foreground">{{ t("assistantBackgroundHint") }}</span>
      </label>

      <button
        type="button"
        class="inline-flex w-fit items-center gap-1 border-0 bg-transparent p-0 text-sm font-medium text-accent transition duration-200 hover:text-accent-deep"
        :aria-expanded="advancedOpen"
        @click="advancedOpen = !advancedOpen"
      >
        <span>{{ advancedOpen ? t("agentsLocalAdvancedHide") : t("agentsLocalAdvanced") }}</span>
        <ChevronDownIcon
          class="size-3.5 shrink-0 transition duration-200"
          :class="{ 'rotate-180': advancedOpen }"
          aria-hidden="true"
        />
      </button>

      <template v-if="advancedOpen">
        <p class="m-0 text-xs leading-snug text-muted-foreground">{{ t("assistantAdvancedHint") }}</p>

        <div class="grid gap-1.5">
          <div class="flex items-center justify-between gap-2">
            <span class="text-sm font-medium text-foreground">{{ t("agentsLocalSkills") }}</span>
            <AppDropdownMenu :items="skillUploadItems" @select="addSkill">
              <template #trigger>
                <button
                  type="button"
                  class="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-rule bg-paper px-2.5 text-xs font-medium text-foreground transition duration-200 hover:bg-accent/10"
                  :disabled="saving"
                >
                  <UploadIcon class="size-3.5" aria-hidden="true" />
                  {{ t("agentsLocalSkillsAdd") }}
                </button>
              </template>
            </AppDropdownMenu>
          </div>
          <p class="m-0 text-xs text-muted-foreground">{{ t("assistantSkillsHint") }}</p>
          <ul v-if="skills.length" class="m-0 flex list-none flex-col gap-1.5 p-0">
            <li
              v-for="skill in skills"
              :key="skill.name"
              class="flex min-h-8 items-center justify-between gap-2 rounded-lg border border-rule bg-paper px-2.5 text-sm"
            >
              <span class="min-w-0 truncate text-foreground" :title="skill.name">{{ skill.name }}</span>
              <button
                type="button"
                class="inline-flex size-7 shrink-0 items-center justify-center rounded-md border-0 bg-transparent text-muted-foreground transition hover:bg-accent/10 hover:text-accent"
                :aria-label="t('agentsLocalSkillsRemove')"
                :disabled="saving"
                @click="removeSkill(skill.name)"
              >
                <Trash2Icon class="size-3.5" aria-hidden="true" />
              </button>
            </li>
          </ul>
        </div>

        <label class="grid gap-1.5">
          <span class="text-sm font-medium text-foreground">{{ t("settingsRules") }}</span>
          <textarea
            v-model="rulesText"
            rows="8"
            class="min-h-40 resize-y rounded-lg border border-rule bg-paper px-2.5 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
            :placeholder="t('rulesPlaceholder')"
            spellcheck="false"
          />
          <span class="text-xs font-normal text-muted-foreground">{{ t("rulesHint") }}</span>
        </label>

        <label class="grid gap-1.5">
          <span class="text-sm font-medium text-foreground">{{ t("agentsLocalMcp") }}</span>
          <textarea
            v-model="mcpText"
            rows="10"
            class="min-h-48 resize-y rounded-lg border border-rule bg-paper px-2.5 py-2 font-mono text-xs leading-relaxed text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
            :placeholder="MCP_PLACEHOLDER"
            spellcheck="false"
          />
          <span class="text-xs font-normal text-muted-foreground">{{ t("agentsLocalMcpHint") }}</span>
        </label>
      </template>

      <div class="flex flex-wrap justify-end gap-2 border-t border-rule pt-4">
        <button
          type="submit"
          class="inline-flex min-h-8 items-center rounded-lg bg-accent px-3 text-sm font-semibold text-white transition duration-200 hover:bg-accent-deep disabled:opacity-50"
          :disabled="!canSubmit || saving"
        >
          {{ saving ? t("agentsLocalSaving") : t("agentsLocalSave") }}
        </button>
      </div>
    </form>
  </div>
</template>

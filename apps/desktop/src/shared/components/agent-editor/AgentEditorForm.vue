<script setup lang="ts">
import { ChevronDownIcon, DownloadIcon, FolderUpIcon, SearchIcon, Trash2Icon, UploadIcon } from "@lucide/vue";
import { computed, ref, watch } from "vue";

import { readSession } from "../../../app/session-store";
import { DesktopApi, DesktopApiError } from "../../api/runtime";
import type {
  AgentEditorInitial,
  AgentEditorInput,
  AgentEditorVariant,
} from "../../model/agent-editor";
import { compressAvatarFile } from "../../model/compress-avatar";
import { showToast } from "../../model/toast";
import { t } from "../../model/ui-locale";
import AgentAvatar from "../AgentAvatar.vue";
import AppDropdownMenu, { type AppDropdownItem } from "../AppDropdownMenu.vue";
import CommunitySkillDialog from "../CommunitySkillDialog.vue";

const MCP_PLACEHOLDER = `{
  "example": {
    "url": "http://127.0.0.1:9001/mcp"
  }
}
`;

const props = withDefaults(
  defineProps<{
    busy: boolean;
    variant?: AgentEditorVariant;
    initial?: AgentEditorInitial | null;
    /** 本机 Agent id；有已装 Skill 时可导出 zip */
    localAgentId?: string;
    /** 已发布 agent id；无本机 skill 时从云端下载 */
    publishedAgentId?: string;
  }>(),
  { variant: "local-create", initial: null, localAgentId: "", publishedAgentId: "" },
);
const emit = defineEmits<{
  submit: [input: AgentEditorInput];
  cancel: [];
}>();

const api = new DesktopApi();
const name = ref("");
const role = ref("");
const background = ref("");
const rules = ref("");
const mcpText = ref("");
const advancedOpen = ref(false);
/** 新建待安装路径 */
const skillPaths = ref<string[]>([]);
/** 编辑：仍保留的已装技能名 */
const installedSkills = ref<string[]>([]);
/** 编辑：从已装列表移除的技能名 */
const removeSkills = ref<string[]>([]);
const downloadingSkill = ref("");
const communityOpen = ref(false);
const avatarPreview = ref("");
const avatarChange = ref("");
const avatarInput = ref<HTMLInputElement>();
const avatarBusy = ref(false);

const isEdit = computed(
  () => props.variant === "local-edit" || props.variant === "publish-edit",
);
const isPublish = computed(
  () => props.variant === "publish-create" || props.variant === "publish-edit",
);

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

const canDownloadSkill = computed(() => Boolean(props.localAgentId || props.publishedAgentId));

const submitIdleLabel = computed(() => {
  switch (props.variant) {
    case "local-edit":
      return t("agentsLocalSave");
    case "publish-create":
      return t("publishNewTitle");
    case "publish-edit":
      return t("publishUpdateAction");
    default:
      return t("agentsLocalCreate");
  }
});

const submitBusyLabel = computed(() => {
  if (isPublish.value) return t("publishPublishing");
  return isEdit.value ? t("agentsLocalSaving") : t("agentsLocalCreating");
});

function skillLabel(filePath: string): string {
  const parts = filePath.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || filePath;
}

function applyInitial(value: AgentEditorInitial | null | undefined): void {
  if (!value) {
    avatarPreview.value = "";
    avatarChange.value = "";
    return;
  }
  name.value = value.name;
  role.value = value.role;
  background.value = value.background;
  rules.value = value.rules ?? "";
  const servers = value.mcpServers ?? {};
  mcpText.value = formatMcpText(servers);
  installedSkills.value = [...(value.skills ?? [])];
  removeSkills.value = [];
  skillPaths.value = [];
  avatarPreview.value = value.avatarUrl ?? "";
  avatarChange.value = "";
  if (rules.value.trim() || installedSkills.value.length || Object.keys(servers).length) {
    advancedOpen.value = true;
  }
}

async function onAvatarPicked(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  avatarBusy.value = true;
  try {
    const dataUrl = await compressAvatarFile(file);
    avatarChange.value = dataUrl;
    avatarPreview.value = dataUrl;
  } catch {
    showToast(t("agentsLocalAvatarFailed"), "error");
  } finally {
    avatarBusy.value = false;
  }
}

watch(
  () => props.initial,
  (value) => applyInitial(value),
  { immediate: true },
);

async function addSkill(kind: string): Promise<void> {
  if (kind !== "directory" && kind !== "zip") return;
  const bridge = window.agentUp;
  if (!bridge?.selectSkillPackage) {
    showToast(t("agentsLocalSkillNeedDesktop"), "error");
    return;
  }
  const packagePath = await bridge.selectSkillPackage(kind);
  if (!packagePath) return;
  addSkillPath(packagePath);
}

function addSkillPath(packagePath: string): void {
  if (skillPaths.value.includes(packagePath)) return;
  skillPaths.value = [...skillPaths.value, packagePath];
}

function removePendingSkill(filePath: string): void {
  skillPaths.value = skillPaths.value.filter((item) => item !== filePath);
}

function removeInstalledSkill(skillName: string): void {
  installedSkills.value = installedSkills.value.filter((item) => item !== skillName);
  if (!removeSkills.value.includes(skillName)) {
    removeSkills.value = [...removeSkills.value, skillName];
  }
}

async function downloadInstalledSkill(skillName: string): Promise<void> {
  if (!canDownloadSkill.value || downloadingSkill.value) return;
  const bridge = window.agentUp;
  if (!bridge?.selectSavePath) {
    showToast(t("agentsLocalSkillNeedDesktop"), "error");
    return;
  }
  const session = readSession();
  if (!session?.token || !session.userId) {
    showToast(t("agentsLocalSkillsDownloadFailed"), "error");
    return;
  }
  const destination = await bridge.selectSavePath(`${skillName}.zip`);
  if (!destination) return;
  downloadingSkill.value = skillName;
  try {
    if (props.localAgentId) {
      try {
        await api.exportLocalAgentSkill(
          session.token,
          session.userId,
          props.localAgentId,
          skillName,
          destination,
        );
      } catch {
        if (!props.publishedAgentId) throw new Error("local export failed");
        await api.exportPublishedSkill(
          session.token,
          props.publishedAgentId,
          skillName,
          destination,
        );
      }
    } else if (props.publishedAgentId) {
      await api.exportPublishedSkill(
        session.token,
        props.publishedAgentId,
        skillName,
        destination,
      );
    }
    showToast(t("agentsLocalSkillsDownloaded"), "success");
  } catch (caught) {
    showToast(
      caught instanceof DesktopApiError ? caught.message : t("agentsLocalSkillsDownloadFailed"),
      "error",
    );
  } finally {
    downloadingSkill.value = "";
  }
}

function parseMcpServers(raw: string): Record<string, unknown> | undefined | null {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    showToast(t("agentsLocalMcpJsonInvalid"), "error");
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    showToast(t("agentsLocalMcpObjectInvalid"), "error");
    return null;
  }
  return parsed as Record<string, unknown>;
}

function formatMcpText(servers: Record<string, unknown> | undefined): string {
  if (!servers || !Object.keys(servers).length) return "";
  return `${JSON.stringify(servers, null, 2)}\n`;
}

function submit(): void {
  if (!canSubmit.value) return;
  const mcpServers = parseMcpServers(mcpText.value);
  if (mcpServers === null) return;
  mcpText.value = formatMcpText(mcpServers);
  const payload: AgentEditorInput = {
    name: name.value.trim(),
    role: role.value.trim(),
    background: background.value.trim(),
    ...(skillPaths.value.length ? { skillPaths: [...skillPaths.value] } : {}),
    ...(avatarChange.value ? { avatarDataUrl: avatarChange.value } : {}),
  };
  if (isEdit.value) {
    payload.rules = rules.value;
    if (removeSkills.value.length) payload.removeSkills = [...removeSkills.value];
    // 编辑始终覆盖 MCP（空对象清除）
    payload.mcpServers = mcpServers ?? {};
  } else if (mcpServers && Object.keys(mcpServers).length) {
    payload.mcpServers = mcpServers;
  }
  if (!isEdit.value && rules.value.trim()) payload.rules = rules.value;
  emit("submit", payload);
}
</script>

<template>
  <!-- Agent 共用编辑表单：本机创建/编辑 · 市场发布/更新 -->
  <form class="flex flex-col gap-4" @submit.prevent="submit">
    <label class="grid gap-1.5">
      <span class="text-sm font-medium text-foreground">
        {{ t("agentsLocalName") }}
        <span class="text-destructive" aria-hidden="true">*</span>
      </span>
      <input
        v-model="name"
        type="text"
        required
        maxlength="40"
        class="min-h-8 rounded-lg border border-rule bg-paper px-2.5 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
        :placeholder="t('agentsLocalNamePlaceholder')"
      />
    </label>

    <!-- 头像可选；未选时 AgentAvatar 显示名字首字母 -->
    <div class="grid gap-1.5">
      <span class="text-sm font-medium text-foreground">{{ t("agentsLocalAvatar") }}</span>
      <div class="flex items-center gap-3">
        <button
          type="button"
          class="shrink-0 rounded-full border border-rule bg-paper p-0.5 transition hover:border-accent"
          :disabled="busy || avatarBusy"
          @click="avatarInput?.click()"
        >
          <AgentAvatar
            :name="name || 'A'"
            :avatar-url="avatarPreview || undefined"
            size="xl"
            round
          />
        </button>
        <div class="min-w-0 flex-1">
          <input
            ref="avatarInput"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            class="hidden"
            @change="onAvatarPicked"
          />
          <button
            type="button"
            class="inline-flex min-h-8 items-center rounded-lg border border-rule bg-paper px-2.5 text-xs font-medium text-foreground transition hover:bg-accent/10"
            :disabled="busy || avatarBusy"
            @click="avatarInput?.click()"
          >
            {{ avatarPreview ? t("accountAvatarChange") : t("accountAvatarPick") }}
          </button>
          <p class="mb-0 mt-1 text-xs text-muted-foreground">{{ t("agentsLocalAvatarHint") }}</p>
        </div>
      </div>
    </div>

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
        required
        maxlength="300"
        class="min-h-24 resize-y rounded-lg border border-rule bg-paper px-2.5 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
        :placeholder="t('agentsLocalBackgroundPlaceholder')"
      />
      <span class="text-xs font-normal text-muted-foreground">{{ t("agentsLocalBackgroundHint") }}</span>
    </label>

    <!-- 高级配置：文本型展开 -->
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
      <p class="m-0 text-xs leading-snug text-muted-foreground">
        {{ isPublish ? t("publishAdvancedHint") : t("agentsLocalAdvancedHint") }}
      </p>

      <label class="grid gap-1.5">
        <span class="text-sm font-medium text-foreground">{{ t("rulesTitle") }}</span>
        <textarea
          v-model="rules"
          rows="8"
          class="min-h-40 resize-y rounded-lg border border-rule bg-paper px-2.5 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
          :placeholder="t('rulesPlaceholder')"
          spellcheck="false"
        />
        <span class="text-xs font-normal text-muted-foreground">{{ t("agentsLocalRulesHint") }}</span>
      </label>

      <div class="grid gap-1.5">
        <div class="flex items-center justify-between gap-2">
          <span class="text-sm font-medium text-foreground">{{ t("agentsLocalSkills") }}</span>
          <div class="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              class="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-rule bg-paper px-2.5 text-xs font-medium text-foreground transition duration-200 hover:bg-accent/10"
              :disabled="busy"
              @click="communityOpen = true"
            >
              <SearchIcon class="size-3.5" aria-hidden="true" />
              {{ t("skillsCommunitySearchEntry") }}
            </button>
            <AppDropdownMenu :items="skillUploadItems" @select="addSkill">
              <template #trigger>
                <button
                  type="button"
                  class="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-rule bg-paper px-2.5 text-xs font-medium text-foreground transition duration-200 hover:bg-accent/10"
                  :disabled="busy"
                >
                  <UploadIcon class="size-3.5" aria-hidden="true" />
                  {{ t("agentsLocalSkillsAdd") }}
                </button>
              </template>
            </AppDropdownMenu>
          </div>
        </div>
        <p class="m-0 text-xs text-muted-foreground">{{ t("agentsLocalSkillsHint") }}</p>
        <ul
          v-if="installedSkills.length || skillPaths.length"
          class="m-0 flex list-none flex-col gap-1.5 p-0"
        >
          <li
            v-for="skillName in installedSkills"
            :key="`installed-${skillName}`"
            class="flex min-h-8 items-center justify-between gap-2 rounded-lg border border-rule bg-paper px-2.5 text-sm"
          >
            <button
              v-if="canDownloadSkill"
              type="button"
              class="min-w-0 flex-1 truncate border-0 bg-transparent p-0 text-left text-sm text-foreground underline-offset-2 transition hover:text-accent hover:underline"
              :title="t('agentsLocalSkillsDownload')"
              :disabled="busy || downloadingSkill === skillName"
              @click="downloadInstalledSkill(skillName)"
            >
              {{ skillName }}
            </button>
            <span v-else class="min-w-0 truncate text-foreground" :title="skillName">{{
              skillName
            }}</span>
            <div class="flex shrink-0 items-center gap-0.5">
              <button
                v-if="canDownloadSkill"
                type="button"
                class="inline-flex size-7 items-center justify-center rounded-md border-0 bg-transparent text-muted-foreground transition hover:bg-accent/10 hover:text-accent"
                :aria-label="t('agentsLocalSkillsDownload')"
                :disabled="busy || downloadingSkill === skillName"
                @click="downloadInstalledSkill(skillName)"
              >
                <DownloadIcon class="size-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                class="inline-flex size-7 items-center justify-center rounded-md border-0 bg-transparent text-muted-foreground transition hover:bg-accent/10 hover:text-accent"
                :aria-label="t('agentsLocalSkillsRemove')"
                :disabled="busy"
                @click="removeInstalledSkill(skillName)"
              >
                <Trash2Icon class="size-3.5" aria-hidden="true" />
              </button>
            </div>
          </li>
          <li
            v-for="path in skillPaths"
            :key="path"
            class="flex min-h-8 items-center justify-between gap-2 rounded-lg border border-rule bg-paper px-2.5 text-sm"
          >
            <span class="min-w-0 truncate text-foreground" :title="path">{{ skillLabel(path) }}</span>
            <button
              type="button"
              class="inline-flex size-7 shrink-0 items-center justify-center rounded-md border-0 bg-transparent text-muted-foreground transition hover:bg-accent/10 hover:text-accent"
              :aria-label="t('agentsLocalSkillsRemove')"
              :disabled="busy"
              @click="removePendingSkill(path)"
            >
              <Trash2Icon class="size-3.5" aria-hidden="true" />
            </button>
          </li>
        </ul>
      </div>

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
        type="button"
        class="inline-flex min-h-8 items-center rounded-lg border border-rule bg-paper px-3 text-sm font-medium text-foreground transition duration-200 hover:bg-accent/10"
        :disabled="busy"
        @click="$emit('cancel')"
      >
        {{ t("agentsLocalCancel") }}
      </button>
      <button
        type="submit"
        class="inline-flex min-h-8 items-center rounded-lg bg-accent px-3 text-sm font-semibold text-white transition duration-200 hover:bg-accent-deep disabled:opacity-50"
        :disabled="!canSubmit || busy"
      >
        {{ busy ? submitBusyLabel : submitIdleLabel }}
      </button>
    </div>
  </form>

  <CommunitySkillDialog v-model:open="communityOpen" @fetched="addSkillPath" />
</template>

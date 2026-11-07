<script setup lang="ts">
import { ChevronDownIcon, DownloadIcon, FolderUpIcon, SearchIcon, Trash2Icon, UploadIcon } from "@lucide/vue";
import { computed, ref, watch } from "vue";

import { readSession } from "../../../app/session/session-store";
import { DesktopApi, DesktopApiError } from "../../api/runtime";
import type {
  AgentEditorInitial,
  AgentEditorInput,
  AgentEditorVariant,
} from "../../model/agent-editor/agent-editor";
import {
  formatMcpDocument,
  invalidMcpServerName,
  mcpServersFromEditor,
  MCP_PLACEHOLDER,
} from "../../model/agent-editor/mcp-document";
import {
  BACKGROUND_MAX,
  clampUtf8,
  NAME_MAX,
  ROLE_MAX,
  RULES_MAX_BYTES,
  RULES_MAX_CHARS,
} from "../../model/input-limits";
import {
  skillAddConflict,
  upsertPendingSkill,
  visibleInstalledSkills,
  type PendingSkill,
} from "../../model/skills/pending-skill";
import { formatApiError } from "../../model/runtime/package-issues";
import { showToast } from "../../model/ui/toast";
import { t, tf } from "../../model/ui/ui-locale";
import AgentAvatarField from "../avatar/AgentAvatarField.vue";
import AppDropdownMenu, { type AppDropdownItem } from "../AppDropdownMenu.vue";
import CommunitySkillDialog from "../skills/CommunitySkillDialog.vue";
import SkillOverwriteDialog from "../skills/SkillOverwriteDialog.vue";

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

// 规则按 UTF-8 字节封顶；maxlength 只数字符，中文会先顶满字节。
function onRulesInput(event: Event): void {
  rules.value = clampUtf8((event.target as HTMLTextAreaElement).value, RULES_MAX_BYTES);
}
const mcpText = ref("");
const mcpOriginal = ref("");
const mcpLoaded = ref(true);
const mcpLoading = ref(false);
const advancedOpen = ref(false);
/** 待保存安装的 Skill（path + SKILL.md name） */
const pendingSkills = ref<PendingSkill[]>([]);
/** 编辑：仍保留的已装技能名 */
const installedSkills = ref<string[]>([]);
/** 编辑：从已装列表移除的技能名 */
const removeSkills = ref<string[]>([]);
const downloadingSkill = ref("");
const communityOpen = ref(false);
const overwriteOpen = ref(false);
const overwriteKind = ref<"installed" | "pending">("installed");
const overwriteName = ref("");
let overwriteResolve: ((ok: boolean) => void) | null = null;
const avatarPreview = ref("");
const avatarChange = ref("");
const officialAvatarId = ref("");

const listedInstalledSkills = computed(() =>
  visibleInstalledSkills(installedSkills.value, pendingSkills.value),
);

const isEdit = computed(
  () => props.variant === "local-edit" || props.variant === "publish-edit",
);
const isPublish = computed(
  () => props.variant === "publish-create" || props.variant === "publish-edit",
);
const isPublishEdit = computed(() => props.variant === "publish-edit");

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

function applyInitial(value: AgentEditorInitial | null | undefined): void {
  if (!value) {
    avatarPreview.value = "";
    avatarChange.value = "";
    officialAvatarId.value = "";
    return;
  }
  name.value = value.name;
  role.value = value.role;
  background.value = value.background;
  rules.value = value.rules ?? "";
  const servers = value.mcpServers ?? {};
  // 市场更新不预填 MCP 正文。点编辑后再向 COS 拉这一个文件。
  if (props.variant === "publish-edit") {
    mcpText.value = "";
    mcpOriginal.value = "";
    mcpLoaded.value = false;
  } else {
    mcpText.value = formatMcpDocument(servers);
    mcpOriginal.value = mcpText.value;
    mcpLoaded.value = true;
  }
  installedSkills.value = [...(value.skills ?? [])];
  removeSkills.value = [];
  pendingSkills.value = [];
  avatarPreview.value = value.avatarUrl ?? "";
  avatarChange.value = "";
  officialAvatarId.value = "";
  if (rules.value.trim() || installedSkills.value.length || (props.variant !== "publish-edit" && Object.keys(servers).length)) {
    advancedOpen.value = true;
  }
}

function onAvatarPicked(dataUrl: string, officialId: string): void {
  avatarChange.value = dataUrl;
  avatarPreview.value = dataUrl;
  officialAvatarId.value = officialId;
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
  const session = readSession();
  if (!session?.token || !session.userId) {
    showToast(t("agentsLocalSkillNeedDesktop"), "error");
    return;
  }
  try {
    const inspected = await api.inspectUserSkill(session.token, session.userId, packagePath);
    await queuePendingSkill({ path: packagePath, name: inspected.name });
  } catch (caught) {
    showToast(formatApiError(caught, t("skillsInstallFailed")), "error");
  }
}

async function onCommunityFetched(result: { path: string; name: string }): Promise<void> {
  await queuePendingSkill(result);
}

async function queuePendingSkill(next: PendingSkill): Promise<void> {
  if (pendingSkills.value.some((item) => item.path === next.path)) return;
  const conflict = skillAddConflict(next.name, installedSkills.value, pendingSkills.value);
  if (conflict) {
    const ok = await askOverwrite(next.name, conflict);
    if (!ok) return;
  }
  // 若用户刚删过同名已装项，再加回来等于覆盖安装，不再记删除。
  removeSkills.value = removeSkills.value.filter((item) => item !== next.name);
  pendingSkills.value = upsertPendingSkill(pendingSkills.value, next);
}

function askOverwrite(skillName: string, kind: "installed" | "pending"): Promise<boolean> {
  overwriteName.value = skillName;
  overwriteKind.value = kind;
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

function removePendingSkill(filePath: string): void {
  pendingSkills.value = pendingSkills.value.filter((item) => item.path !== filePath);
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
          session.userId,
          props.publishedAgentId,
          skillName,
          destination,
        );
      }
    } else if (props.publishedAgentId) {
      await api.exportPublishedSkill(
        session.token,
        session.userId,
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

async function loadMcp(): Promise<void> {
  if (!props.publishedAgentId || mcpLoading.value) return;
  const session = readSession();
  if (!session?.token) {
    showToast(t("agentsLocalMcpLoadFailed"), "error");
    return;
  }
  mcpLoading.value = true;
  try {
    const text = await api.loadPublishEditorMcp(session.token, props.publishedAgentId);
    mcpText.value = text;
    mcpOriginal.value = text;
    mcpLoaded.value = true;
  } catch (caught) {
    showToast(
      caught instanceof DesktopApiError ? caught.message : t("agentsLocalMcpLoadFailed"),
      "error",
    );
  } finally {
    mcpLoading.value = false;
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
  const servers = mcpServersFromEditor(parsed as Record<string, unknown>);
  // 字符串值会通过发布写进 COS，招募时才报 mcpServers.x 必须是对象。
  const invalid = invalidMcpServerName(servers);
  if (invalid) {
    showToast(tf("agentsLocalMcpServerObject", { name: invalid }), "error");
    return null;
  }
  return servers;
}

function submit(): void {
  if (!canSubmit.value) return;
  const mcpServers = parseMcpServers(mcpText.value);
  if (mcpServers === null) return;
  mcpText.value = formatMcpDocument(mcpServers);
  const payload: AgentEditorInput = {
    name: name.value.trim(),
    role: role.value.trim(),
    background: background.value.trim(),
    ...(pendingSkills.value.length
      ? { skillPaths: pendingSkills.value.map((item) => item.path) }
      : {}),
    ...(avatarChange.value ? { avatarDataUrl: avatarChange.value } : {}),
  };
  if (isEdit.value) {
    payload.rules = rules.value;
    if (removeSkills.value.length) payload.removeSkills = [...removeSkills.value];
    // 市场更新没改 MCP 文本就不提交，服务端保留原对象。本机编辑仍始终覆盖。
    if (props.variant !== "publish-edit" || (mcpLoaded.value && mcpText.value !== mcpOriginal.value)) {
      payload.mcpServers = mcpServers ?? {};
    }
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
        :maxlength="NAME_MAX"
        class="min-h-8 rounded-lg border border-rule bg-paper px-2.5 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
        :placeholder="t('agentsLocalNamePlaceholder')"
      />
    </label>

    <!-- 头像可选；未选时显示名字首字母。创建、编辑、发布共用。 -->
    <AgentAvatarField
      :name="name"
      :preview="avatarPreview"
      :busy="busy"
      :selected-id="officialAvatarId"
      @pick="onAvatarPicked"
    />

    <label class="grid gap-1.5">
      <span class="text-sm font-medium text-foreground">
        {{ t("agentsLocalRole") }}
        <span class="text-destructive" aria-hidden="true">*</span>
      </span>
      <input
        v-model="role"
        type="text"
        required
        :maxlength="ROLE_MAX"
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
        :maxlength="BACKGROUND_MAX"
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
          :value="rules"
          rows="8"
          :maxlength="RULES_MAX_CHARS"
          class="min-h-40 resize-y rounded-lg border border-rule bg-paper px-2.5 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
          :placeholder="t('rulesPlaceholder')"
          spellcheck="false"
          @input="onRulesInput"
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
          v-if="listedInstalledSkills.length || pendingSkills.length"
          class="m-0 flex list-none flex-col gap-1.5 p-0"
        >
          <li
            v-for="skillName in listedInstalledSkills"
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
            v-for="pending in pendingSkills"
            :key="pending.path"
            class="flex min-h-8 items-center justify-between gap-2 rounded-lg border border-rule bg-paper px-2.5 text-sm"
          >
            <span class="min-w-0 truncate text-foreground" :title="pending.path">{{
              pending.name
            }}</span>
            <button
              type="button"
              class="inline-flex size-7 shrink-0 items-center justify-center rounded-md border-0 bg-transparent text-muted-foreground transition hover:bg-accent/10 hover:text-accent"
              :aria-label="t('agentsLocalSkillsRemove')"
              :disabled="busy"
              @click="removePendingSkill(pending.path)"
            >
              <Trash2Icon class="size-3.5" aria-hidden="true" />
            </button>
          </li>
        </ul>
      </div>

      <!-- 市场更新默认不展示 MCP 正文 -->
      <div v-if="isPublishEdit && !mcpLoaded" class="grid gap-1.5">
        <span class="text-sm font-medium text-foreground">{{ t("agentsLocalMcp") }}</span>
        <button
          type="button"
          class="inline-flex min-h-8 w-fit items-center rounded-lg border border-rule bg-paper px-3 text-sm font-medium text-foreground transition duration-200 hover:bg-accent/10 disabled:opacity-50"
          :disabled="busy || mcpLoading"
          @click="loadMcp"
        >
          {{ mcpLoading ? t("agentsLocalMcpLoading") : t("agentsLocalMcpEdit") }}
        </button>
        <span class="text-xs font-normal text-muted-foreground">{{ t("agentsLocalMcpHint") }}</span>
      </div>
      <label v-else class="grid gap-1.5">
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

  <CommunitySkillDialog v-model:open="communityOpen" @fetched="onCommunityFetched" />
  <SkillOverwriteDialog
    v-model:open="overwriteOpen"
    :skill-name="overwriteName"
    :kind="overwriteKind"
    @confirm="onOverwriteConfirm"
  />
</template>

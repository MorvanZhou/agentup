<script setup lang="ts">
import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  LoaderCircleIcon,
  PencilIcon,
  Trash2Icon,
  XIcon,
} from "@lucide/vue";
import { computed, ref, watch } from "vue";

import AppSelect from "../../../../../shared/components/AppSelect.vue";
import ProviderLogo from "../../../../../shared/components/ProviderLogo.vue";
import UiSkeleton from "../../../../../shared/components/UiSkeleton.vue";
import { formatTokenWindow } from "../../../../../shared/lib/format-tokens";
import { modelSourceLabel } from "../../../../../shared/model/provider/model-source-label";
import type { AgentSdkAuthEnvironment } from "../../../../../shared/model/runtime/runtime";
import { t, tf } from "../../../../../shared/model/ui/ui-locale";
import { useProviderSettings } from "../../../composables/useProviderSettings";
import SettingsSectionShell from "../../SettingsSectionShell.vue";
import AgentSdkConnectPanel from "./provider-sdk/AgentSdkConnectPanel.vue";
import { sdkReady, sdkStateLabel } from "./provider-sdk/sdk-state";

const MODEL_PREVIEW_COUNT = 5;

const {
  connections,
  availableModels,
  filteredModels,
  modelProviderFilterOptions,
  overridden,
  busy,
  draftTemplateId,
  draftConnectionId,
  draftBaseUrl,
  draftApiKey,
  draftInlineModelId,
  editingModelKey,
  editingModelId,
  modelFilter,
  modelProviderFilter,
  modelEnabledOnly,
  apiTemplates,
  templates,
  agentSdks,
  selectedTemplate,
  selectedSdk,
  sdkSelected,
  existingConnection,
  needsBaseUrl,
  needsApiKey,
  apiKeyRequired,
  canRefreshModels,
  canAddCustomModel,
  canAddAnotherEndpoint,
  customModelTargets,
  templateConnections,
  inlineConnectionModels,
  draftCustomModelId,
  draftAddConnectionId,
  loaded,
  sdkBusy,
  sdkModelsBusy,
  sdkPhase,
  sdkLoginDeviceCode,
  sdkLoginNeedsApiKey,
  sdkLoginApiKeyDraft,
  sdkLoginAuthUrl,
  startAgentSdkInstall,
  cancelAgentSdkInstall,
  loginAgentSdk,
  checkAgentSdkLogin,
  submitAgentSdkApiKey,
  openAgentSdkApiKeyDoc,
  cancelAgentSdkLogin,
  logoutAgentSdk,
  uninstallAgentSdk,
  refreshAgentSdkModels,
  saveConnection,
  removeConnection,
  refreshAllDiscoverableModels,
  addCustomModel,
  addInlineCustomModel,
  removeCustomModel,
  refreshCurrentConnectionModels,
  startEditInlineModel,
  cancelEditInlineModel,
  saveEditInlineModel,
  toggleModel,
  startAnotherEndpoint,
  selectEndpoint,
} = useProviderSettings();

/** 仅多端点时才露出「当前端点」切换；单实例 Ollama 只填服务地址 */
const showEndpointSwitcher = computed(
  () => templateConnections.value.length > 1 || (!draftConnectionId.value && templateConnections.value.length > 0),
);

const addTargetOptions = computed(() =>
  customModelTargets.value.map((item) => ({
    value: item.connectionId,
    label: item.label,
    active: true,
  })),
);

/** 同模板多端点切换 */
const endpointOptions = computed(() =>
  templateConnections.value.map((item) => ({
    value: item.connectionId,
    label: item.label,
    active: true,
  })),
);

/** 当前选中 SDK 的安装阶段：登录不进 sdkPhase，只看状态机（见 composable §安装与登录） */
const installPhase = computed(() =>
  selectedSdk.value && sdkPhase.value?.templateId === selectedSdk.value.templateId
    ? sdkPhase.value
    : null,
);

/** 面板主钮：可用→刷模型；已装未登→登录（可带站点）；其余→开始接入 */
function onSdkPrimary(environment?: AgentSdkAuthEnvironment): void {
  const sdk = selectedSdk.value;
  if (!sdk) return;
  if (sdkReady(sdk.state)) {
    void refreshAgentSdkModels(sdk.templateId);
    return;
  }
  if (environment) {
    void loginAgentSdk(sdk.templateId, { environment });
    return;
  }
  if (["installed", "not_logged_in", "error"].includes(sdk.state)) {
    void loginAgentSdk(sdk.templateId, {});
    return;
  }
  void startAgentSdkInstall(sdk.templateId);
}

/** 模型列表默认只展示前几条，避免一屏过长。 */
const modelsExpanded = ref(false);

/**
 * 接入漏斗：null = 只显示两类入口；选中后才展开接入商下拉与配置。
 * 不跟 draftTemplateId 自动同步，避免一进页就摊开全量表单。
 */
const accessMode = ref<"agent-sdk" | "api" | null>(null);

const modelListOverflow = computed(() => filteredModels.value.length > MODEL_PREVIEW_COUNT);
const visibleModels = computed(() =>
  modelsExpanded.value || !modelListOverflow.value
    ? filteredModels.value
    : filteredModels.value.slice(0, MODEL_PREVIEW_COUNT),
);
const hiddenModelCount = computed(() =>
  Math.max(0, filteredModels.value.length - MODEL_PREVIEW_COUNT),
);

/** 已落盘连接 → 下拉绿点 */
const connectedTemplateIds = computed(
  () => new Set(connections.value.map((item) => item.templateId)),
);

/**
 * 入口卡图标：跟当前目录全量对齐。
 * 本地 App 按每条 SDK 列（产品各不同）；API 按 vendorId 去重（同厂多接入方式共用一标）。
 * active = 已接入（SDK ready / 该厂已有连接）→ 小绿点。
 */
const gateSdkMarks = computed(() =>
  agentSdks.value.map((sdk) => ({
    key: sdk.templateId,
    vendorId: templates.value.find((item) => item.id === sdk.templateId)?.vendorId ?? sdk.templateId,
    label: sdk.label,
    active: sdkReady(sdk.state),
  })),
);

const gateApiMarks = computed(() => {
  const connectedVendors = new Set(
    connections.value
      .map((item) => templates.value.find((template) => template.id === item.templateId)?.vendorId)
      .filter((id): id is string => Boolean(id)),
  );
  const seen = new Set<string>();
  const out: Array<{ key: string; vendorId: string; label: string; active: boolean }> = [];
  for (const item of apiTemplates.value) {
    if (seen.has(item.vendorId)) continue;
    seen.add(item.vendorId);
    out.push({
      key: item.vendorId,
      vendorId: item.vendorId,
      label: item.vendorLabel,
      active: connectedVendors.has(item.vendorId),
    });
  }
  return out;
});

/** 当前接入方式下的接入商下拉（不再级联「接入方式」——方式已在入口选定） */
const vendorOptions = computed(() => {
  if (accessMode.value === "agent-sdk") {
    return agentSdks.value.map((sdk) => ({
      value: sdk.templateId,
      label: sdk.label,
      hint: sdkStateLabel(sdk.state),
      active: sdkReady(sdk.state),
      icon: templates.value.find((item) => item.id === sdk.templateId)?.vendorId,
    }));
  }
  if (accessMode.value === "api") {
    return apiTemplates.value.map((item) => ({
      value: item.id,
      label: item.label,
      active: connectedTemplateIds.value.has(item.id),
      icon: item.vendorId,
    }));
  }
  return [];
});

/** API 接入商多，下拉开搜索；本地 App 项少保持默认 */
const draftTemplateSearchable = computed(() => accessMode.value === "api");

const accessModeLabel = computed(() =>
  accessMode.value === "agent-sdk"
    ? t("providerGateSdkTitle")
    : accessMode.value === "api"
      ? t("providerGateApiTitle")
      : "",
);

/** 点入口：锁定方式，并把 draft 落到该组第一项（若当前不在该组） */
function enterAccess(mode: "agent-sdk" | "api"): void {
  accessMode.value = mode;
  const inGroup =
    mode === "agent-sdk"
      ? templates.value.some(
          (item) => item.id === draftTemplateId.value && item.access === "agent-sdk",
        )
      : templates.value.some((item) => item.id === draftTemplateId.value && item.access === "api");
  if (inGroup) return;
  const first =
    mode === "agent-sdk"
      ? templates.value.find((item) => item.access === "agent-sdk")
      : templates.value.find((item) => item.access === "api");
  if (first) draftTemplateId.value = first.id;
}

function resetAccessGate(): void {
  accessMode.value = null;
}

watch([modelFilter, modelProviderFilter, modelEnabledOnly], () => {
  modelsExpanded.value = false;
});

/** 空列表文案：真没模型 / 仅已启用无结果 / 关键字或供应商筛空 */
const modelsEmptyCopy = computed(() => {
  if (!availableModels.value.length) {
    return connections.value.length ? t("providerNoMatch") : t("providerNeedConnection");
  }
  if (modelEnabledOnly.value && !modelFilter.value.trim()) return t("providerNoEnabled");
  return t("providerNoMatch");
});

/** 悬停：接入名 + 稳定 modelId（同名模型靠它区分） */
function modelRowTitle(model: {
  label?: string;
  vendorLabel: string;
  optionLabel: string;
  modelId: string;
  name: string;
}): string {
  const source = modelSourceLabel(model);
  return model.modelId !== model.name ? `${source} · ${model.modelId}` : source;
}
</script>

<template>
  <SettingsSectionShell :title="t('providerTitle')" :lead="t('providerLead')">
      <!-- 区一：接入配置（整块抬升面，与下方「启用」分区断档） -->
      <section
        class="grid gap-3 rounded-xl border border-foreground/12 bg-bubble p-3.5 shadow-sm animate-rise motion-reduce:animate-none sm:p-5"
        :aria-label="t('providerPickTitle')"
      >
        <header class="flex flex-wrap items-start justify-between gap-2">
          <div class="flex min-w-0 items-start gap-2.5">
            <!-- 步骤序号：灰阶角标，标这是第 1 件事 -->
            <span
              class="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-muted text-xs font-semibold tabular-nums text-foreground"
              aria-hidden="true"
            >{{ t("providerPickStep") }}</span>
            <div class="min-w-0">
              <h2 class="m-0 text-base font-semibold tracking-tight text-foreground">
                {{ t("providerPickTitle") }}
              </h2>
              <p class="mb-0 mt-1 max-w-xl text-xs leading-snug text-muted-foreground">
                {{ t("providerPickLead") }}
              </p>
            </div>
          </div>
          <span
            class="shrink-0 rounded-md border border-rule bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground"
          >
            {{
              connections.length
                ? tf("providerConnectedCount", { count: connections.length })
                : t("providerConnectHint")
            }}
          </span>
        </header>

        <!-- 漏斗入口：未选方式时只露两张大卡，避免一屏堆满下拉与表单 -->
        <div
          v-if="!loaded"
          class="grid gap-3 sm:grid-cols-2"
          role="status"
          aria-busy="true"
          :aria-label="t('providerLoading')"
        >
          <UiSkeleton rounded="xl" class="h-36 w-full" />
          <UiSkeleton rounded="xl" class="h-36 w-full" />
        </div>
        <div
          v-else-if="!accessMode"
          class="grid gap-3 sm:grid-cols-2"
          role="group"
          :aria-label="t('providerPickTitle')"
        >
          <!-- 入口：本地 Agent 应用（整卡可点：抬升边框 + 选择箭头） -->
          <button
            type="button"
            class="group grid cursor-pointer gap-3 rounded-xl border border-foreground/15 bg-background p-3.5 text-left shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-foreground/25 hover:bg-muted hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/15 active:translate-y-0 active:bg-muted active:shadow-sm disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:hover:translate-y-0 sm:p-4"
            :disabled="busy"
            @click="enterAccess('agent-sdk')"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="m-0 text-sm font-semibold text-foreground">{{ t("providerGateSdkTitle") }}</p>
                <p class="mb-0 mt-1 text-xs leading-snug text-muted-foreground">
                  {{ t("providerGateSdkLead") }}
                </p>
              </div>
              <span
                class="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-rule bg-bubble px-2 py-1 text-xs font-medium text-muted-foreground transition duration-200 group-hover:border-foreground/20 group-hover:text-foreground"
              >
                {{ t("providerGateChoose") }}
                <ChevronRightIcon
                  class="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none"
                  aria-hidden="true"
                />
              </span>
            </div>
            <ul class="m-0 flex list-none flex-wrap items-center gap-2 p-0" aria-hidden="true">
              <li
                v-for="mark in gateSdkMarks"
                :key="mark.key"
                class="relative grid size-8 place-items-center rounded-lg border border-rule bg-bubble transition duration-200 group-hover:border-foreground/15"
                :title="mark.active ? `${mark.label} · ${t('providerConfiguredActive')}` : mark.label"
              >
                <ProviderLogo size="md" :vendor-id="mark.vendorId" :label="mark.label" />
                <!-- 已接入：角上小绿点，对齐下拉 active 语义 -->
                <span
                  v-if="mark.active"
                  class="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-emerald-500 ring-2 ring-background"
                />
              </li>
            </ul>
          </button>
          <!-- 入口：API 服务 -->
          <button
            type="button"
            class="group grid cursor-pointer gap-3 rounded-xl border border-foreground/15 bg-background p-3.5 text-left shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-foreground/25 hover:bg-muted hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/15 active:translate-y-0 active:bg-muted active:shadow-sm disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:hover:translate-y-0 sm:p-4"
            :disabled="busy"
            @click="enterAccess('api')"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="m-0 text-sm font-semibold text-foreground">{{ t("providerGateApiTitle") }}</p>
                <p class="mb-0 mt-1 text-xs leading-snug text-muted-foreground">
                  {{ t("providerGateApiLead") }}
                </p>
              </div>
              <span
                class="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-rule bg-bubble px-2 py-1 text-xs font-medium text-muted-foreground transition duration-200 group-hover:border-foreground/20 group-hover:text-foreground"
              >
                {{ t("providerGateChoose") }}
                <ChevronRightIcon
                  class="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none"
                  aria-hidden="true"
                />
              </span>
            </div>
            <ul class="m-0 flex list-none flex-wrap items-center gap-2 p-0" aria-hidden="true">
              <li
                v-for="mark in gateApiMarks"
                :key="mark.key"
                class="relative grid size-8 place-items-center rounded-lg border border-rule bg-bubble transition duration-200 group-hover:border-foreground/15"
                :title="mark.active ? `${mark.label} · ${t('providerConfiguredActive')}` : mark.label"
              >
                <ProviderLogo size="md" :vendor-id="mark.vendorId" :label="mark.label" />
                <span
                  v-if="mark.active"
                  class="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-emerald-500 ring-2 ring-background"
                />
              </li>
            </ul>
          </button>
        </div>

        <!-- 已选方式：接入商下拉 + 配置；左上角普通返回 -->
        <template v-else>
          <div class="grid gap-2">
            <button
              type="button"
              class="inline-flex min-h-8 w-fit items-center gap-1 rounded-lg px-1.5 text-sm text-muted-foreground transition duration-200 hover:bg-muted hover:text-foreground disabled:opacity-50"
              :disabled="busy"
              @click="resetAccessGate"
            >
              <ArrowLeftIcon class="size-3.5 shrink-0" aria-hidden="true" />
              {{ t("providerGateChange") }}
            </button>
            <p class="m-0 text-xs font-semibold tracking-wide text-muted-foreground">
              {{ accessModeLabel }}
            </p>
          </div>

          <div class="rounded-lg border border-rule bg-background p-3 sm:p-3.5">
            <AppSelect
              v-model="draftTemplateId"
              emphasis
              :searchable="draftTemplateSearchable"
              :label="t('providerAccessVendor')"
              :options="vendorOptions"
              :disabled="busy"
              :active-hint="t('providerConfiguredActive')"
              :search-placeholder="t('providerSelectSearch')"
              :search-empty="t('providerSelectSearchEmpty')"
            />
          </div>

          <!-- 连接配置：选完接入商后才填 -->
          <div class="grid gap-3 border-t border-rule pt-3">
            <p class="m-0 text-xs font-semibold tracking-wide text-muted-foreground">
              {{ t("providerConnectConfig") }}
            </p>

            <!-- 本地 Agent App：Base 面板 + 能力 parts（选站 / 验证码 / Key） -->
            <AgentSdkConnectPanel
              v-if="sdkSelected && selectedSdk"
              v-model:api-key-draft="sdkLoginApiKeyDraft"
              :sdk="selectedSdk"
              :vendor-id="selectedTemplate?.vendorId"
              :busy="busy"
              :sdk-busy="sdkBusy"
              :models-busy="sdkModelsBusy"
              :install-phase="installPhase"
              :device-code="sdkLoginDeviceCode"
              :login-needs-api-key="sdkLoginNeedsApiKey"
              :login-auth-url="sdkLoginAuthUrl"
              @primary="onSdkPrimary"
              @check="checkAgentSdkLogin(selectedSdk.templateId)"
              @logout="logoutAgentSdk(selectedSdk.templateId)"
              @uninstall="uninstallAgentSdk(selectedSdk.templateId)"
              @submit-api-key="submitAgentSdkApiKey(selectedSdk.templateId)"
              @open-api-key-doc="openAgentSdkApiKeyDoc"
              @cancel-login="cancelAgentSdkLogin(selectedSdk.templateId)"
              @cancel-install="cancelAgentSdkInstall(selectedSdk.templateId)"
            />

          <!-- API Key 接入：填地址、密钥、本连接模型 -->
          <form v-else class="grid gap-3" @submit.prevent="saveConnection">
            <p v-if="selectedTemplate?.hint" class="m-0 text-xs leading-snug text-muted-foreground">
              {{ selectedTemplate.hint }}
            </p>
            <!-- 发现策略说明：Ollama 自动；自定义多手配 -->
            <p
              v-if="needsBaseUrl"
              class="m-0 text-xs leading-snug text-muted-foreground"
            >
              {{
                selectedTemplate?.kind === "ollama"
                  ? t("providerDiscoverOllamaHint")
                  : t("providerDiscoverCustomHint")
              }}
            </p>

            <!-- 多端点才显示切换；单 Ollama 实例不打扰 -->
            <div v-if="showEndpointSwitcher" class="grid gap-2">
              <p
                v-if="!draftConnectionId && templateConnections.length > 0"
                class="m-0 text-xs leading-snug text-muted-foreground"
              >
                {{ t("providerNewEndpointDraft") }}
              </p>
              <AppSelect
                v-else-if="templateConnections.length > 1 && draftConnectionId"
                v-model="draftConnectionId"
                :label="t('providerEndpointSelect')"
                :options="endpointOptions"
                :disabled="busy"
                :active-hint="t('providerConfiguredActive')"
                @update:model-value="selectEndpoint"
              />
              <button
                v-if="!draftConnectionId && templateConnections.length > 0"
                type="button"
                :disabled="busy"
                class="min-h-8 justify-self-start rounded-lg border border-rule bg-paper px-3 text-sm font-medium text-foreground transition duration-200 hover:bg-muted disabled:opacity-50"
                @click="selectEndpoint(templateConnections[0]!.connectionId)"
              >
                {{ t("providerBackToEndpoint") }}
              </button>
            </div>

            <label v-if="needsBaseUrl" class="grid gap-1.5 text-sm font-medium text-foreground">
              <span>
                {{ t("providerBaseUrl") }}
                <span class="text-destructive" aria-hidden="true">*</span>
              </span>
              <input
                v-model="draftBaseUrl"
                type="url"
                required
                :disabled="busy"
                autocomplete="off"
                class="min-h-8 rounded-lg border border-rule bg-paper px-3 py-1.5 font-mono text-sm text-foreground outline-none transition duration-200 focus:border-accent focus:bg-background focus:ring-2 focus:ring-accent/15 disabled:opacity-60"
                :placeholder="
                  selectedTemplate?.kind === 'ollama'
                    ? t('providerBaseUrlPlaceholderOllama')
                    : t('providerBaseUrlPlaceholderCustom')
                "
              />
            </label>

            <label v-if="needsApiKey" class="grid gap-1.5 text-sm font-medium text-foreground">
              <span>
                API Key
                <span v-if="apiKeyRequired" class="text-destructive" aria-hidden="true">*</span>
              </span>
              <input
                v-model="draftApiKey"
                type="password"
                :required="apiKeyRequired"
                :disabled="busy"
                autocomplete="off"
                class="min-h-8 rounded-lg border border-rule bg-paper px-3 py-1.5 font-mono text-sm text-foreground outline-none transition duration-200 focus:border-accent focus:bg-background focus:ring-2 focus:ring-accent/15 disabled:opacity-60"
                :placeholder="existingConnection?.hasApiKey ? t('providerApiKeyKeep') : t('providerApiKeyPaste')"
              />
            </label>

            <!-- 本连接模型：发现 + 手配，可删改手配项 -->
            <div
              v-if="needsBaseUrl"
              class="grid gap-2 rounded-lg border border-rule bg-paper/60 p-3"
            >
              <div class="flex flex-wrap items-center justify-between gap-2">
                <p class="m-0 text-sm font-medium text-foreground">{{ t("providerInlineModelsTitle") }}</p>
                <button
                  v-if="existingConnection && selectedTemplate?.supportsModelDiscovery"
                  type="button"
                  :disabled="busy"
                  class="min-h-8 shrink-0 rounded-lg border border-rule bg-background px-3 text-sm font-medium text-foreground transition duration-200 hover:bg-muted disabled:opacity-50"
                  @click="refreshCurrentConnectionModels"
                >
                  {{ busy ? t("providerSdkRefreshingModels") : t("providerSdkRefreshThis") }}
                </button>
              </div>
              <p class="m-0 text-xs leading-snug text-muted-foreground">
                {{ t("providerInlineModelsLead") }}
              </p>
              <!-- 已有模型：手配可改/删；自动发现只读 -->
              <ul
                v-if="inlineConnectionModels.length"
                class="m-0 grid list-none gap-1 p-0"
              >
                <li
                  v-for="model in inlineConnectionModels"
                  :key="`${model.connectionId}::${model.modelId}`"
                  class="flex min-h-8 items-center gap-2 rounded-md px-2 py-1 text-sm"
                >
                  <template v-if="editingModelKey === `${model.connectionId}::${model.modelId}`">
                    <input
                      v-model="editingModelId"
                      type="text"
                      :disabled="busy"
                      autocomplete="off"
                      spellcheck="false"
                      class="min-h-8 min-w-0 flex-1 rounded-lg border border-rule bg-background px-2 py-1 font-mono text-sm text-foreground outline-none transition duration-200 focus:border-accent focus:ring-2 focus:ring-accent/15 disabled:opacity-60"
                      @keydown.enter.prevent="saveEditInlineModel(model)"
                      @keydown.escape.prevent="cancelEditInlineModel"
                    />
                    <button
                      type="button"
                      :disabled="busy || !editingModelId.trim()"
                      class="shrink-0 rounded-md p-1 text-foreground transition duration-200 hover:bg-muted disabled:opacity-50"
                      :aria-label="t('providerSaveModelEdit')"
                      @click="saveEditInlineModel(model)"
                    >
                      <CheckIcon class="size-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      :disabled="busy"
                      class="shrink-0 rounded-md p-1 text-muted-foreground transition duration-200 hover:bg-muted disabled:opacity-50"
                      :aria-label="t('cancel')"
                      @click="cancelEditInlineModel"
                    >
                      <XIcon class="size-3.5" aria-hidden="true" />
                    </button>
                  </template>
                  <template v-else>
                    <span class="min-w-0 flex-1 truncate font-mono text-foreground">{{ model.modelId }}</span>
                    <span
                      v-if="!model.custom"
                      class="shrink-0 rounded-md border border-rule bg-muted px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground"
                    >
                      {{ t("providerModelDiscovered") }}
                    </span>
                    <button
                      v-if="model.custom"
                      type="button"
                      :disabled="busy"
                      class="shrink-0 rounded-md p-1 text-muted-foreground transition duration-200 hover:bg-muted hover:text-foreground disabled:opacity-50"
                      :aria-label="tf('providerEditModel', { name: model.modelId })"
                      @click="startEditInlineModel(model)"
                    >
                      <PencilIcon class="size-3.5" aria-hidden="true" />
                    </button>
                    <button
                      v-if="model.custom"
                      type="button"
                      :disabled="busy"
                      class="shrink-0 rounded-md p-1 text-muted-foreground transition duration-200 hover:bg-danger-soft hover:text-destructive disabled:opacity-50"
                      :aria-label="tf('providerRemoveModel', { name: model.modelId })"
                      @click="removeCustomModel(model)"
                    >
                      <Trash2Icon class="size-3.5" aria-hidden="true" />
                    </button>
                  </template>
                </li>
              </ul>
              <p
                v-else-if="existingConnection"
                class="m-0 text-xs text-muted-foreground"
              >
                {{ t("providerInlineModelsEmpty") }}
              </p>
              <div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <label class="grid gap-1.5 text-sm font-medium text-foreground">
                  {{ t("providerAddModelId") }}
                  <input
                    v-model="draftInlineModelId"
                    type="text"
                    :disabled="busy"
                    autocomplete="off"
                    spellcheck="false"
                    :placeholder="t('providerAddModelPlaceholder')"
                    class="min-h-8 rounded-lg border border-rule bg-background px-3 py-1.5 font-mono text-sm text-foreground outline-none transition duration-200 focus:border-accent focus:ring-2 focus:ring-accent/15 disabled:opacity-60"
                  />
                </label>
                <button
                  type="button"
                  :disabled="busy || !draftInlineModelId.trim()"
                  class="min-h-8 shrink-0 rounded-lg border border-rule bg-background px-3 text-sm font-medium text-foreground transition duration-200 hover:bg-muted disabled:opacity-50"
                  @click="addInlineCustomModel"
                >
                  {{ existingConnection ? t("providerAddModel") : t("providerSaveAndAddModel") }}
                </button>
              </div>
            </div>

            <p
              v-if="overridden"
              class="rounded-lg border border-amber-300/40 bg-warning-soft px-3 py-2 text-sm text-warning-foreground"
            >
              {{ t("providerEnvOverride") }}
            </p>

            <div class="grid gap-3 border-t border-rule pt-3">
              <p class="m-0 text-xs leading-snug text-muted-foreground">
                <span v-if="existingConnection">{{ tf("providerConnected", { label: existingConnection.label }) }}</span>
                {{ t("providerGuestHint") }}
              </p>
              <div class="flex flex-wrap items-center justify-between gap-2">
                <!-- 进阶：同模板再挂一台（默认单实例不露出「当前端点」） -->
                <button
                  v-if="canAddAnotherEndpoint && draftConnectionId"
                  type="button"
                  :disabled="busy"
                  class="min-h-8 shrink-0 rounded-lg px-2 text-sm text-muted-foreground transition duration-200 hover:text-foreground disabled:opacity-50"
                  @click="startAnotherEndpoint"
                >
                  {{ t("providerAddEndpoint") }}
                </button>
                <span v-else class="min-w-0" />
                <div class="flex flex-wrap items-center justify-end gap-2">
                  <button
                    v-if="existingConnection"
                    type="button"
                    :disabled="busy"
                    class="min-h-8 shrink-0 rounded-lg border border-rule bg-paper px-3 text-sm font-medium text-destructive transition duration-200 hover:bg-danger-soft disabled:opacity-50"
                    @click="removeConnection(existingConnection.connectionId)"
                  >
                    {{ t("providerRemove") }}
                  </button>
                  <button
                    type="submit"
                    :disabled="busy"
                    class="min-h-8 shrink-0 rounded-lg bg-accent px-3 text-sm font-semibold text-white transition duration-200 hover:bg-accent-deep disabled:opacity-50"
                  >
                    {{ busy ? t("saving") : existingConnection ? t("providerUpdate") : t("providerSave") }}
                  </button>
                </div>
              </div>
            </div>
          </form>
          </div>
        </template>
      </section>

      <!-- 区界：无文案分隔线，只拉开两块职责 -->
      <div
        class="py-1 animate-rise motion-reduce:animate-none [animation-delay:40ms]"
        role="separator"
      >
        <span class="block h-px w-full bg-rule" aria-hidden="true" />
      </div>

      <!-- 区二：启用服务（纸面底，与上方 bubble 接入区对比） -->
      <section
        class="grid gap-3 rounded-xl border border-rule bg-paper p-3.5 animate-rise motion-reduce:animate-none [animation-delay:60ms] sm:p-5"
        :aria-label="t('providerEnableServices')"
      >
        <header class="flex flex-wrap items-start justify-between gap-2">
          <div class="flex min-w-0 flex-1 items-start gap-2.5">
            <span
              class="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-muted text-xs font-semibold tabular-nums text-foreground"
              aria-hidden="true"
            >{{ t("providerEnableStep") }}</span>
            <div class="min-w-0">
              <h2 class="m-0 text-base font-semibold tracking-tight text-foreground">
                {{ t("providerEnableServices") }}
              </h2>
              <p class="mb-0 mt-1 max-w-xl text-xs leading-snug text-muted-foreground">
                {{ t("providerEnableLead") }}
              </p>
            </div>
          </div>
          <!-- 刷新全部：busy 整段可能很长，钮上转圈 + 文案，避免用户以为点了没反应 -->
          <button
            v-if="canRefreshModels"
            type="button"
            :disabled="busy || sdkModelsBusy"
            class="inline-flex min-h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-rule bg-background px-3 text-sm font-medium text-foreground transition duration-200 hover:bg-muted disabled:opacity-50"
            :aria-busy="busy || sdkModelsBusy ? 'true' : undefined"
            @click="refreshAllDiscoverableModels"
          >
            <LoaderCircleIcon
              v-if="busy || sdkModelsBusy"
              class="size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            {{
              busy || sdkModelsBusy
                ? t("providerSdkRefreshingModels")
                : t("providerRefreshModels")
            }}
          </button>
        </header>

        <!-- 首次拉配置用骨架，不做纯文案加载态 -->
        <div
          v-if="!loaded"
          class="grid gap-2"
          role="status"
          aria-busy="true"
          :aria-label="t('providerLoading')"
        >
          <div v-for="index in 3" :key="index" class="flex items-center gap-2.5 px-2.5 py-2.5">
            <UiSkeleton rounded="md" class="size-5 shrink-0" />
            <UiSkeleton rounded="md" class="h-3.5 min-w-0 flex-1" />
            <UiSkeleton rounded="md" class="h-3 w-10" />
            <UiSkeleton rounded="lg" class="h-6 w-11" />
          </div>
        </div>

        <template v-else>
          <!-- 供应商下拉 + 搜索：先按已存在供应商收窄，再按关键字搜；两列都 min-w-0 防长名撑破叠遮 -->
          <div
            class="grid gap-2 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] sm:items-end"
          >
            <AppSelect
              v-model="modelProviderFilter"
              class="min-w-0"
              :label="t('providerFilterVendor')"
              :options="modelProviderFilterOptions"
              :disabled="busy"
            />
            <label class="grid min-w-0 gap-1.5 text-sm font-medium text-foreground">
              <span>{{ t("providerSearchModels") }}</span>
              <input
                v-model="modelFilter"
                type="search"
                :disabled="busy"
                :placeholder="t('providerSearchModels')"
                class="min-h-9 w-full min-w-0 rounded-lg border border-rule bg-background px-3 py-1.5 text-sm font-normal text-foreground outline-none transition duration-200 focus:border-accent focus:ring-2 focus:ring-accent/15 disabled:opacity-60"
              />
            </label>
          </div>
          <!-- 仅已启用：叠在供应商 / 关键字上，默认关 -->
          <label
            class="mt-2 flex cursor-pointer items-center gap-2 text-sm text-muted-foreground transition duration-200 hover:text-foreground"
          >
            <input
              v-model="modelEnabledOnly"
              type="checkbox"
              :disabled="busy"
              class="size-4 rounded border-rule text-accent accent-accent disabled:opacity-50"
            />
            <span>{{ t("providerFilterEnabledOnly") }}</span>
          </label>

          <!-- 手动添加：顶部分隔折叠，不加内层纸面卡 -->
          <details
            v-if="canAddCustomModel"
            class="group/add relative z-10 mt-3 border-t border-rule pt-2"
          >
            <summary
              class="flex min-h-8 cursor-pointer list-none items-center justify-between gap-2 py-1.5 text-sm text-muted-foreground outline-none transition duration-200 hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/15 [&::-webkit-details-marker]:hidden"
            >
              <span class="min-w-0 flex-1 text-left leading-snug">{{ t("providerAddModelToggle") }}</span>
              <ChevronDownIcon
                class="size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-open/add:rotate-180 motion-reduce:transition-none"
                aria-hidden="true"
              />
            </summary>
            <form class="pt-2" @submit.prevent="addCustomModel">
              <p class="mb-0 text-xs leading-snug text-muted-foreground">
                {{ t("providerAddModelLead") }}
              </p>
              <div class="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <div class="grid min-w-0 gap-2">
                  <AppSelect
                    v-if="customModelTargets.length > 1"
                    v-model="draftAddConnectionId"
                    :label="t('providerAddModelTarget')"
                    :options="addTargetOptions"
                    :disabled="busy"
                    :active-hint="t('providerConfiguredActive')"
                  />
                  <label class="grid gap-1.5 text-sm font-medium text-foreground">
                    {{ t("providerAddModelId") }}
                    <input
                      v-model="draftCustomModelId"
                      type="text"
                      :disabled="busy"
                      autocomplete="off"
                      spellcheck="false"
                      :placeholder="t('providerAddModelPlaceholder')"
                      class="min-h-8 rounded-lg border border-rule bg-background px-3 py-1.5 font-mono text-sm text-foreground outline-none transition duration-200 focus:border-accent focus:ring-2 focus:ring-accent/15 disabled:opacity-60"
                    />
                  </label>
                </div>
                <button
                  type="submit"
                  :disabled="busy"
                  class="min-h-8 shrink-0 rounded-lg border border-rule bg-background px-3 text-sm font-medium text-foreground transition duration-200 hover:bg-muted disabled:opacity-50"
                >
                  {{ t("providerAddModel") }}
                </button>
              </div>
            </form>
          </details>

          <!-- 模型行：单色标 · 名称 · 倍率 · 开关，对齐 Composer 下拉参考稿 -->
          <ul v-if="filteredModels.length" class="m-0 mt-3 grid list-none gap-0.5 p-0">
            <li
              v-for="model in visibleModels"
              :key="`${model.connectionId}::${model.modelId}`"
              class="flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 transition duration-150 hover:bg-muted"
              :title="modelRowTitle(model)"
            >
              <ProviderLogo size="md" :vendor-id="model.vendorId" :label="model.vendorLabel" />
              <!-- 窄宽：主名独占首行；modelId 落到次行 tag 后，避免挤掉开关 -->
              <div class="min-w-0 flex-1 overflow-hidden">
                <p class="m-0 truncate text-sm font-medium text-foreground">
                  {{ model.name }}
                </p>
                <div class="mt-0.5 flex min-w-0 items-center gap-1.5">
                  <span
                    class="inline-flex shrink-0 truncate rounded-md border border-rule bg-muted px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground"
                  >
                    {{ modelSourceLabel(model) }}
                  </span>
                  <span
                    v-if="model.modelId !== model.name"
                    class="min-w-0 truncate font-mono text-xs text-muted-foreground"
                  >
                    {{ model.modelId }}
                  </span>
                </div>
              </div>
              <!-- 上下文长度：有已知窗口才显示（如 1M ctx） -->
              <span
                v-if="model.contextWindow !== undefined"
                class="shrink-0 rounded-md border border-rule bg-muted px-1.5 py-0.5 tabular-nums text-[10px] font-medium leading-none text-muted-foreground"
                :title="t('providerModelContextHint')"
              >
                {{ formatTokenWindow(model.contextWindow) }} ctx
              </span>
              <!-- credit 倍率：本地 App 才有；0 也显示，不能靠 falsy -->
              <span
                v-if="model.credits !== undefined"
                class="shrink-0 tabular-nums text-xs text-muted-foreground"
                :title="t('providerModelCreditsHint')"
              >
                {{ model.credits.toFixed(2) }}x
              </span>
              <div class="flex shrink-0 items-center gap-1">
                <button
                  v-if="model.custom"
                  type="button"
                  :disabled="busy"
                  class="inline-flex size-8 items-center justify-center rounded-lg border-0 text-muted-foreground transition duration-200 hover:bg-danger-soft hover:text-destructive disabled:opacity-50"
                  :aria-label="tf('providerRemoveModel', { name: model.name })"
                  @click="removeCustomModel(model)"
                >
                  <Trash2Icon class="size-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  role="switch"
                  :aria-checked="model.enabled"
                  :disabled="busy"
                  class="relative h-6 w-11 shrink-0 rounded-full border-0 transition duration-200 disabled:opacity-50"
                  :class="model.enabled ? 'bg-emerald-500' : 'bg-muted'"
                  :aria-label="model.enabled ? tf('providerDisableAria', { name: model.name }) : tf('providerEnableAria', { name: model.name })"
                  @click="toggleModel(model, !model.enabled)"
                >
                  <span
                    class="absolute top-0.5 size-5 rounded-full bg-paper shadow transition duration-200"
                    :class="model.enabled ? 'left-5' : 'left-0.5'"
                  />
                </button>
              </div>
            </li>
          </ul>
          <button
            v-if="modelListOverflow"
            type="button"
            class="mt-2 min-h-8 w-full rounded-lg px-2 text-sm font-medium text-muted-foreground transition duration-200 hover:bg-muted hover:text-foreground"
            @click="modelsExpanded = !modelsExpanded"
          >
            {{
              modelsExpanded
                ? t("providerModelsCollapse")
                : tf("providerModelsExpand", { count: hiddenModelCount })
            }}
          </button>
          <p v-else-if="!filteredModels.length" class="mb-0 mt-4 text-sm text-muted-foreground">
            {{ modelsEmptyCopy }}
          </p>
        </template>

        <!-- 平台 AI 占位：虚线提示，不算内容卡 -->
        <div class="mt-8 border-t border-dashed border-rule pt-4 text-muted-foreground">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="m-0 text-sm font-semibold text-foreground">{{ t("providerPlatformTitle") }}</p>
            <span class="rounded-md border border-rule bg-background px-2 py-0.5 text-xs font-medium">{{ t("providerPlatformSoon") }}</span>
          </div>
          <p class="mb-0 mt-1.5 text-xs leading-snug">{{ t("providerPlatformBody") }}</p>
        </div>
      </section>
  </SettingsSectionShell>
</template>

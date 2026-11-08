<script setup lang="ts">
import { ChevronDownIcon, LoaderCircleIcon, Trash2Icon } from "@lucide/vue";
import { computed, ref, watch } from "vue";

import AppSelect from "../../../../../shared/components/AppSelect.vue";
import ProviderLogo from "../../../../../shared/components/ProviderLogo.vue";
import UiSkeleton from "../../../../../shared/components/UiSkeleton.vue";
import { formatTokenWindow } from "../../../../../shared/lib/format-tokens";
import { modelSourceLabel } from "../../../../../shared/model/provider/model-source-label";
import type { AgentSdkAuthEnvironment } from "../../../../../shared/model/runtime/runtime";
import { t, tf } from "../../../../../shared/model/ui/ui-locale";
import { useProviderSettings } from "../../../composables/useProviderSettings";
import SettingsBlock from "../../SettingsBlock.vue";
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
  draftBaseUrl,
  draftApiKey,
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
  canRefreshModels,
  canAddCustomModel,
  customModelTargets,
  draftCustomModelId,
  draftAddTemplateId,
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
  removeCustomModel,
  toggleModel,
} = useProviderSettings();

const addTargetOptions = computed(() =>
  customModelTargets.value.map((item) => ({
    value: item.templateId,
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

/** 连接服务商为次要操作，默认折叠；选了本地 App 就摊开（要看到安装按钮） */
const providerOpen = ref(false);
/** 模型列表默认只展示前几条，避免一屏过长。 */
const modelsExpanded = ref(false);

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
 * 级联下拉用：group = 接入方式，value = 接入商。
 * Agent App 在前，便于默认落到本地接入；选中后下方表单整体切换。
 */
const entryOptions = computed(() => [
  ...agentSdks.value.map((sdk) => ({
    value: sdk.templateId,
    label: sdk.label,
    group: t("providerAccessSdk"),
    hint: sdkStateLabel(sdk.state),
    active: sdkReady(sdk.state),
    // 本地 App 卡片不带 vendorId，从全量模板目录取
    icon: templates.value.find((item) => item.id === sdk.templateId)?.vendorId,
  })),
  ...apiTemplates.value.map((item) => ({
    value: item.id,
    label: item.label,
    group: t("providerAccessApi"),
    active: connectedTemplateIds.value.has(item.id),
    icon: item.vendorId,
  })),
]);

/** 仅 API Key 接入商多，给右侧下拉开搜索；本地 App / 其它下拉保持默认无搜索 */
const draftTemplateSearchable = computed(
  () =>
    entryOptions.value.find((item) => item.value === draftTemplateId.value)?.group ===
    t("providerAccessApi"),
);

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
      <!-- 主区：启用服务（API Key 与本地 Agent App 的模型都在这里） -->
      <SettingsBlock
        :title="t('providerEnableServices')"
        :description="t('providerEnableLead')"
      >
        <template v-if="canRefreshModels" #actions>
          <!-- 刷新全部：busy 整段可能很长，钮上转圈 + 文案，避免用户以为点了没反应 -->
          <button
            type="button"
            :disabled="busy || sdkModelsBusy"
            class="inline-flex min-h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-rule bg-paper px-3 text-sm font-medium text-foreground transition duration-200 hover:bg-muted disabled:opacity-50"
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
        </template>

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
                class="min-h-9 w-full min-w-0 rounded-lg border border-rule bg-paper px-3 py-1.5 text-sm font-normal text-foreground outline-none transition duration-200 focus:border-accent focus:bg-background focus:ring-2 focus:ring-accent/15 disabled:opacity-60"
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
                    v-model="draftAddTemplateId"
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
                      class="min-h-8 rounded-lg border border-rule bg-paper px-3 py-1.5 font-mono text-sm text-foreground outline-none transition duration-200 focus:border-accent focus:bg-background focus:ring-2 focus:ring-accent/15 disabled:opacity-60"
                    />
                  </label>
                </div>
                <button
                  type="submit"
                  :disabled="busy"
                  class="min-h-8 shrink-0 rounded-lg border border-rule bg-paper px-3 text-sm font-medium text-foreground transition duration-200 hover:bg-muted disabled:opacity-50"
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
              :key="`${model.templateId}::${model.modelId}`"
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
        <div class="mt-10 border-t border-dashed border-rule pt-4 text-muted-foreground">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="m-0 text-sm font-semibold text-foreground">{{ t("providerPlatformTitle") }}</p>
            <span class="rounded-md border border-rule bg-paper px-2 py-0.5 text-xs font-medium">{{ t("providerPlatformSoon") }}</span>
          </div>
          <p class="mb-0 mt-1.5 text-xs leading-snug">{{ t("providerPlatformBody") }}</p>
        </div>
      </SettingsBlock>

      <!-- 次区：添加服务；扁平折叠，不套纸面卡 -->
      <details
        class="group/connect"
        :open="providerOpen || !connections.length || sdkSelected"
        @toggle="providerOpen = ($event.target as HTMLDetailsElement).open"
      >
        <summary
          class="cursor-pointer list-none outline-none [&::-webkit-details-marker]:hidden"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="m-0 text-sm font-semibold text-foreground">{{ t("providerConnect") }}</p>
            </div>
            <div class="flex shrink-0 items-center gap-2 pt-0.5">
              <span class="text-xs text-muted-foreground">
                {{ connections.length ? tf("providerConnectedCount", { count: connections.length }) : t("providerConnectHint") }}
              </span>
              <ChevronDownIcon
                class="size-3.5 text-muted-foreground transition-transform duration-200 group-open/connect:rotate-180 motion-reduce:transition-none"
                aria-hidden="true"
              />
            </div>
          </div>
        </summary>

        <div class="mt-3 grid gap-3">
          <!-- 骨架：级联两列下拉 + 表单占位 -->
          <div
            v-if="!loaded"
            class="grid gap-3"
            role="status"
            aria-busy="true"
            :aria-label="t('providerLoading')"
          >
            <div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <div class="grid gap-1.5">
                <UiSkeleton rounded="md" class="h-3 w-16" />
                <UiSkeleton rounded="lg" class="h-8 w-full" />
              </div>
              <div class="grid gap-1.5">
                <UiSkeleton rounded="md" class="h-3 w-16" />
                <UiSkeleton rounded="lg" class="h-8 w-full" />
              </div>
            </div>
            <UiSkeleton rounded="lg" class="h-8 w-full" />
          </div>

          <div v-else class="grid gap-3">
            <AppSelect
              v-model="draftTemplateId"
              cascade
              :searchable="draftTemplateSearchable"
              :group-label="t('providerAccessKicker')"
              :label="t('providerAccessVendor')"
              :default-group="t('providerAccessSdk')"
              :options="entryOptions"
              :disabled="busy"
              :active-hint="t('providerConfiguredActive')"
              :search-placeholder="t('providerSelectSearch')"
              :search-empty="t('providerSelectSearchEmpty')"
            />

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

            <!-- API Key 接入：填地址与密钥 -->
            <form v-else class="grid gap-3" @submit.prevent="saveConnection">
              <p v-if="selectedTemplate?.hint" class="m-0 text-xs leading-snug text-muted-foreground">
                {{ selectedTemplate.hint }}
              </p>

              <label v-if="needsBaseUrl" class="grid gap-1.5 text-sm font-medium text-foreground">
                {{ t("providerBaseUrl") }}
                <input
                  v-model="draftBaseUrl"
                  type="url"
                  required
                  :disabled="busy"
                  autocomplete="off"
                  class="min-h-8 rounded-lg border border-rule bg-paper px-3 py-1.5 font-mono text-sm text-foreground outline-none transition duration-200 focus:border-accent focus:bg-background focus:ring-2 focus:ring-accent/15 disabled:opacity-60"
                  placeholder="http://localhost:11434/v1"
                />
              </label>

              <label v-if="needsApiKey" class="grid gap-1.5 text-sm font-medium text-foreground">
                API Key
                <input
                  v-model="draftApiKey"
                  type="password"
                  :disabled="busy"
                  autocomplete="off"
                  class="min-h-8 rounded-lg border border-rule bg-paper px-3 py-1.5 font-mono text-sm text-foreground outline-none transition duration-200 focus:border-accent focus:bg-background focus:ring-2 focus:ring-accent/15 disabled:opacity-60"
                  :placeholder="existingConnection?.hasApiKey ? t('providerApiKeyKeep') : t('providerApiKeyPaste')"
                />
              </label>

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
                <div class="flex flex-wrap items-center justify-end gap-2">
                  <button
                    v-if="existingConnection"
                    type="button"
                    :disabled="busy"
                    class="min-h-8 shrink-0 rounded-lg border border-rule bg-paper px-3 text-sm font-medium text-destructive transition duration-200 hover:bg-danger-soft disabled:opacity-50"
                    @click="removeConnection(existingConnection.templateId)"
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
            </form>
          </div>
        </div>
      </details>
  </SettingsSectionShell>
</template>

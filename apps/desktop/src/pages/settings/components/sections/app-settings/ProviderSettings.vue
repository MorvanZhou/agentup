<script setup lang="ts">
import { ChevronDownIcon, LogOutIcon, Trash2Icon } from "@lucide/vue";
import { computed, ref, watch } from "vue";

import AppDialog from "../../../../../shared/components/AppDialog.vue";
import AppSelect from "../../../../../shared/components/AppSelect.vue";
import ProviderLogo from "../../../../../shared/components/ProviderLogo.vue";
import UiSkeleton from "../../../../../shared/components/UiSkeleton.vue";
import type { AgentSdkOption } from "../../../../../shared/model/runtime/runtime";
import { showToast } from "../../../../../shared/model/ui/toast";
import { t, tf } from "../../../../../shared/model/ui/ui-locale";
import { useProviderSettings } from "../../../composables/useProviderSettings";

const MODEL_PREVIEW_COUNT = 5;

const {
  connections,
  filteredModels,
  modelProviderFilterOptions,
  overridden,
  busy,
  draftTemplateId,
  draftBaseUrl,
  draftApiKey,
  modelFilter,
  modelProviderFilter,
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
  sdkPhase,
  sdkLoginDeviceCode,
  startAgentSdkInstall,
  loginAgentSdk,
  checkAgentSdkLogin,
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

/** 状态机 → 状态标签词条（见 .cursor/skills/agentup-sdk-adapter/references/overview.md §2） */
const SDK_STATE_KEYS: Record<string, string> = {
  not_installed: "providerSdkStateNotInstalled",
  installing: "providerSdkStateInstalling",
  install_failed: "providerSdkStateInstallFailed",
  installed: "providerSdkStateInstalled",
  not_logged_in: "providerSdkStateNotLoggedIn",
  logging_in: "providerSdkStateLoggingIn",
  ready: "providerSdkStateReady",
  error: "providerSdkStateError",
};

function sdkStateLabel(state: string): string {
  return t(SDK_STATE_KEYS[state] ?? "providerSdkStateNotInstalled");
}

/** 只有 ready 才算可用；其余状态走「开始接入 / 登录」 */
const sdkReady = (state: string): boolean => state === "ready";
/** 已装未登录 → 登录；没装或装失败 → 装 */
const needsLogin = (state: string): boolean =>
  ["installed", "not_logged_in", "error"].includes(state);
const busyState = (state: string): boolean => ["installing", "logging_in"].includes(state);
/** 已登录（或残留登录态）才谈得上登出；登出只清登录态，SDK 还留着 */
const canLogout = (state: string): boolean => sdkReady(state) || state === "error";

/** 设备验证码弹窗：码出现时强制弹出一次，关掉后卡片上仍保留同一份码 */
const deviceCodeDialogOpen = ref(false);

watch(sdkLoginDeviceCode, (code) => {
  if (code) {
    deviceCodeDialogOpen.value = true;
    return;
  }
  deviceCodeDialogOpen.value = false;
});

async function copyDeviceCode(): Promise<void> {
  const code = sdkLoginDeviceCode.value?.trim();
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    showToast(t("providerSdkDeviceCodeCopied"), "success");
  } catch {
    /* Electron 下极少失败；失败时用户仍可手动选中弹窗里的码 */
  }
}

/** 当前选中 SDK 的安装阶段：登录不进 sdkPhase，只看状态机（见 composable §安装与登录） */
const installPhase = computed(() =>
  selectedSdk.value && sdkPhase.value?.templateId === selectedSdk.value.templateId
    ? sdkPhase.value
    : null,
);

/** 状态徽标配色：可用 / 失败 / 进行中 / 其余中性，让状态不只靠文字区分 */
function statePillClass(state: string): string {
  if (sdkReady(state)) return "border-transparent bg-success-soft text-success-foreground";
  if (state === "install_failed" || state === "error")
    return "border-destructive/30 bg-danger-soft text-destructive";
  if (busyState(state)) return "border-accent/30 bg-accent/10 text-accent";
  return "border-rule bg-background text-muted-foreground";
}

/** 进行中文案：安装阶段优先用 runtime 回传的 detail，登录阶段回落到状态机标签 */
function progressLabel(sdk: AgentSdkOption): string {
  const phase = installPhase.value;
  if (phase) return phase.detail ?? t("providerSdkInstall");
  return sdkStateLabel(sdk.state);
}

/** 主钮文案跟状态机走：可用→刷模型；已装未登→登录；其余→开始接入 */
function sdkPrimaryLabel(state: string): string {
  if (sdkReady(state)) return t("providerRefreshModels");
  if (needsLogin(state)) return t("providerSdkLogin");
  return t("providerSdkStart");
}

function runSdkPrimary(sdk: AgentSdkOption): void {
  if (sdkReady(sdk.state)) {
    void refreshAgentSdkModels(sdk.templateId);
    return;
  }
  if (needsLogin(sdk.state)) {
    void loginAgentSdk(sdk.templateId);
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
 * 一个下拉分两组：API Key 接入（填密钥）/ 本地 Agent App 接入（装 SDK + 登录）。
 * 选中后下方表单整体切换，不再用顶层 tab 分开两套页面。
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

watch([modelFilter, modelProviderFilter], () => {
  modelsExpanded.value = false;
});

/** 悬停：厂商 + 接入方式 + 稳定 modelId（同名模型靠它区分） */
function modelRowTitle(model: {
  vendorLabel: string;
  optionLabel: string;
  modelId: string;
  name: string;
}): string {
  const source =
    model.optionLabel !== model.vendorLabel
      ? `${model.vendorLabel} · ${model.optionLabel}`
      : model.vendorLabel;
  return model.modelId !== model.name ? `${source} · ${model.modelId}` : source;
}
</script>

<template>
  <main class="min-h-0 min-w-0 overflow-auto bg-background">
    <div class="mx-auto w-full max-w-3xl px-4 py-4 sm:px-5 sm:py-5">
      <!-- 页头 -->
      <header class="mb-4 border-b border-rule pb-4">
        <p class="m-0 text-xs font-medium tracking-wider text-accent">{{ t("providerKicker") }}</p>
        <h1 class="mb-0 mt-2 text-lg font-semibold tracking-tight text-foreground">{{ t("providerTitle") }}</h1>
        <p class="mb-0 mt-1.5 max-w-2xl text-sm leading-snug text-muted-foreground">
          {{ t("providerLead") }}
        </p>
      </header>

      <!-- 主区：启用服务（API Key 与本地 Agent App 的模型都在这里） -->
      <article class="rounded-xl border border-rule bg-background p-3 shadow-sm sm:p-4">
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <p class="m-0 text-xs font-medium tracking-wider text-accent">{{ t("providerModelsKicker") }}</p>
            <h2 class="mb-0 mt-1 text-sm font-semibold tracking-tight text-foreground">{{ t("providerEnableServices") }}</h2>
            <p class="mb-0 mt-1 text-xs leading-snug text-muted-foreground">
              {{ t("providerEnableLead") }}
            </p>
          </div>
          <button
            v-if="canRefreshModels"
            type="button"
            :disabled="busy"
            class="min-h-8 shrink-0 rounded-lg border border-rule bg-paper px-3 text-sm font-medium text-foreground transition duration-200 hover:bg-background disabled:opacity-50"
            @click="refreshAllDiscoverableModels"
          >
            {{ t("providerRefreshModels") }}
          </button>
        </div>

        <!-- 首次拉配置用骨架，不做纯文案加载态 -->
        <div
          v-if="!loaded"
          class="mt-3 grid gap-2"
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
          <!-- 供应商下拉 + 搜索：先按已存在供应商收窄，再按关键字搜 -->
          <div
            class="mt-3 grid gap-2 sm:grid-cols-[minmax(10rem,13rem)_minmax(0,1fr)] sm:items-end"
          >
            <AppSelect
              v-model="modelProviderFilter"
              :label="t('providerFilterVendor')"
              :options="modelProviderFilterOptions"
              :disabled="busy"
            />
            <label class="grid gap-1.5 text-sm font-medium text-foreground">
              <span>{{ t("providerSearchModels") }}</span>
              <input
                v-model="modelFilter"
                type="search"
                :disabled="busy"
                :placeholder="t('providerSearchModels')"
                class="min-h-9 rounded-lg border border-rule bg-paper px-3 py-1.5 text-sm font-normal text-foreground outline-none transition duration-200 focus:border-accent focus:bg-background focus:ring-2 focus:ring-accent/15 disabled:opacity-60"
              />
            </label>
          </div>

          <!-- 手动添加：默认折叠；箭头 + 实线边框示意可展开 -->
          <details
            v-if="canAddCustomModel"
            class="group/add relative z-10 mt-3 rounded-lg border border-rule bg-paper"
          >
            <summary
              class="flex min-h-8 cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm text-muted-foreground outline-none transition duration-200 hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/15 [&::-webkit-details-marker]:hidden"
            >
              <span class="min-w-0 flex-1 text-left leading-snug">{{ t("providerAddModelToggle") }}</span>
              <ChevronDownIcon
                class="size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-open/add:rotate-180 motion-reduce:transition-none"
                aria-hidden="true"
              />
            </summary>
            <form class="border-t border-rule bg-paper-deep/40 px-3 py-3" @submit.prevent="addCustomModel">
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
                  class="min-h-8 shrink-0 rounded-lg border border-rule bg-paper px-3 text-sm font-medium text-foreground transition duration-200 hover:bg-background disabled:opacity-50"
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
              class="flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 transition duration-150 hover:bg-paper"
              :title="modelRowTitle(model)"
            >
              <ProviderLogo size="md" :vendor-id="model.vendorId" :label="model.vendorLabel" />
              <!-- 主名 + modelId：同显示名（如 Cursor 两个 Auto）靠 id 区分 -->
              <div class="min-w-0 flex-1">
                <p class="m-0 truncate text-sm font-medium text-foreground">
                  {{ model.name }}
                </p>
                <p
                  v-if="model.modelId !== model.name"
                  class="mb-0 mt-0.5 truncate font-mono text-xs text-muted-foreground"
                >
                  {{ model.modelId }}
                </p>
              </div>
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
            class="mt-2 min-h-8 w-full rounded-lg px-2 text-sm font-medium text-muted-foreground transition duration-200 hover:bg-paper hover:text-foreground"
            @click="modelsExpanded = !modelsExpanded"
          >
            {{
              modelsExpanded
                ? t("providerModelsCollapse")
                : tf("providerModelsExpand", { count: hiddenModelCount })
            }}
          </button>
          <p v-else-if="!filteredModels.length" class="mb-0 mt-4 text-sm text-muted-foreground">
            {{ connections.length ? t("providerNoMatch") : t("providerNeedConnection") }}
          </p>
        </template>

        <!-- 平台 AI 占位 -->
        <div class="mt-4 rounded-lg border border-dashed border-rule bg-paper-deep/70 p-3 text-muted-foreground">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="m-0 text-sm font-semibold text-foreground">{{ t("providerPlatformTitle") }}</p>
            <span class="rounded-md border border-rule bg-background px-2 py-0.5 text-xs font-medium">{{ t("providerPlatformSoon") }}</span>
          </div>
          <p class="mb-0 mt-1.5 text-xs leading-snug">{{ t("providerPlatformBody") }}</p>
        </div>
      </article>

      <!-- 次区：添加服务。下拉分「API Key 接入」与「本地 Agent App 接入」两组 -->
      <details
        class="mt-3 rounded-xl border border-rule bg-background shadow-sm open:shadow-sm"
        :open="providerOpen || !connections.length || sdkSelected"
        @toggle="providerOpen = ($event.target as HTMLDetailsElement).open"
      >
        <summary
          class="cursor-pointer list-none px-3 py-3 text-sm font-semibold text-foreground outline-none transition duration-200 hover:bg-paper sm:px-4 [&::-webkit-details-marker]:hidden"
        >
          <div class="flex items-center justify-between gap-2">
            <div>
              <p class="m-0 text-xs font-medium tracking-wider text-muted-foreground">{{ t("providerConnectKicker") }}</p>
              <p class="mb-0 mt-1">{{ t("providerConnect") }}</p>
            </div>
            <span class="text-xs font-normal text-muted-foreground">
              {{ connections.length ? tf("providerConnectedCount", { count: connections.length }) : t("providerConnectHint") }}
            </span>
          </div>
        </summary>

        <div class="border-t border-rule px-3 pb-3 pt-3 sm:px-4 sm:pb-4">
          <!-- 骨架：连目录都还没到，先把下拉与表单的位置占住 -->
          <div
            v-if="!loaded"
            class="grid gap-3"
            role="status"
            aria-busy="true"
            :aria-label="t('providerLoading')"
          >
            <div class="grid gap-1.5">
              <UiSkeleton rounded="md" class="h-3 w-16" />
              <UiSkeleton rounded="lg" class="h-8 w-full" />
            </div>
            <UiSkeleton rounded="lg" class="h-8 w-full" />
          </div>

          <div v-else class="grid gap-3">
            <AppSelect
              v-model="draftTemplateId"
              :label="t('providerAccessKicker')"
              :options="entryOptions"
              :disabled="busy"
              :active-hint="t('providerConfiguredActive')"
            />

            <!-- 本地 Agent App：单层扁平面（身份 → 说明 → 操作），状态与主钮已表达下一步，不再套步骤轨 -->
            <section
              v-if="sdkSelected && selectedSdk"
              class="grid gap-3 rounded-xl border border-rule bg-paper p-3.5"
            >
              <!-- 身份 + 状态同一行 -->
              <div class="flex items-start gap-2.5">
                <ProviderLogo
                  class="mt-0.5"
                  size="lg"
                  :vendor-id="selectedTemplate?.vendorId"
                  :label="selectedSdk.label"
                />
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <p class="m-0 text-sm font-semibold tracking-tight text-foreground">
                      {{ selectedSdk.label }}
                    </p>
                    <span
                      class="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium"
                      :class="statePillClass(selectedSdk.state)"
                    >
                      <span
                        v-if="busyState(selectedSdk.state)"
                        class="size-1.5 animate-breathe rounded-full bg-current motion-reduce:animate-none"
                        aria-hidden="true"
                      />
                      {{ sdkStateLabel(selectedSdk.state) }}
                    </span>
                  </div>
                  <p class="mb-0 mt-0.5 truncate text-xs text-muted-foreground">
                    {{ selectedSdk.optionLabel }}
                  </p>
                </div>
              </div>

              <!-- 说明：hint / 信任提示 / 元信息同层，信任提示不再套内框 -->
              <div class="grid gap-1.5">
                <p class="m-0 max-w-xl text-xs leading-relaxed text-muted-foreground">
                  {{ selectedSdk.hint ?? t("providerSdkLead") }}
                </p>
                <!-- SDK 信任模式：选此模板即默认放行工具，须明示风险 -->
                <p class="m-0 max-w-xl text-xs leading-relaxed text-muted-foreground" role="note">
                  {{ tf("providerSdkTrustNotice", { label: selectedSdk.label }) }}
                </p>
                <p
                  v-if="
                    (selectedSdk.accountLabel && canLogout(selectedSdk.state)) ||
                    selectedSdk.models.length ||
                    selectedSdk.installedVersion
                  "
                  class="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
                >
                  <!-- 登录账号：只显示各家给的昵称，token 从不进配置 -->
                  <span
                    v-if="selectedSdk.accountLabel && canLogout(selectedSdk.state)"
                    class="font-medium text-foreground"
                  >
                    {{ tf("providerSdkAccount", { label: selectedSdk.accountLabel }) }}
                  </span>
                  <span v-if="selectedSdk.models.length">
                    {{ tf("providerSdkModelsCount", { count: selectedSdk.models.length }) }}
                  </span>
                  <span v-if="selectedSdk.installedVersion" class="font-mono">
                    v{{ selectedSdk.installedVersion }}
                  </span>
                </p>
                <p
                  v-if="selectedSdk.lastError"
                  class="m-0 rounded-lg border border-destructive/30 bg-danger-soft px-2.5 py-1.5 text-xs text-destructive"
                >
                  {{ selectedSdk.lastError }}
                </p>
              </div>

              <!-- 进度：安装 / 登录中（含 sdkBusy 尚未 reload 成 logging_in）仍展示；验证码必须可见 -->
              <div
                v-if="installPhase || busyState(selectedSdk.state) || (!!sdkLoginDeviceCode && sdkBusy)"
                class="grid gap-2 border-t border-rule pt-3"
              >
                <div class="h-1 w-full overflow-hidden rounded-md bg-muted">
                  <div class="h-full w-1/3 animate-breathe rounded-md bg-accent motion-reduce:animate-none" />
                </div>
                <p class="m-0 text-xs text-muted-foreground" role="status" aria-live="polite">
                  {{ progressLabel(selectedSdk) }}
                </p>
                <!-- 登录轮询期才提示浏览器，安装时不显示 -->
                <p v-if="!installPhase" class="m-0 text-xs text-muted-foreground">
                  {{ t("providerSdkBrowserHint") }}
                </p>
                <!-- Codex device-auth：码来自 CLI stdout，填到网页 XXXX-XXXXX -->
                <div
                  v-if="!installPhase && sdkLoginDeviceCode"
                  class="grid gap-1 rounded-lg border border-rule bg-paper px-2.5 py-2"
                >
                  <p class="m-0 text-xs text-muted-foreground">
                    {{ t("providerSdkDeviceCodeHint") }}
                  </p>
                  <p
                    class="m-0 font-mono text-base font-semibold tracking-wider text-foreground"
                    data-testid="sdk-device-code"
                  >
                    {{ tf("providerSdkDeviceCode", { code: sdkLoginDeviceCode }) }}
                  </p>
                </div>
                <div
                  v-if="selectedSdk.state === 'logging_in' || (!installPhase && sdkBusy)"
                  class="flex flex-wrap items-center gap-1.5"
                >
                  <button
                    type="button"
                    class="min-h-8 rounded-lg border border-rule bg-background px-2.5 text-xs font-medium transition duration-200 hover:bg-paper"
                    @click="cancelAgentSdkLogin(selectedSdk.templateId)"
                  >
                    {{ t("providerSdkCancelLogin") }}
                  </button>
                </div>
              </div>

              <!-- 操作：次要靠左、主操作靠右 -->
              <div
                v-else
                class="flex flex-wrap items-center justify-between gap-2 border-t border-rule pt-3"
              >
                <div class="flex flex-wrap items-center gap-1.5">
                  <button
                    v-if="needsLogin(selectedSdk.state)"
                    type="button"
                    :disabled="busy || sdkBusy"
                    class="min-h-8 rounded-lg border border-rule bg-background px-2.5 text-xs font-medium transition duration-200 hover:bg-paper disabled:opacity-50"
                    @click="checkAgentSdkLogin(selectedSdk.templateId)"
                  >
                    {{ t("providerSdkCheck") }}
                  </button>
                  <button
                    v-if="canLogout(selectedSdk.state)"
                    type="button"
                    :disabled="busy || sdkBusy"
                    class="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-rule bg-background px-2.5 text-xs font-medium transition duration-200 hover:bg-paper disabled:opacity-50"
                    @click="logoutAgentSdk(selectedSdk.templateId)"
                  >
                    <LogOutIcon class="size-3.5" aria-hidden="true" />
                    {{ t("providerSdkLogout") }}
                  </button>
                  <button
                    v-if="selectedSdk.state !== 'not_installed'"
                    type="button"
                    :disabled="busy || sdkBusy"
                    class="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-rule bg-background px-2.5 text-xs font-medium text-destructive transition duration-200 hover:bg-danger-soft disabled:opacity-50"
                    @click="uninstallAgentSdk(selectedSdk.templateId)"
                  >
                    <Trash2Icon class="size-3.5" aria-hidden="true" />
                    {{ t("providerSdkUninstall") }}
                  </button>
                </div>
                <button
                  type="button"
                  :disabled="busy || sdkBusy"
                  class="min-h-8 shrink-0 rounded-lg bg-accent px-3 text-sm font-semibold text-white transition duration-200 hover:bg-accent-deep disabled:opacity-50"
                  @click="runSdkPrimary(selectedSdk)"
                >
                  {{ sdkPrimaryLabel(selectedSdk.state) }}
                </button>
              </div>
            </section>

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
                    class="min-h-8 shrink-0 rounded-lg border border-rule px-3 text-sm font-medium text-destructive transition duration-200 hover:bg-danger-soft disabled:opacity-50"
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
    </div>

    <!-- Codex device-auth：验证码强化弹窗（与登录卡片内联展示并存） -->
    <AppDialog
      :open="deviceCodeDialogOpen"
      :title="t('providerSdkDeviceCodeDialogTitle')"
      :description="t('providerSdkDeviceCodeDialogBody')"
      align="center"
      @update:open="deviceCodeDialogOpen = $event"
    >
      <div
        v-if="sdkLoginDeviceCode"
        class="grid justify-items-center gap-2 rounded-xl border border-rule bg-background px-4 py-5"
      >
        <p
          class="m-0 select-all font-mono text-2xl font-semibold tracking-[0.2em] text-foreground"
          data-testid="sdk-device-code-dialog"
        >
          {{ sdkLoginDeviceCode }}
        </p>
      </div>
      <template #footer>
        <button
          type="button"
          class="min-h-8 rounded-lg border border-rule bg-paper px-3 text-sm font-medium text-foreground transition duration-200 hover:bg-background focus-visible:ring-2 focus-visible:ring-accent/15 focus-visible:outline-none"
          @click="copyDeviceCode"
        >
          {{ t("providerSdkDeviceCodeCopy") }}
        </button>
        <button
          type="button"
          class="min-h-8 rounded-lg bg-accent px-3 text-sm font-semibold text-white transition duration-200 hover:bg-accent-deep focus-visible:ring-2 focus-visible:ring-accent/15 focus-visible:outline-none"
          @click="deviceCodeDialogOpen = false"
        >
          {{ t("providerSdkDeviceCodeDialogGotIt") }}
        </button>
      </template>
    </AppDialog>
  </main>
</template>

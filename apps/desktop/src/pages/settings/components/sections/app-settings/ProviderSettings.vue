<script setup lang="ts">
import { CheckIcon, ChevronDownIcon, LogOutIcon, Trash2Icon } from "@lucide/vue";
import { computed, ref, watch } from "vue";

import AppSelect from "../../../../../shared/components/AppSelect.vue";
import ProviderLogo from "../../../../../shared/components/ProviderLogo.vue";
import UiSkeleton from "../../../../../shared/components/UiSkeleton.vue";
import type { AgentSdkOption } from "../../../../../shared/model/runtime/runtime";
import { t, tf } from "../../../../../shared/model/ui/ui-locale";
import { useProviderSettings } from "../../../composables/useProviderSettings";

const MODEL_PREVIEW_COUNT = 5;

const {
  connections,
  filteredModels,
  overridden,
  busy,
  draftTemplateId,
  draftBaseUrl,
  draftApiKey,
  modelFilter,
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
  startAgentSdkInstall,
  loginAgentSdk,
  checkAgentSdkLogin,
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

/** 状态机 → 状态标签词条（见 docs/agent_cli §2.2） */
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

/** 两步接入轨的步骤态：done 打勾 / active 橙 / todo 中性 */
type SdkStepState = "done" | "active" | "todo";

/**
 * 本地 App 接入是「装 SDK → 浏览器登录」两步。
 * 用一条步骤轨把状态摊平，用户一眼知道现在该做什么，而不是读状态词猜。
 */
const sdkSteps = computed<{ key: string; labelKey: string; state: SdkStepState }[]>(() => {
  const state = selectedSdk.value?.state ?? "not_installed";
  const installing = Boolean(installPhase.value) || state === "installing";
  const installed = !["not_installed", "installing", "install_failed"].includes(state);
  return [
    {
      key: "install",
      labelKey: "providerSdkStepInstall",
      state: installing ? "active" : installed ? "done" : "todo",
    },
    {
      key: "login",
      labelKey: "providerSdkStepLogin",
      state: state === "logging_in" ? "active" : sdkReady(state) ? "done" : "todo",
    },
  ];
});

function stepDotClass(state: SdkStepState): string {
  if (state === "done") return "border-transparent bg-success-soft text-success-foreground";
  if (state === "active") return "border-accent bg-accent text-white";
  return "border-rule bg-background text-muted-foreground";
}

function stepTextClass(state: SdkStepState): string {
  return state === "active" ? "font-medium text-foreground" : "text-muted-foreground";
}

/** 进行中文案：安装阶段优先用 runtime 回传的 detail，登录阶段回落到状态机标签 */
function progressLabel(sdk: AgentSdkOption): string {
  const phase = installPhase.value;
  if (phase) return phase.detail ?? t("providerSdkInstall");
  return sdkStateLabel(sdk.state);
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

watch(modelFilter, () => {
  modelsExpanded.value = false;
});
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
          <label class="mt-3 grid gap-1.5 text-sm font-medium text-foreground">
            <span class="sr-only">{{ t("providerSearchModels") }}</span>
            <input
              v-model="modelFilter"
              type="search"
              :disabled="busy"
              :placeholder="t('providerSearchModels')"
              class="min-h-8 rounded-lg border border-rule bg-paper px-3 py-1.5 text-sm text-foreground outline-none transition duration-200 focus:border-accent focus:bg-background focus:ring-2 focus:ring-accent/15 disabled:opacity-60"
            />
          </label>

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
              :title="
                model.optionLabel !== model.vendorLabel
                  ? `${model.vendorLabel} · ${model.optionLabel}`
                  : model.vendorLabel
              "
            >
              <ProviderLogo size="md" :vendor-id="model.vendorId" :label="model.vendorLabel" />
              <p class="m-0 min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                {{ model.name }}
              </p>
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

            <!-- 本地 Agent App：装 SDK → 浏览器登录两步，没有密钥可填 -->
            <section v-if="sdkSelected && selectedSdk" class="overflow-hidden rounded-xl border border-rule bg-paper">
              <!-- 头部：身份 + 状态徽标（配色随状态，不只靠文字） -->
              <header class="flex items-start justify-between gap-3 px-3.5 py-3">
                <div class="flex min-w-0 items-start gap-2.5">
                  <ProviderLogo
                    class="mt-0.5"
                    size="lg"
                    :vendor-id="selectedTemplate?.vendorId"
                    :label="selectedSdk.label"
                  />
                  <div class="min-w-0">
                    <p class="mb-0 mt-0 text-sm font-semibold tracking-tight text-foreground">{{ selectedSdk.label }}</p>
                    <p class="mb-0 mt-0.5 truncate text-xs text-muted-foreground">{{ selectedSdk.optionLabel }}</p>
                  </div>
                </div>
                <span
                  class="inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium"
                  :class="statePillClass(selectedSdk.state)"
                >
                  <span
                    v-if="busyState(selectedSdk.state)"
                    class="size-1.5 animate-breathe rounded-full bg-current motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                  {{ sdkStateLabel(selectedSdk.state) }}
                </span>
              </header>

              <!-- 两步接入轨：当前步 accent，已完成打勾，连接线跟着进度走 -->
              <ol class="m-0 flex list-none items-center gap-2 border-t border-rule bg-paper-deep/40 px-3.5 py-2.5">
                <template v-for="(step, index) in sdkSteps" :key="step.key">
                  <li class="flex min-w-0 items-center gap-2">
                    <span
                      class="grid size-5 shrink-0 place-items-center rounded-full border text-xs leading-none"
                      :class="stepDotClass(step.state)"
                    >
                      <CheckIcon v-if="step.state === 'done'" class="size-3" aria-hidden="true" />
                      <template v-else>{{ index + 1 }}</template>
                    </span>
                    <span class="truncate text-xs" :class="stepTextClass(step.state)">
                      {{ t(step.labelKey) }}
                    </span>
                  </li>
                  <li
                    v-if="index < sdkSteps.length - 1"
                    class="h-px min-w-3 flex-1"
                    :class="step.state === 'done' ? 'bg-accent/40' : 'bg-rule'"
                    aria-hidden="true"
                  />
                </template>
              </ol>

              <!-- 说明与元信息：元信息并成一行，不再堆成段落 -->
              <div class="px-3.5 py-3">
                <p class="m-0 max-w-xl text-xs leading-relaxed text-muted-foreground">
                  {{ selectedSdk.hint ?? t("providerSdkLead") }}
                </p>
                <!-- SDK 信任模式：选此模板即默认放行工具，须明示风险（不按厂商定制 HITL） -->
                <p
                  class="mb-0 mt-2 rounded-lg border border-rule bg-background px-2.5 py-1.5 text-xs leading-relaxed text-muted-foreground"
                  role="note"
                >
                  {{ tf("providerSdkTrustNotice", { label: selectedSdk.label }) }}
                </p>
                <div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <!-- 登录账号：只显示各家给的昵称，token 从不进配置；登出后 runtime 会清掉 -->
                  <span v-if="selectedSdk.accountLabel && canLogout(selectedSdk.state)" class="font-medium">
                    {{ tf("providerSdkAccount", { label: selectedSdk.accountLabel }) }}
                  </span>
                  <span v-if="selectedSdk.models.length">
                    {{ tf("providerSdkModelsCount", { count: selectedSdk.models.length }) }}
                  </span>
                  <span v-if="selectedSdk.installedVersion" class="font-mono">v{{ selectedSdk.installedVersion }}</span>
                </div>
                <!-- 失败原因：独立告警条，不与说明混排 -->
                <p
                  v-if="selectedSdk.lastError"
                  class="mb-0 mt-2 rounded-lg border border-destructive/30 bg-danger-soft px-2.5 py-1.5 text-xs text-destructive"
                >
                  {{ selectedSdk.lastError }}
                </p>
              </div>

              <!-- 安装 / 登录中：操作区整条换成进度条 + 阶段文案 -->
              <div v-if="installPhase || busyState(selectedSdk.state)" class="border-t border-rule px-3.5 py-3">
                <div class="h-1 w-full overflow-hidden rounded-md bg-muted">
                  <div class="h-full w-1/3 animate-breathe rounded-md bg-accent motion-reduce:animate-none" />
                </div>
                <p class="m-0 mt-1.5 text-xs text-muted-foreground" role="status" aria-live="polite">
                  {{ progressLabel(selectedSdk) }}
                </p>
                <!-- 登录轮询期才提示浏览器，安装时不显示 -->
                <p v-if="!installPhase" class="mb-0 mt-0.5 text-xs text-muted-foreground">
                  {{ t("providerSdkBrowserHint") }}
                </p>
              </div>

              <!-- 操作条：次要操作靠左，主操作靠右，不再各占一行 -->
              <footer v-else class="flex flex-wrap items-center justify-between gap-2 border-t border-rule px-3.5 py-2.5">
                <div class="flex flex-wrap items-center gap-1.5">
                  <button
                    v-if="needsLogin(selectedSdk.state)"
                    type="button"
                    :disabled="busy || sdkBusy"
                    class="min-h-8 rounded-lg border border-rule bg-paper px-2.5 text-xs font-medium transition duration-200 hover:bg-background disabled:opacity-50"
                    @click="checkAgentSdkLogin(selectedSdk.templateId)"
                  >
                    {{ t("providerSdkCheck") }}
                  </button>
                  <button
                    v-if="canLogout(selectedSdk.state)"
                    type="button"
                    :disabled="busy || sdkBusy"
                    class="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-rule bg-paper px-2.5 text-xs font-medium transition duration-200 hover:bg-background disabled:opacity-50"
                    @click="logoutAgentSdk(selectedSdk.templateId)"
                  >
                    <LogOutIcon class="size-3.5" aria-hidden="true" />
                    {{ t("providerSdkLogout") }}
                  </button>
                  <button
                    v-if="selectedSdk.state !== 'not_installed'"
                    type="button"
                    :disabled="busy || sdkBusy"
                    class="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-rule px-2.5 text-xs font-medium text-destructive transition duration-200 hover:bg-danger-soft disabled:opacity-50"
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
                  @click="
                    sdkReady(selectedSdk.state)
                      ? refreshAgentSdkModels(selectedSdk.templateId)
                      : needsLogin(selectedSdk.state)
                        ? loginAgentSdk(selectedSdk.templateId)
                        : startAgentSdkInstall(selectedSdk.templateId)
                  "
                >
                  {{
                    sdkReady(selectedSdk.state)
                      ? t("providerRefreshModels")
                      : needsLogin(selectedSdk.state)
                        ? t("providerSdkLogin")
                        : t("providerSdkStart")
                  }}
                </button>
              </footer>
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
  </main>
</template>

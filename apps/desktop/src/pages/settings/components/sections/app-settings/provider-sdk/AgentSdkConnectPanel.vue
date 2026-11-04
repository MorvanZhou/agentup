<script setup lang="ts">
import { LogOutIcon, Trash2Icon } from "@lucide/vue";
import { computed, ref, watch } from "vue";

import ProviderLogo from "../../../../../../shared/components/ProviderLogo.vue";
import type {
  AgentSdkAuthEnvironment,
  AgentSdkOption,
} from "../../../../../../shared/model/runtime/runtime";
import { readUiLocale, t, tf } from "../../../../../../shared/model/ui/ui-locale";
import ApiKeyPasteBlock from "./parts/ApiKeyPasteBlock.vue";
import AuthEnvironmentPicker from "./parts/AuthEnvironmentPicker.vue";
import DeviceCodeBlock from "./parts/DeviceCodeBlock.vue";
import DeviceCodeDialog from "./parts/DeviceCodeDialog.vue";
import {
  busyState,
  canLogout,
  needsLogin,
  sdkPrimaryLabel,
  sdkReady,
  sdkStateLabel,
  showBrowserOauthHint,
  showCancelInstall,
  showDesktopMyth,
  statePillClass,
} from "./sdk-state";

const props = defineProps<{
  sdk: AgentSdkOption;
  vendorId?: string | null;
  busy: boolean;
  sdkBusy: boolean;
  /** ready 态刷模型目录中（主钮 / 进度条用） */
  modelsBusy?: boolean;
  /** 当前选中 SDK 的安装阶段；登录不进 phase，只看状态机 */
  installPhase: { templateId: string; phase: string; detail?: string } | null;
  deviceCode: string | null;
  loginNeedsApiKey: boolean;
  apiKeyDraft: string;
}>();

const emit = defineEmits<{
  primary: [environment?: AgentSdkAuthEnvironment];
  check: [];
  logout: [];
  uninstall: [];
  "submit-api-key": [];
  "cancel-login": [];
  /** 取消进行中的接入（npm 安装）或卡死的 installing */
  "cancel-install": [];
  "update:apiKeyDraft": [value: string];
}>();

/**
 * CodeBuddy 登录站点：分段选择 + 单一登录主钮。
 * 界面语言 zh 默认中国站，其它默认国际站；本机已有偏好则跟偏好。
 */
const draftAuthEnvironment = ref<AgentSdkAuthEnvironment>("external");

function defaultAuthEnvironment(): AgentSdkAuthEnvironment {
  return readUiLocale() === "zh" ? "internal" : "external";
}

watch(
  () => props.sdk,
  (sdk) => {
    if (!sdk.authEnvironments.length) return;
    draftAuthEnvironment.value =
      sdk.authEnvironment && sdk.authEnvironments.includes(sdk.authEnvironment)
        ? sdk.authEnvironment
        : defaultAuthEnvironment();
  },
  { immediate: true },
);

const showAuthEnvironmentPicker = computed(
  () =>
    Boolean(props.sdk.authEnvironments.length) &&
    (needsLogin(props.sdk.state) || sdkReady(props.sdk.state)),
);

/**
 * 粘贴框文案：按模板 apiKeyPaste 能力选整套词条（hint / 标签 / 主钮 / 取消）。
 * 与浏览器 OAuth、设备码的「取消登录」分开；禁止页壳 if (driverId)。
 */
const apiKeyCopy = computed(() => {
  if (props.sdk.apiKeyPaste === "github-pat") {
    return {
      label: t("providerSdkGithubPatLabel"),
      hint: t("providerSdkGithubPatHint"),
      placeholder: t("providerSdkGithubPatPlaceholder"),
      submitLabel: t("providerSdkGithubPatSubmit"),
      cancelLabel: t("providerSdkGithubPatCancel"),
    };
  }
  if (props.sdk.apiKeyPaste === "deepseek") {
    return {
      label: t("providerSdkDeepseekKeyLabel"),
      hint: t("providerSdkDeepseekKeyHint"),
      placeholder: t("providerSdkDeepseekKeyPlaceholder"),
      submitLabel: t("providerSdkDeepseekKeySubmit"),
      cancelLabel: t("providerSdkDeepseekKeyCancel"),
    };
  }
  // 默认 / opencode：OpenCode Zen Key 粘贴档（providerSdkApiKey* = 该档词条）
  return {
    label: t("providerSdkApiKeyLabel"),
    hint: t("providerSdkApiKeyHint"),
    placeholder: t("providerSdkApiKeyPlaceholder"),
    submitLabel: t("providerSdkApiKeySubmit"),
    cancelLabel: t("providerSdkApiKeyCancel"),
  };
});

/** 进行中文案：刷目录 / 粘贴确认中 / 安装 detail / 状态机标签 */
const progressLabel = computed(() => {
  if (props.modelsBusy) return t("providerSdkRefreshingModels");
  // 粘贴 Key 提交后 runtime 会顺手鉴权+拉模型，可能几十秒
  if (props.loginNeedsApiKey && props.sdkBusy) return t("providerSdkModelsSyncing");
  if (props.installPhase) return props.installPhase.detail ?? t("providerSdkInstall");
  return sdkStateLabel(props.sdk.state);
});

const showProgress = computed(
  () =>
    Boolean(props.installPhase) ||
    busyState(props.sdk.state) ||
    (!!props.deviceCode && props.sdkBusy) ||
    props.loginNeedsApiKey ||
    Boolean(props.modelsBusy),
);

const primaryBusy = computed(() => props.busy || props.sdkBusy || Boolean(props.modelsBusy));

const primaryLabel = computed(() => {
  if (props.modelsBusy && sdkReady(props.sdk.state)) return t("providerSdkRefreshingModels");
  return sdkPrimaryLabel(props.sdk.state);
});

const browserOauthHint = computed(() =>
  showBrowserOauthHint(props.sdk.state, {
    installPhase: Boolean(props.installPhase),
    loginNeedsApiKey: props.loginNeedsApiKey,
    modelsBusy: Boolean(props.modelsBusy),
  }),
);

const cancelInstallVisible = computed(() =>
  showCancelInstall(props.sdk.state, Boolean(props.installPhase)),
);

const cancelLoginVisible = computed(
  () =>
    !props.loginNeedsApiKey &&
    !cancelInstallVisible.value &&
    (props.sdk.state === "logging_in" ||
      (!props.installPhase && props.sdkBusy && !props.modelsBusy)),
);

function runPrimary(): void {
  // 有多站点时把当前分段值带给登录；安装 / 刷模型 / 无站点登录不带
  if (needsLogin(props.sdk.state) && props.sdk.authEnvironments.length) {
    emit("primary", draftAuthEnvironment.value);
    return;
  }
  emit("primary");
}
</script>

<template>
  <!-- 本地 Agent App：单层扁平面（身份 → 说明 → 操作），按能力插登录面板 -->
  <section class="grid gap-3 rounded-xl border border-rule bg-paper p-3.5">
    <!-- 身份：主名 + 状态；说明文案不塞进副行，避免与下方重点句重复 -->
    <div class="flex items-start gap-2.5">
      <ProviderLogo class="mt-0.5" size="lg" :vendor-id="vendorId" :label="sdk.label" />
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-2">
          <p class="m-0 text-sm font-semibold tracking-tight text-foreground">
            {{ sdk.label }}
          </p>
          <span
            class="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium"
            :class="statePillClass(sdk.state)"
          >
            <span
              v-if="busyState(sdk.state)"
              class="size-1.5 animate-breathe rounded-full bg-current motion-reduce:animate-none"
              aria-hidden="true"
            />
            {{ sdkStateLabel(sdk.state) }}
          </span>
        </div>
      </div>
    </div>

    <!-- 说明：待接入只留「排雷一句 + 短信任」；可用后短信任 + 账号元信息 -->
    <div class="grid gap-1.5">
      <p
        v-if="showDesktopMyth(sdk.state)"
        class="m-0 max-w-xl text-xs leading-relaxed text-foreground"
      >
        {{ t("providerSdkDesktopMyth") }}
      </p>
      <!-- SDK 信任模式：选此模板即默认放行工具，须明示风险 -->
      <p class="m-0 max-w-xl text-xs leading-relaxed text-muted-foreground" role="note">
        {{
          sdkReady(sdk.state) ? t("providerSdkTrustNoticeReady") : t("providerSdkTrustNotice")
        }}
      </p>
      <p
        v-if="
          (sdk.accountLabel && canLogout(sdk.state)) || sdk.models.length || sdk.installedVersion
        "
        class="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
      >
        <!-- 登录账号：只显示各家给的昵称，token 从不进配置 -->
        <span
          v-if="sdk.accountLabel && canLogout(sdk.state)"
          class="font-medium text-foreground"
        >
          {{ tf("providerSdkAccount", { label: sdk.accountLabel }) }}
        </span>
        <span v-if="sdk.models.length">
          {{ tf("providerSdkModelsCount", { count: sdk.models.length }) }}
        </span>
        <span v-if="sdk.installedVersion" class="font-mono">
          v{{ sdk.installedVersion }}
        </span>
      </p>
      <p
        v-if="sdk.lastError"
        class="m-0 rounded-lg border border-destructive/30 bg-danger-soft px-2.5 py-1.5 text-xs text-destructive"
      >
        {{ sdk.lastError }}
      </p>
    </div>

    <!-- 进度：安装 / 登录中；验证码 / Key 粘贴必须可见 -->
    <div v-if="showProgress" class="grid gap-2 border-t border-rule pt-3">
      <div
        v-if="!loginNeedsApiKey"
        class="h-1 w-full overflow-hidden rounded-md bg-muted"
      >
        <div class="h-full w-1/3 animate-breathe rounded-md bg-accent motion-reduce:animate-none" />
      </div>
      <p
        v-if="!loginNeedsApiKey"
        class="m-0 text-xs text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        {{ progressLabel }}
      </p>
      <!-- 仅浏览器 OAuth 登录中；安装中勿显示「已打开浏览器」 -->
      <p v-if="browserOauthHint" class="m-0 text-xs text-muted-foreground">
        {{ t("providerSdkBrowserHint") }}
      </p>
      <DeviceCodeBlock v-if="!installPhase && deviceCode" :code="deviceCode" />
      <ApiKeyPasteBlock
        v-if="!installPhase && loginNeedsApiKey"
        :model-value="apiKeyDraft"
        :busy="sdkBusy"
        :label="apiKeyCopy.label"
        :hint="apiKeyCopy.hint"
        :placeholder="apiKeyCopy.placeholder"
        :submit-label="apiKeyCopy.submitLabel"
        :cancel-label="apiKeyCopy.cancelLabel"
        @update:model-value="emit('update:apiKeyDraft', $event)"
        @submit="emit('submit-api-key')"
        @cancel="emit('cancel-login')"
      />
      <!-- 接入中可退出重试：杀 npm / 清卡死 installing；与取消登录分钮 -->
      <div
        v-if="cancelInstallVisible || cancelLoginVisible"
        class="flex flex-wrap items-center gap-1.5"
      >
        <button
          v-if="cancelInstallVisible"
          type="button"
          class="min-h-8 rounded-lg border border-rule bg-background px-2.5 text-xs font-medium transition duration-200 hover:bg-paper"
          @click="emit('cancel-install')"
        >
          {{ t("providerSdkCancelInstall") }}
        </button>
        <button
          v-else-if="cancelLoginVisible"
          type="button"
          class="min-h-8 rounded-lg border border-rule bg-background px-2.5 text-xs font-medium transition duration-200 hover:bg-paper"
          @click="emit('cancel-login')"
        >
          {{ t("providerSdkCancelLogin") }}
        </button>
      </div>
    </div>

    <!-- 操作：登录主区块单列叠放；次要动作沉底安静一排 -->
    <div v-else class="grid gap-2.5 border-t border-rule pt-3">
      <div class="grid gap-1.5">
        <AuthEnvironmentPicker
          v-if="showAuthEnvironmentPicker"
          v-model="draftAuthEnvironment"
          :environments="sdk.authEnvironments"
          :locked="sdkReady(sdk.state)"
          :disabled="primaryBusy"
        />
        <button
          type="button"
          :disabled="primaryBusy"
          class="min-h-8 w-full rounded-lg bg-accent px-3 text-sm font-semibold text-white transition duration-200 hover:bg-accent-deep disabled:opacity-50"
          @click="runPrimary"
        >
          {{ primaryLabel }}
        </button>
      </div>
      <!-- 次要：检查 / 登出 / 移除接入 — 弱视觉底栏 -->
      <div
        v-if="needsLogin(sdk.state) || canLogout(sdk.state) || sdk.state !== 'not_installed'"
        class="flex flex-wrap items-center gap-x-1 gap-y-1 border-t border-rule/70 pt-2"
      >
        <button
          v-if="needsLogin(sdk.state)"
          type="button"
          :disabled="primaryBusy"
          class="min-h-7 rounded-md px-2 text-xs font-medium text-muted-foreground transition duration-150 hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
          @click="emit('check')"
        >
          {{ t("providerSdkCheck") }}
        </button>
        <button
          v-if="canLogout(sdk.state)"
          type="button"
          :disabled="primaryBusy"
          class="inline-flex min-h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground transition duration-150 hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
          @click="emit('logout')"
        >
          <LogOutIcon class="size-3.5" aria-hidden="true" />
          {{ t("providerSdkLogout") }}
        </button>
        <button
          v-if="sdk.state !== 'not_installed'"
          type="button"
          :disabled="primaryBusy"
          class="inline-flex min-h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-destructive/90 transition duration-150 hover:bg-danger-soft disabled:opacity-50"
          @click="emit('uninstall')"
        >
          <Trash2Icon class="size-3.5" aria-hidden="true" />
          {{ t("providerSdkUninstall") }}
        </button>
      </div>
    </div>

    <DeviceCodeDialog :code="deviceCode" />
  </section>
</template>

import { computed, onMounted, ref, watch } from "vue";

import { useDesktop } from "../../../app/desktop";
import { DesktopApi, DesktopApiError } from "../../../shared/api/runtime";
import type {
  AvailableProviderModel,
  ProviderConnection,
  ProviderSettings,
  ProviderTemplate,
  ProviderVendorGroup,
} from "../../../shared/model/runtime/runtime";
import { decryptSecret, encryptSecret, secretEncryptionReady } from "../../../shared/secrets";
import { bumpProviderConfig, providerConfigEpoch } from "../../../shared/model/runtime/provider-config";
import { showToast } from "../../../shared/model/ui/toast";
import { readUiLocale, t, tf, uiLocale } from "../../../shared/model/ui/ui-locale";

export function useProviderSettings(api = new DesktopApi()) {
  const { session } = useDesktop();
  const locale = () => readUiLocale();
  const settings = ref<ProviderSettings | null>(null);
  const busy = ref(false);
  const loaded = ref(false);
  /** 本实例刚 bump 时跳过一次 epoch 监听，避免重复 load。 */
  let ignoreNextEpoch = false;

  const draftTemplateId = ref("");
  const draftBaseUrl = ref("");
  const draftApiKey = ref("");
  const modelFilter = ref("");
  /** 手动追加模型 ID（仅 Ollama / 自定义 OpenAI 兼容可在运行时注册）。 */
  const draftCustomModelId = ref("");
  const draftAddTemplateId = ref("");

  const vendors = computed(() => settings.value?.vendors ?? []);
  const connections = computed(() => settings.value?.connections ?? []);
  const availableModels = computed(() => settings.value?.availableModels ?? []);
  const configured = computed(() => Boolean(settings.value?.configured));
  const overridden = computed(() => Boolean(settings.value?.overriddenByEnvironment));
  /** 本地 Agent App 接入候选：安装 + 登录后才会出现在「启用服务」里 */
  const agentSdks = computed(() => settings.value?.agentSdks ?? []);
  /** 全部接入方式（含 API 与本地 App），下拉按 access 分两组 */
  const templates = computed(() => settings.value?.templates ?? []);
  const apiTemplates = computed(() => templates.value.filter((item) => item.access === "api"));

  const selectedTemplate = computed(
    () => templates.value.find((item) => item.id === draftTemplateId.value) ?? null,
  );
  /** 选中的是本地 Agent App 时，表单换成安装 / 登录卡片 */
  const selectedSdk = computed(
    () => agentSdks.value.find((item) => item.templateId === draftTemplateId.value) ?? null,
  );
  const sdkSelected = computed(() => selectedTemplate.value?.access === "agent-sdk");
  const existingConnection = computed(
    () => connections.value.find((item) => item.templateId === draftTemplateId.value) ?? null,
  );
  const needsBaseUrl = computed(() => {
    const kind = selectedTemplate.value?.kind;
    return kind === "ollama" || kind === "custom-openai";
  });
  const needsApiKey = computed(() => Boolean(selectedTemplate.value?.requiresApiKey));
  /** 可刷新的来源：能拉 List Models 的服务商 + 已登录的本地接入（后者问本地 SDK） */
  const sdkRefreshTargets = computed(() =>
    agentSdks.value.filter((sdk) => sdk.state === "ready").map((sdk) => sdk.templateId),
  );
  const canRefreshModels = computed(() =>
    connections.value.some((connection) => {
      const template = settings.value?.templates.find((item) => item.id === connection.templateId);
      return Boolean(template?.supportsModelDiscovery);
    }) || sdkRefreshTargets.value.length > 0,
  );
  /** 任意已连接服务商均可手动追加模型 ID（runtime 会对内置目录外的 id 按同端点动态注册）。 */
  const customModelTargets = computed(() => connections.value);
  const canAddCustomModel = computed(() => customModelTargets.value.length > 0);
  const filteredModels = computed(() => {
    const q = modelFilter.value.trim().toLowerCase();
    if (!q) return availableModels.value;
    return availableModels.value.filter(
      (model) =>
        model.name.toLowerCase().includes(q) ||
        model.modelId.toLowerCase().includes(q) ||
        model.vendorLabel.toLowerCase().includes(q) ||
        model.optionLabel.toLowerCase().includes(q),
    );
  });

  onMounted(() => void load());

  watch(uiLocale, () => {
    if (loaded.value) void load();
  });

  watch(providerConfigEpoch, () => {
    if (ignoreNextEpoch) {
      ignoreNextEpoch = false;
      return;
    }
    if (loaded.value) void load();
  });

  /** 目录到位后默认选中第一项；用户已选过就不抢他的选择 */
  watch(templates, (list) => {
    if (!list.length) return;
    if (!list.some((item) => item.id === draftTemplateId.value)) {
      const first = list.find((item) => item.access === "api") ?? list[0]!;
      draftTemplateId.value = first.id;
      applyTemplateDefaults(first);
    }
  });

  watch(draftTemplateId, (templateId) => {
    const template = templates.value.find((item) => item.id === templateId);
    if (template) applyTemplateDefaults(template);
  });

  watch(
    customModelTargets,
    (targets) => {
      if (!targets.length) {
        draftAddTemplateId.value = "";
        return;
      }
      if (!targets.some((item) => item.templateId === draftAddTemplateId.value)) {
        draftAddTemplateId.value = targets[0]!.templateId;
      }
    },
    { immediate: true },
  );

  async function load(): Promise<void> {
    if (!session.value) return;
    busy.value = true;
    try {
      const next = await api.providerSettings(session.value.token, locale());
      settings.value = next;
      await hydrateSecrets(next);
    } catch (caught) {
      showToast(messageOf(caught), "error");
    } finally {
      busy.value = false;
      loaded.value = true;
    }
  }

  async function hydrateSecrets(next: ProviderSettings): Promise<void> {
    if (!session.value) return;
    const secrets: Record<string, string> = {};
    for (const connection of next.connections) {
      if (!connection.apiKeyCipher) continue;
      try {
        secrets[connection.templateId] = await decryptSecret(connection.apiKeyCipher);
      } catch {
        /* 密文损坏时跳过 */
      }
    }
    if (Object.keys(secrets).length > 0) {
      await api.hydrateProviderRuntimeSecrets(session.value.token, secrets);
    }
  }

  function applyTemplateDefaults(template: ProviderTemplate): void {
    const existing = connections.value.find((item) => item.templateId === template.id);
    draftBaseUrl.value = existing?.baseUrl ?? template.defaultBaseUrl ?? "";
    draftApiKey.value = "";
  }

  async function saveConnection(): Promise<void> {
    if (!session.value || busy.value) return;
    const template = selectedTemplate.value;
    if (!template) {
      showToast("请选择服务商", "error");
      return;
    }
    if (needsBaseUrl.value && !draftBaseUrl.value.trim()) {
      showToast("请填写服务地址", "error");
      return;
    }
    const isNew = !existingConnection.value;
    if (needsApiKey.value && isNew && !draftApiKey.value.trim()) {
      showToast("请填写 API Key", "error");
      return;
    }
    if (needsApiKey.value && draftApiKey.value.trim()) {
      const ready = await secretEncryptionReady();
      if (!ready && !import.meta.env.DEV) {
        showToast("本机无法安全保存密钥", "error");
        return;
      }
    }

    busy.value = true;
    try {
      let apiKeyCipher: string | undefined;
      let plaintext: string | undefined;
      if (draftApiKey.value.trim()) {
        plaintext = draftApiKey.value.trim();
        apiKeyCipher = await encryptSecret(plaintext);
      }
      const next = await api.upsertProviderConnection(
        session.value.token,
        {
          templateId: template.id,
          baseUrl: needsBaseUrl.value ? draftBaseUrl.value.trim() : undefined,
          apiKeyCipher,
        },
        locale(),
      );
      settings.value = next;
      if (plaintext !== undefined) {
        await api.hydrateProviderRuntimeSecrets(session.value.token, {
          [template.id]: plaintext,
        });
      } else {
        await hydrateSecrets(next);
      }
      draftApiKey.value = "";
      showToast("服务商已保存", "success");
      if (template.supportsModelDiscovery) {
        await refreshModelsFor(template.id, { quiet: true });
      }
      notifyProviderConfigChanged();
    } catch (caught) {
      showToast(messageOf(caught), "error");
    } finally {
      busy.value = false;
    }
  }

  async function refreshModelsFor(
    templateId: string,
    options?: { quiet?: boolean },
  ): Promise<boolean> {
    if (!session.value) return false;
    try {
      settings.value = await api.refreshProviderModels(session.value.token, templateId, locale());
      if (!options?.quiet) showToast("模型列表已更新", "success");
      return true;
    } catch (caught) {
      showToast(messageOf(caught), "error");
      return false;
    }
  }

  async function refreshAllDiscoverableModels(): Promise<void> {
    if (!session.value || busy.value) return;
    const targets = connections.value.filter((connection) => {
      const template = settings.value?.templates.find((item) => item.id === connection.templateId);
      return Boolean(template?.supportsModelDiscovery);
    });
    const sdkTargets = sdkRefreshTargets.value;
    if (!targets.length && !sdkTargets.length) {
      showToast("当前没有可自动拉取模型的服务商", "error");
      return;
    }
    busy.value = true;
    try {
      await hydrateSecrets(settings.value!);
      let ok = 0;
      for (const connection of targets) {
        if (await refreshModelsFor(connection.templateId, { quiet: true })) ok += 1;
      }
      // 本地接入的目录不在服务端，走 runtime 代问本地 SDK
      for (const templateId of sdkTargets) {
        if (await refreshAgentSdkModels(templateId)) ok += 1;
      }
      const total = targets.length + sdkTargets.length;
      if (ok > 0) {
        notifyProviderConfigChanged();
        showToast(ok === total ? "模型列表已更新" : `已更新 ${ok}/${total} 个服务商`, "success");
      }
    } finally {
      busy.value = false;
    }
  }

  /** 向本地 SDK 重新问一次模型目录；失败只提示，不清掉已有目录。 */
  async function refreshAgentSdkModels(templateId: string): Promise<boolean> {
    if (!session.value) return false;
    try {
      settings.value = await api.refreshAgentSdkModels(session.value.token, templateId, locale());
      // 换账号后目录会变，会话侧的模型列表也得跟着换（别的改动都 bump，这里以前漏了）
      notifyProviderConfigChanged();
      return true;
    } catch (caught) {
      showToast(messageOf(caught), "error");
      return false;
    }
  }

  async function addCustomModel(): Promise<void> {
    if (!session.value || busy.value) return;
    const modelId = draftCustomModelId.value.trim();
    if (!modelId) {
      showToast(t("providerAddModelEmpty"), "error");
      return;
    }
    if (modelId.length > 200) {
      showToast(t("providerAddModelEmpty"), "error");
      return;
    }
    const templateId = draftAddTemplateId.value.trim();
    const target = customModelTargets.value.find((item) => item.templateId === templateId);
    if (!target) {
      showToast(t("providerNeedConnection"), "error");
      return;
    }
    const already = availableModels.value.some(
      (model) => model.templateId === templateId && model.modelId === modelId,
    );
    if (already) {
      showToast(t("providerAddModelExists"), "error");
      return;
    }

    busy.value = true;
    try {
      settings.value = await api.upsertProviderConnection(
        session.value.token,
        { templateId, customModelId: modelId },
        locale(),
      );
      draftCustomModelId.value = "";
      notifyProviderConfigChanged();
      showToast(tf("providerAddModelDone", { id: modelId }), "success");
    } catch (caught) {
      showToast(messageOf(caught), "error");
    } finally {
      busy.value = false;
    }
  }

  async function removeConnection(templateId: string): Promise<void> {
    if (!session.value || busy.value) return;
    busy.value = true;
    try {
      settings.value = await api.deleteProviderConnection(session.value.token, templateId, locale());
      if (draftTemplateId.value === templateId) {
        const template = selectedTemplate.value;
        if (template) applyTemplateDefaults(template);
      }
      notifyProviderConfigChanged();
      showToast("已移除服务商配置", "success");
    } catch (caught) {
      showToast(messageOf(caught), "error");
    } finally {
      busy.value = false;
    }
  }

  async function toggleModel(model: AvailableProviderModel, enabled: boolean): Promise<void> {
    if (!session.value || busy.value) return;
    busy.value = true;
    try {
      settings.value = await api.setProviderModelEnabled(
        session.value.token,
        { templateId: model.templateId, modelId: model.modelId },
        enabled,
        locale(),
      );
      notifyProviderConfigChanged();
    } catch (caught) {
      showToast(messageOf(caught), "error");
    } finally {
      busy.value = false;
    }
  }

  async function removeCustomModel(model: AvailableProviderModel): Promise<void> {
    if (!session.value || busy.value) return;
    if (!model.custom) {
      showToast(t("providerRemoveModelBuiltin"), "error");
      return;
    }
    busy.value = true;
    try {
      settings.value = await api.removeCustomProviderModel(
        session.value.token,
        { templateId: model.templateId, modelId: model.modelId },
        locale(),
      );
      notifyProviderConfigChanged();
      showToast(tf("providerRemoveModelDone", { id: model.modelId }), "success");
    } catch (caught) {
      showToast(messageOf(caught), "error");
    } finally {
      busy.value = false;
    }
  }

  async function activateModel(model: AvailableProviderModel): Promise<void> {
    if (!session.value || busy.value) return;
    busy.value = true;
    try {
      settings.value = await api.setProviderActiveModel(
        session.value.token,
        {
          templateId: model.templateId,
          modelId: model.modelId,
        },
        locale(),
      );
      notifyProviderConfigChanged();
      showToast(`已切换到 ${model.name}`, "success");
    } catch (caught) {
      showToast(messageOf(caught), "error");
    } finally {
      busy.value = false;
    }
  }

  /** CLI / SDK 接入：安装与登录（阶段 1） */
  const sdkBusy = ref(false);
  const sdkPhase = ref<{ templateId: string; phase: string; detail?: string } | null>(null);

  async function reload(): Promise<void> {
    if (!session.value) return;
    settings.value = await api.providerSettings(session.value.token, locale());
  }

  /** 点「开始接入」：runtime 代跑 npm 安装，这里只轮询进度。 */
  async function startAgentSdkInstall(templateId: string): Promise<void> {
    if (!session.value || sdkBusy.value) return;
    sdkBusy.value = true;
    sdkPhase.value = { templateId, phase: "resolving" };
    try {
      const jobId = await api.installAgentSdk(session.value.token, templateId);
      const deadline = Date.now() + 10 * 60 * 1000;
      while (Date.now() < deadline) {
        const job = await api.agentSdkInstallJob(session.value.token, templateId, jobId);
        sdkPhase.value = { templateId, phase: job.phase, ...(job.detail ? { detail: job.detail } : {}) };
        if (["done", "failed", "cancelled"].includes(job.phase)) {
          await reload();
          showToast(job.phase === "done" ? t("providerSdkInstallDone") : (job.error ?? t("providerSdkInstallFailed")), job.phase === "done" ? "success" : "error");
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 700));
      }
    } catch (caught) {
      showToast(messageOf(caught), "error");
    } finally {
      sdkBusy.value = false;
      sdkPhase.value = null;
    }
  }

  async function cancelAgentSdkInstall(templateId: string, jobId: string): Promise<void> {
    if (!session.value) return;
    try {
      settings.value = await api.cancelAgentSdkInstall(session.value.token, templateId, jobId);
    } catch (caught) {
      showToast(messageOf(caught), "error");
    }
  }

  /** 登录：拿到 authUrl 就交系统浏览器，之后轮询登录态直到 ready。 */
  async function loginAgentSdk(templateId: string): Promise<void> {
    if (!session.value || sdkBusy.value) return;
    sdkBusy.value = true;
    try {
      const started = await api.loginAgentSdk(session.value.token, templateId);
      if (started.authUrl) {
        const open = window.agentUp?.openExternal;
        if (!open) {
          showToast(t("providerSdkOpenFailed"), "error");
          return;
        }
        await open(started.authUrl);
      }
      if (started.state === "ready") {
        await reload();
        showToast(t("providerSdkLoginDone"), "success");
        return;
      }
      // 用户在浏览器里完成登录后，回来轮询直到状态落定
      const deadline = Date.now() + 3 * 60 * 1000;
      while (Date.now() < deadline) {
        const result = await api.checkAgentSdkLogin(session.value.token, templateId);
        if (result.state === "ready") {
          await reload();
          showToast(t("providerSdkLoginDone"), "success");
          return;
        }
        if (result.state === "not_logged_in" && !started.authUrl) break;
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      await reload();
    } catch (caught) {
      showToast(messageOf(caught), "error");
    } finally {
      sdkBusy.value = false;
    }
  }

  async function checkAgentSdkLogin(templateId: string): Promise<void> {
    if (!session.value || sdkBusy.value) return;
    sdkBusy.value = true;
    try {
      const result = await api.checkAgentSdkLogin(session.value.token, templateId);
      await reload();
      showToast(result.state === "ready" ? t("providerSdkLoginDone") : t("providerSdkLoginPending"), result.state === "ready" ? "success" : "error");
    } catch (caught) {
      showToast(messageOf(caught), "error");
    } finally {
      sdkBusy.value = false;
    }
  }

  /**
   * 登出本地 App：只把登录态打回未登录，SDK 还留着（卸载才会删目录）。
   * 换账号 / 订阅过期都走这里；模型目录由 runtime 一并清空，这里只负责刷新。
   */
  async function logoutAgentSdk(templateId: string): Promise<void> {
    if (!session.value || sdkBusy.value) return;
    sdkBusy.value = true;
    try {
      settings.value = await api.logoutAgentSdk(session.value.token, templateId, locale());
      notifyProviderConfigChanged();
      showToast(t("providerSdkLogoutDone"), "success");
    } catch (caught) {
      showToast(messageOf(caught), "error");
    } finally {
      sdkBusy.value = false;
    }
  }

  async function uninstallAgentSdk(templateId: string): Promise<void> {
    if (!session.value || sdkBusy.value) return;
    sdkBusy.value = true;
    try {
      settings.value = await api.uninstallAgentSdk(session.value.token, templateId, locale());
      notifyProviderConfigChanged();
    } catch (caught) {
      showToast(messageOf(caught), "error");
    } finally {
      sdkBusy.value = false;
    }
  }

  function notifyProviderConfigChanged(): void {
    ignoreNextEpoch = true;
    bumpProviderConfig();
  }

  return {
    settings,
    vendors,
    templates,
    apiTemplates,
    connections,
    availableModels,
    filteredModels,
    configured,
    overridden,
    agentSdks,
    busy,
    loaded,
    draftTemplateId,
    draftBaseUrl,
    draftApiKey,
    modelFilter,
    draftCustomModelId,
    draftAddTemplateId,
    customModelTargets,
    canAddCustomModel,
    selectedTemplate,
    selectedSdk,
    sdkSelected,
    existingConnection,
    needsBaseUrl,
    needsApiKey,
    canRefreshModels,
    sdkBusy,
    sdkPhase,
    load,
    startAgentSdkInstall,
    cancelAgentSdkInstall,
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
    activateModel,
  };
}

export type { ProviderTemplate, ProviderVendorGroup, ProviderConnection, AvailableProviderModel };

function messageOf(caught: unknown): string {
  return caught instanceof DesktopApiError ? caught.message : "AI 服务配置失败";
}

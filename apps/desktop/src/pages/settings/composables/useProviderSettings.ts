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
  /** 启用服务列表按供应商收窄；空串 = 已存在的全部供应商。 */
  const modelProviderFilter = ref("");
  /** 只看已打开开关的模型；默认关，避免首次发现时误以为没模型。 */
  const modelEnabledOnly = ref(false);
  /** 手动追加模型 ID（仅 Ollama / 自定义 OpenAI 兼容可在运行时注册）。 */
  const draftCustomModelId = ref("");
  const draftAddTemplateId = ref("");

  const vendors = computed(() => settings.value?.vendors ?? []);
  const connections = computed(() => settings.value?.connections ?? []);
  const availableModels = computed(() => settings.value?.availableModels ?? []);
  const configured = computed(() => Boolean(settings.value?.configured));
  const overridden = computed(() => Boolean(settings.value?.overriddenByEnvironment));
  /** 本地 Agent App 接入候选：接入 + 登录后才会出现在「启用服务」里 */
  const agentSdks = computed(() => settings.value?.agentSdks ?? []);
  /** 全部接入方式（含 API 与本地 App），下拉按 access 分两组 */
  const templates = computed(() => settings.value?.templates ?? []);
  const apiTemplates = computed(() => templates.value.filter((item) => item.access === "api"));

  const selectedTemplate = computed(
    () => templates.value.find((item) => item.id === draftTemplateId.value) ?? null,
  );
  /** 选中的是本地 Agent App 时，表单换成接入 / 登录卡片 */
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
  /**
   * 搜索框前的供应商下拉：从当前可用模型里去重 templateId。
   * 含 API 连接与已登录本地 App；默认项「全部」value 为空串。
   */
  const modelProviderFilterOptions = computed(() => {
    const seen = new Map<string, { value: string; label: string; icon?: string }>();
    for (const model of availableModels.value) {
      if (seen.has(model.templateId)) continue;
      // 与模型行接入标签同一套：模板 label（DeepSeek Harness）优先
      const connection = connections.value.find((item) => item.templateId === model.templateId);
      const sdk = agentSdks.value.find((item) => item.templateId === model.templateId);
      const label =
        model.label ||
        connection?.label ||
        sdk?.label ||
        (model.optionLabel !== model.vendorLabel
          ? `${model.vendorLabel} · ${model.optionLabel}`
          : model.vendorLabel);
      seen.set(model.templateId, {
        value: model.templateId,
        label,
        icon: model.vendorId,
      });
    }
    return [{ value: "", label: t("providerFilterAll") }, ...seen.values()];
  });
  const filteredModels = computed(() => {
    const providerId = modelProviderFilter.value;
    let scoped = providerId
      ? availableModels.value.filter((model) => model.templateId === providerId)
      : availableModels.value;
    const q = modelFilter.value.trim().toLowerCase();
    if (q) {
      scoped = scoped.filter(
        (model) =>
          model.name.toLowerCase().includes(q) ||
          model.modelId.toLowerCase().includes(q) ||
          model.vendorLabel.toLowerCase().includes(q) ||
          model.optionLabel.toLowerCase().includes(q),
      );
    }
    // 叠在供应商 / 关键字之上；关开关后该行会立刻从「仅已启用」视图消失
    if (modelEnabledOnly.value) {
      scoped = scoped.filter((model) => model.enabled);
    }
    return scoped;
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

  /** 目录到位后默认选中本地 Agent App；没有再回落到 API / 第一项 */
  watch(templates, (list) => {
    if (!list.length) return;
    if (!list.some((item) => item.id === draftTemplateId.value)) {
      const first =
        list.find((item) => item.access === "agent-sdk") ??
        list.find((item) => item.access === "api") ??
        list[0]!;
      draftTemplateId.value = first.id;
      applyTemplateDefaults(first);
    }
  });

  watch(draftTemplateId, (templateId) => {
    const template = templates.value.find((item) => item.id === templateId);
    if (template) applyTemplateDefaults(template);
  });

  /** 供应商从列表消失（卸掉 / 登出）时，下拉回落到「全部」 */
  watch(modelProviderFilterOptions, (options) => {
    if (!options.some((item) => item.value === modelProviderFilter.value)) {
      modelProviderFilter.value = "";
    }
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
        if (await refreshAgentSdkModels(templateId, { quiet: true })) ok += 1;
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

  /**
   * 向本地 SDK 重新问一次模型目录；失败只提示，不清掉已有目录。
   * Copilot 等冷启 CLI 可能要几十秒——sdkModelsBusy 驱动按钮 / 进度条，勿静默等待。
   */
  async function refreshAgentSdkModels(
    templateId: string,
    options: { quiet?: boolean } = {},
  ): Promise<boolean> {
    if (!session.value) return false;
    if (sdkModelsBusy.value) return false;
    sdkModelsBusy.value = true;
    try {
      settings.value = await api.refreshAgentSdkModels(session.value.token, templateId, locale());
      // 换账号后目录会变，会话侧的模型列表也得跟着换（别的改动都 bump，这里以前漏了）
      notifyProviderConfigChanged();
      if (!options.quiet) showToast(t("providerSdkModelsSynced"), "success");
      return true;
    } catch (caught) {
      showToast(messageOf(caught), "error");
      return false;
    } finally {
      sdkModelsBusy.value = false;
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
  /** ready 态刷模型目录中（与登录/安装的 sdkBusy 分开，避免互锁） */
  const sdkModelsBusy = ref(false);
  const sdkPhase = ref<{ templateId: string; phase: string; detail?: string } | null>(null);
  /** Codex device-auth 等：登录中展示的一次性验证码 */
  const sdkLoginDeviceCode = ref<string | null>(null);
  /** OpenCode Zen Key 回落：登录中展示粘贴框 */
  const sdkLoginNeedsApiKey = ref(false);
  const sdkLoginApiKeyDraft = ref("");
  /** 取消进行中的登录轮询（含卡在 logging_in） */
  let sdkLoginAbort: AbortController | null = null;
  /** 取消进行中的安装轮询；与登录 Abort 分开，避免互相误杀 */
  let sdkInstallAbort: AbortController | null = null;
  /** 当前安装 job；取消按钮不依赖 UI 记住 jobId */
  let sdkInstallJobId: string | null = null;
  let sdkInstallTemplateId: string | null = null;

  async function reload(): Promise<void> {
    if (!session.value) return;
    settings.value = await api.providerSettings(session.value.token, locale());
  }

  /** 点「开始接入」：runtime 代跑下载接入组件，这里只轮询进度。 */
  async function startAgentSdkInstall(templateId: string): Promise<void> {
    if (!session.value || sdkBusy.value) return;
    sdkBusy.value = true;
    sdkInstallAbort = new AbortController();
    const signal = sdkInstallAbort.signal;
    sdkPhase.value = { templateId, phase: "resolving" };
    sdkInstallTemplateId = templateId;
    sdkInstallJobId = null;
    try {
      const jobId = await api.installAgentSdk(session.value.token, templateId);
      if (signal.aborted) return;
      sdkInstallJobId = jobId;
      // DeepSeek Harness 等依赖树大，给足时间；仍须可取消，勿无限挂死
      const deadline = Date.now() + 30 * 60 * 1000;
      while (!signal.aborted && Date.now() < deadline) {
        const job = await api.agentSdkInstallJob(session.value.token, templateId, jobId);
        if (signal.aborted) return;
        sdkPhase.value = {
          templateId,
          phase: job.phase,
          ...(job.detail ? { detail: job.detail } : {}),
        };
        if (["done", "failed", "cancelled"].includes(job.phase)) {
          await reload();
          if (job.phase === "cancelled") {
            showToast(t("providerSdkInstallCancelled"), "success");
          } else {
            showToast(
              job.phase === "done"
                ? t("providerSdkInstallDone")
                : (job.error ?? t("providerSdkInstallFailed")),
              job.phase === "done" ? "success" : "error",
            );
          }
          return;
        }
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 700);
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
        });
      }
      if (signal.aborted) return;
      // 超时：主动取消远端 job，避免状态卡在 installing、进度区却已空
      try {
        settings.value = await api.cancelAgentSdkInstall(
          session.value.token,
          templateId,
          jobId,
        );
      } catch {
        await reload().catch(() => undefined);
      }
      showToast(t("providerSdkInstallTimedOut"), "error");
    } catch (caught) {
      if (!signal.aborted) showToast(messageOf(caught), "error");
      await reload().catch(() => undefined);
    } finally {
      if (sdkInstallAbort?.signal === signal) {
        sdkInstallAbort = null;
        sdkInstallJobId = null;
        sdkInstallTemplateId = null;
        sdkBusy.value = false;
        sdkPhase.value = null;
      }
    }
  }

  /**
   * 取消接入：杀 npm 子进程 + 状态打回 not_installed。
   * 无进行中 job 时（超时清 phase / 丢 job）走卸载，保证能退出「接入中」。
   */
  async function cancelAgentSdkInstall(templateId: string): Promise<void> {
    if (!session.value) return;
    const jobId =
      sdkInstallTemplateId === templateId && sdkInstallJobId ? sdkInstallJobId : null;
    sdkInstallAbort?.abort();
    try {
      if (jobId) {
        settings.value = await api.cancelAgentSdkInstall(
          session.value.token,
          templateId,
          jobId,
        );
      } else {
        // 卡死态：没有可取消的 job，用卸载清目录与 installing
        settings.value = await api.uninstallAgentSdk(
          session.value.token,
          templateId,
          locale(),
        );
      }
      notifyProviderConfigChanged();
      showToast(t("providerSdkInstallCancelled"), "success");
    } catch (caught) {
      showToast(messageOf(caught), "error");
      await reload().catch(() => undefined);
    } finally {
      sdkInstallJobId = null;
      sdkInstallTemplateId = null;
      sdkInstallAbort = null;
      sdkBusy.value = false;
      sdkPhase.value = null;
    }
  }

  /** 登录：拿到 authUrl 就交系统浏览器，之后轮询登录态直到 ready。 */
  async function loginAgentSdk(
    templateId: string,
    options: { environment?: "internal" | "external" } = {},
  ): Promise<void> {
    if (!session.value || sdkBusy.value) return;
    sdkBusy.value = true;
    sdkLoginAbort = new AbortController();
    const signal = sdkLoginAbort.signal;
    const loginOpts = options.environment ? { environment: options.environment } : {};
    try {
      sdkLoginNeedsApiKey.value = false;
      sdkLoginApiKeyDraft.value = "";
      const started = await api.loginAgentSdk(session.value.token, templateId, loginOpts);
      // 先展示验证码再开浏览器，避免用户盯着网页却不知道码在哪
      if (started.deviceCode) sdkLoginDeviceCode.value = started.deviceCode;
      if (started.needsApiKey) sdkLoginNeedsApiKey.value = true;
      await reload().catch(() => undefined);
      if (started.authUrl) {
        const open = window.agentUp?.openExternal;
        if (!open) {
          showToast(t("providerSdkOpenFailed"), "error");
          return;
        }
        await open(started.authUrl);
      }
      if (started.state === "ready") {
        sdkLoginDeviceCode.value = null;
        sdkLoginNeedsApiKey.value = false;
        await reload();
        showToast(t("providerSdkLoginDone"), "success");
        return;
      }
      // Key 回落：停轮询，等用户粘贴后 submitAgentSdkApiKey
      if (started.needsApiKey) {
        return;
      }
      // 用户在浏览器里完成登录（含填 device code）后，回来轮询直到状态落定
      const deadline = Date.now() + 15 * 60 * 1000;
      while (Date.now() < deadline) {
        if (signal.aborted) break;
        const result = await api.checkAgentSdkLogin(session.value.token, templateId, loginOpts);
        if (result.deviceCode) sdkLoginDeviceCode.value = result.deviceCode;
        if (result.needsApiKey) {
          sdkLoginNeedsApiKey.value = true;
          return;
        }
        if (result.state === "ready") {
          sdkLoginDeviceCode.value = null;
          sdkLoginNeedsApiKey.value = false;
          await reload();
          showToast(t("providerSdkLoginDone"), "success");
          return;
        }
        if (result.state === "not_logged_in") break;
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      if (signal.aborted) {
        // cancelAgentSdkLogin 已调过 logout
        await reload();
        return;
      }
      // 超时：清掉 logging_in，避免操作区被永久藏起
      try {
        settings.value = await api.logoutAgentSdk(session.value.token, templateId, locale());
        notifyProviderConfigChanged();
      } catch {
        await reload();
      }
      showToast(t("providerSdkLoginTimedOut"), "error");
    } catch (caught) {
      showToast(messageOf(caught), "error");
      await reload().catch(() => undefined);
    } finally {
      // 等粘贴 Key：必须清掉 sdkBusy，否则粘贴框「提交」钮被 :disabled="busy" 锁死
      // 操作区不会闪回「登录」——loginNeedsApiKey 已撑住 showProgress
      if (sdkLoginNeedsApiKey.value && !signal.aborted) {
        sdkBusy.value = false;
        sdkLoginAbort = null;
        return;
      }
      sdkBusy.value = false;
      sdkLoginAbort = null;
      // 轮询结束（成功 / 取消 / 超时）都清掉验证码，避免卡片残留
      sdkLoginDeviceCode.value = null;
    }
  }

  /** OpenCode Zen / GitHub PAT：提交官网复制的 Key；runtime 内会顺手刷模型 */
  async function submitAgentSdkApiKey(templateId: string): Promise<void> {
    if (!session.value) return;
    const key = sdkLoginApiKeyDraft.value.trim();
    if (!key) {
      // 空 Key 提示跟粘贴档走，勿一律「请先粘贴 API Key」
      const paste = settings.value?.agentSdks.find((item) => item.templateId === templateId)
        ?.apiKeyPaste;
      showToast(
        paste === "github-pat"
          ? t("providerSdkGithubPatRequired")
          : paste === "deepseek"
            ? t("providerSdkDeepseekKeyRequired")
            : t("providerSdkApiKeyRequired"),
        "error",
      );
      return;
    }
    sdkBusy.value = true;
    try {
      const result = await api.submitAgentSdkApiKey(session.value.token, templateId, key);
      if (result.state === "ready") {
        sdkLoginNeedsApiKey.value = false;
        sdkLoginApiKeyDraft.value = "";
        await reload();
        notifyProviderConfigChanged();
        // 目录是否已活：占位 / 空 → 提示可手动刷新；已有活列表 → 登录成功即可
        const sdk = settings.value?.agentSdks.find((item) => item.templateId === templateId);
        const catalogLive = Boolean(
          sdk?.models.some((model) => model.id !== "auto" && model.id !== "default"),
        );
        showToast(
          catalogLive ? t("providerSdkLoginDone") : t("providerSdkModelsSyncFailed"),
          catalogLive ? "success" : "error",
        );
        return;
      }
      showToast(t("providerSdkLoginPending"), "error");
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
      if (result.deviceCode) sdkLoginDeviceCode.value = result.deviceCode;
      if (result.state === "ready") sdkLoginDeviceCode.value = null;
      await reload();
      showToast(result.state === "ready" ? t("providerSdkLoginDone") : t("providerSdkLoginPending"), result.state === "ready" ? "success" : "error");
    } catch (caught) {
      showToast(messageOf(caught), "error");
    } finally {
      sdkBusy.value = false;
    }
  }

  /**
   * 取消进行中的登录：即使 sdkBusy 也可点（否则登录轮询期间登出按钮被锁死）。
   * 杀 CLI 子进程 + 状态打回 not_logged_in。
   */
  async function cancelAgentSdkLogin(templateId: string): Promise<void> {
    if (!session.value) return;
    sdkLoginAbort?.abort();
    sdkLoginDeviceCode.value = null;
    sdkLoginNeedsApiKey.value = false;
    sdkLoginApiKeyDraft.value = "";
    sdkBusy.value = false;
    try {
      settings.value = await api.logoutAgentSdk(session.value.token, templateId, locale());
      notifyProviderConfigChanged();
      showToast(t("providerSdkLoginCancelled"), "success");
    } catch (caught) {
      showToast(messageOf(caught), "error");
      await reload().catch(() => undefined);
    }
  }

  /**
   * 登出本地 App：只把登录态打回未登录，接入组件还留着（移除接入才会删目录）。
   * 换账号 / 订阅过期都走这里；模型目录由 runtime 一并清空，这里只负责刷新。
   */
  async function logoutAgentSdk(templateId: string): Promise<void> {
    if (!session.value || sdkBusy.value) return;
    sdkBusy.value = true;
    try {
      sdkLoginDeviceCode.value = null;
      sdkLoginNeedsApiKey.value = false;
      sdkLoginApiKeyDraft.value = "";
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
    modelProviderFilterOptions,
    configured,
    overridden,
    agentSdks,
    busy,
    loaded,
    draftTemplateId,
    draftBaseUrl,
    draftApiKey,
    modelFilter,
    modelProviderFilter,
    modelEnabledOnly,
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
    sdkModelsBusy,
    sdkPhase,
    sdkLoginDeviceCode,
    sdkLoginNeedsApiKey,
    sdkLoginApiKeyDraft,
    load,
    startAgentSdkInstall,
    cancelAgentSdkInstall,
    loginAgentSdk,
    checkAgentSdkLogin,
    submitAgentSdkApiKey,
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
    activateModel,
  };
}

export type { ProviderTemplate, ProviderVendorGroup, ProviderConnection, AvailableProviderModel };

function messageOf(caught: unknown): string {
  return caught instanceof DesktopApiError ? caught.message : "AI 服务配置失败";
}

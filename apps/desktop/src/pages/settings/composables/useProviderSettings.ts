import { computed, onMounted, ref, watch } from "vue";

import { useDesktop } from "../../../app/desktop";
import { DesktopApi, DesktopApiError } from "../../../shared/api/runtime";
import type {
  AvailableProviderModel,
  ProviderConnection,
  ProviderSettings,
  ProviderTemplate,
  ProviderVendorGroup,
} from "../../../shared/model/runtime";
import { decryptSecret, encryptSecret, secretEncryptionReady } from "../../../shared/secrets";
import { showToast } from "../../../shared/model/toast";
import { readUiLocale, uiLocale } from "../../../shared/model/ui-locale";

export function useProviderSettings(api = new DesktopApi()) {
  const { session } = useDesktop();
  const locale = () => readUiLocale();
  const settings = ref<ProviderSettings | null>(null);
  const busy = ref(false);
  const loaded = ref(false);

  const draftVendorId = ref("");
  const draftTemplateId = ref("");
  const draftBaseUrl = ref("");
  const draftApiKey = ref("");
  const modelFilter = ref("");

  const vendors = computed(() => settings.value?.vendors ?? []);
  const connections = computed(() => settings.value?.connections ?? []);
  const availableModels = computed(() => settings.value?.availableModels ?? []);
  const configured = computed(() => Boolean(settings.value?.configured));
  const overridden = computed(() => Boolean(settings.value?.overriddenByEnvironment));

  const selectedVendor = computed(
    () => vendors.value.find((item) => item.id === draftVendorId.value) ?? null,
  );
  const vendorOptions = computed(() => selectedVendor.value?.options ?? []);
  const selectedTemplate = computed(
    () => vendorOptions.value.find((item) => item.id === draftTemplateId.value) ?? null,
  );
  const existingConnection = computed(
    () => connections.value.find((item) => item.templateId === draftTemplateId.value) ?? null,
  );
  const needsBaseUrl = computed(() => {
    const kind = selectedTemplate.value?.kind;
    return kind === "ollama" || kind === "custom-openai";
  });
  const needsApiKey = computed(() => Boolean(selectedTemplate.value?.requiresApiKey));
  const canRefreshModels = computed(() =>
    connections.value.some((connection) => {
      const template = settings.value?.templates.find((item) => item.id === connection.templateId);
      return Boolean(template?.supportsModelDiscovery);
    }),
  );
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

  watch(vendors, (list) => {
    if (!list.length) return;
    if (!draftVendorId.value || !list.some((item) => item.id === draftVendorId.value)) {
      draftVendorId.value = list[0]!.id;
    }
  });

  watch([draftVendorId, vendorOptions], () => {
    const options = vendorOptions.value;
    if (!options.length) {
      draftTemplateId.value = "";
      return;
    }
    if (!options.some((item) => item.id === draftTemplateId.value)) {
      draftTemplateId.value = options[0]!.id;
      applyTemplateDefaults(options[0]!);
    }
  });

  watch(draftTemplateId, (templateId) => {
    const template = vendorOptions.value.find((item) => item.id === templateId);
    if (template) applyTemplateDefaults(template);
  });

  async function load(): Promise<void> {
    if (!session.value) return;
    busy.value = true;
    try {
      const next = await api.providerSettings(session.value.token, locale());
      settings.value = next;
      await hydrateSecrets(next);
      if (!draftVendorId.value && next.vendors[0]) {
        draftVendorId.value = next.vendors[0].id;
      }
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

  function onVendorChange(): void {
    const options = vendorOptions.value;
    draftTemplateId.value = options[0]?.id ?? "";
    if (options[0]) applyTemplateDefaults(options[0]);
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
    if (!targets.length) {
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
      if (ok > 0) showToast(ok === targets.length ? "模型列表已更新" : `已更新 ${ok}/${targets.length} 个服务商`, "success");
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
      showToast(`已切换到 ${model.name}`, "success");
    } catch (caught) {
      showToast(messageOf(caught), "error");
    } finally {
      busy.value = false;
    }
  }

  return {
    settings,
    vendors,
    connections,
    availableModels,
    filteredModels,
    configured,
    overridden,
    busy,
    loaded,
    draftVendorId,
    draftTemplateId,
    draftBaseUrl,
    draftApiKey,
    modelFilter,
    selectedVendor,
    vendorOptions,
    selectedTemplate,
    existingConnection,
    needsBaseUrl,
    needsApiKey,
    canRefreshModels,
    load,
    onVendorChange,
    saveConnection,
    removeConnection,
    refreshAllDiscoverableModels,
    toggleModel,
    activateModel,
  };
}

export type { ProviderTemplate, ProviderVendorGroup, ProviderConnection, AvailableProviderModel };

function messageOf(caught: unknown): string {
  return caught instanceof DesktopApiError ? caught.message : "AI 服务配置失败";
}

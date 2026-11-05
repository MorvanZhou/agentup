import type { UiLocale } from "../../i18n/index.js";
import { ConfigError } from "../load.js";
import { discoverRemoteModels, supportsModelDiscovery } from "../discover-models.js";
import { removeProviderCatalog, syncProviderCatalog } from "../model-catalog.js";
import { getProviderTemplate } from "../provider-templates.js";
import { throwModelCatalogUnavailable } from "./model-list-policy.js";
import { readProviderSettings } from "./settings-view.js";
import { dropRuntimeApiKey, runtimeApiKey } from "./secrets.js";
import { patchStored, readStored } from "./store.js";
import type { ModelRef, ProviderConnection, ProviderSettingsView } from "./types.js";
import { clean, modelKey } from "./util.js";
import { validateConnection } from "./validate.js";

export function upsertProviderConnection(
  userDataRoot: string,
  input: {
    templateId: string;
    baseUrl?: string;
    apiKeyCipher?: string;
    clearApiKey?: boolean;
    /** 手动追加到可用模型列表（任意已连接服务商） */
    customModelId?: string;
    locale?: UiLocale;
  },
): ProviderSettingsView {
  const stored = readStored(userDataRoot);
  // SDK 接入没有 Base URL / API Key 可填，走另一条流程（安装 + 登录）
  if (getProviderTemplate(clean(input.templateId))?.access === "agent-sdk") {
    throw new ConfigError("请先在「CLI / SDK 接入」中安装并登录");
  }
  const existing = stored.connections.find((item) => item.templateId === clean(input.templateId));
  let apiKeyCipher = existing?.apiKeyCipher;
  if (input.clearApiKey) {
    apiKeyCipher = undefined;
    dropRuntimeApiKey(clean(input.templateId));
  } else if (typeof input.apiKeyCipher === "string" && input.apiKeyCipher.trim()) {
    apiKeyCipher = input.apiKeyCipher.trim();
  }
  const customModelIds = [...(existing?.customModelIds ?? [])];
  const extraModel = clean(input.customModelId);
  if (extraModel && !customModelIds.includes(extraModel)) customModelIds.push(extraModel);
  const next = validateConnection({
    templateId: input.templateId,
    baseUrl: input.baseUrl !== undefined ? input.baseUrl : existing?.baseUrl,
    apiKeyCipher,
    customModelIds: customModelIds.length ? customModelIds : undefined,
    discoveredModelIds: existing?.discoveredModelIds,
  });
  // validateConnection 在未传 cipher 时会丢掉字段；无 clear 时保留旧密文
  if (!input.clearApiKey && apiKeyCipher && !next.apiKeyCipher) {
    next.apiKeyCipher = apiKeyCipher;
  }
  const connections = [...stored.connections];
  const index = connections.findIndex((item) => item.templateId === next.templateId);
  if (index >= 0) connections[index] = next;
  else connections.push(next);
  let { enabledModels, activeModel } = stored;
  const template = getProviderTemplate(next.templateId)!;
  const catalogIds = new Set([
    ...(template.models ?? []).map((m) => m.id),
    ...(next.discoveredModelIds ?? []),
    ...(next.customModelIds ?? []),
  ]);
  // 可发现模型的空目录：等 refresh 后再启用，避免启用尚未存在的 defaultModelId
  if (
    template.defaultModelId &&
    (!supportsModelDiscovery(template.kind) || catalogIds.has(template.defaultModelId))
  ) {
    catalogIds.add(template.defaultModelId);
  }
  // 新连接且尚无激活模型时，默认启用该供应商的默认模型
  if (!activeModel && catalogIds.size > 0) {
    const modelId = extraModel || template.defaultModelId || [...catalogIds][0]!;
    activeModel = { templateId: next.templateId, modelId };
    if (!enabledModels.some((m) => m.templateId === next.templateId && m.modelId === modelId)) {
      enabledModels = [...enabledModels, activeModel];
    }
  } else if (extraModel) {
    const ref = { templateId: next.templateId, modelId: extraModel };
    if (!enabledModels.some((m) => modelKey(m) === modelKey(ref))) {
      enabledModels = [...enabledModels, ref];
    }
    if (!activeModel) activeModel = ref;
  }
  patchStored(userDataRoot, stored, { connections, enabledModels, activeModel });
  syncProviderCatalog(userDataRoot, next.templateId, knownModelIdsForConnection(next));
  return readProviderSettings(userDataRoot, process.env, input.locale ?? "zh");
}

export function deleteProviderConnection(
  userDataRoot: string,
  templateId: string,
  locale: UiLocale = "zh",
): ProviderSettingsView {
  const stored = readStored(userDataRoot);
  const connections = stored.connections.filter((item) => item.templateId !== templateId);
  dropRuntimeApiKey(templateId);
  let enabledModels = stored.enabledModels.filter((item) => item.templateId !== templateId);
  let activeModel = stored.activeModel?.templateId === templateId ? null : stored.activeModel;
  if (!activeModel && enabledModels.length > 0) activeModel = enabledModels[0]!;
  patchStored(userDataRoot, stored, { connections, enabledModels, activeModel });
  removeProviderCatalog(userDataRoot, templateId);
  return readProviderSettings(userDataRoot, process.env, locale);
}

/** 从连接上移除手动追加的模型 id（内置 / 自动发现的目录项不可删）。 */
export function removeCustomModel(
  userDataRoot: string,
  ref: ModelRef,
  locale: UiLocale = "zh",
): ProviderSettingsView {
  const stored = readStored(userDataRoot);
  const templateId = clean(ref.templateId);
  const modelId = clean(ref.modelId);
  if (!templateId || !modelId) throw new ConfigError("模型无效");
  const index = stored.connections.findIndex((item) => item.templateId === templateId);
  if (index < 0) throw new ConfigError("请先配置该服务商");
  const connection = stored.connections[index]!;
  const template = getProviderTemplate(templateId);
  if (!template) throw new ConfigError("未知的服务商");
  const catalogIds = new Set([
    ...(template.models ?? []).map((model) => model.id),
    ...(connection.discoveredModelIds ?? []),
  ]);
  if (catalogIds.has(modelId)) {
    throw new ConfigError("内置或自动发现的模型不能删除");
  }
  const customModelIds = (connection.customModelIds ?? []).filter((id) => id !== modelId);
  if ((connection.customModelIds ?? []).length === customModelIds.length) {
    throw new ConfigError("只能移除手动添加的模型");
  }
  const next = validateConnection({
    ...connection,
    customModelIds: customModelIds.length ? customModelIds : undefined,
  });
  if (connection.apiKeyCipher && !next.apiKeyCipher) next.apiKeyCipher = connection.apiKeyCipher;
  const connections = [...stored.connections];
  connections[index] = next;

  const knownIds = new Set(knownModelIdsForConnection(next));
  let enabledModels = stored.enabledModels.filter(
    (item) => item.templateId !== templateId || knownIds.has(item.modelId),
  );
  let activeModel = stored.activeModel;
  if (activeModel && (activeModel.templateId !== templateId || !knownIds.has(activeModel.modelId))) {
    activeModel =
      enabledModels.find((item) => item.templateId === templateId) ?? enabledModels[0] ?? null;
  }
  if (activeModel && !enabledModels.some((item) => modelKey(item) === modelKey(activeModel!))) {
    enabledModels = [...enabledModels, activeModel];
  }
  patchStored(userDataRoot, stored, { connections, enabledModels, activeModel });
  syncProviderCatalog(userDataRoot, templateId, knownModelIdsForConnection(next));
  return readProviderSettings(userDataRoot, process.env, locale);
}

/** 向已连接服务商拉取最新模型目录，写入 discoveredModelIds。 */
export async function refreshProviderModels(
  userDataRoot: string,
  templateId: string,
  locale: UiLocale = "zh",
): Promise<ProviderSettingsView> {
  const stored = readStored(userDataRoot);
  const id = clean(templateId);
  const connection = stored.connections.find((item) => item.templateId === id);
  if (!connection) throw new ConfigError("请先配置该服务商");
  const template = getProviderTemplate(id, locale);
  if (!template) throw new ConfigError("未知的服务商");
  if (!supportsModelDiscovery(template.kind)) {
    throw new ConfigError("该服务商不支持自动拉取模型列表");
  }
  const baseUrl = connection.baseUrl || template.defaultBaseUrl;
  if (!baseUrl) throw new ConfigError("请填写服务地址");
  const apiKey = runtimeApiKey(template, connection);

  const discoveredModelIds = await discoverRemoteModels({
    baseUrl,
    apiKey: template.requiresApiKey ? apiKey : undefined,
    kind: template.kind,
  });
  if (discoveredModelIds.length === 0) {
    throwModelCatalogUnavailable();
  }

  const nextConnection = validateConnection({
    ...connection,
    discoveredModelIds,
  });
  const connections = stored.connections.map((item) =>
    item.templateId === id ? nextConnection : item,
  );
  const knownIds = new Set([
    ...(template.models ?? []).map((model) => model.id),
    ...discoveredModelIds,
    ...(nextConnection.customModelIds ?? []),
  ]);
  let enabledModels = stored.enabledModels.filter(
    (item) => item.templateId !== id || knownIds.has(item.modelId),
  );
  let activeModel = stored.activeModel;
  const activeMissing =
    !activeModel || (activeModel.templateId === id && !knownIds.has(activeModel.modelId));
  if (activeMissing) {
    const modelId =
      (template.defaultModelId && knownIds.has(template.defaultModelId)
        ? template.defaultModelId
        : discoveredModelIds[0])!;
    activeModel = { templateId: id, modelId };
  }
  if (activeModel && !enabledModels.some((item) => modelKey(item) === modelKey(activeModel!))) {
    enabledModels = [...enabledModels, activeModel];
  }
  patchStored(userDataRoot, stored, { connections, enabledModels, activeModel });
  const saved = connections.find((item) => item.templateId === id);
  if (saved) syncProviderCatalog(userDataRoot, id, knownModelIdsForConnection(saved));
  return readProviderSettings(userDataRoot, process.env, locale);
}

/** 该连接上「确实存在」的模型 id：模板目录 + 发现 + 手动追加。 */
function knownModelIdsForConnection(connection: ProviderConnection): string[] {
  const template = getProviderTemplate(connection.templateId);
  const ids = [
    ...(template?.models ?? []).map((model) => model.id),
    ...(connection.discoveredModelIds ?? []),
    ...(connection.customModelIds ?? []),
  ];
  if (ids.length === 0 && template?.defaultModelId) ids.push(template.defaultModelId);
  return ids;
}

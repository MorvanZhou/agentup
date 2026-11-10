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
import {
  allowsMultipleConnections,
  clean,
  connectionIdOf,
  findConnection,
  modelKey,
} from "./util.js";
import { mintConnectionId, validateConnection } from "./validate.js";

export function upsertProviderConnection(
  userDataRoot: string,
  input: {
    templateId: string;
    /** 已有连接的主键；缺省时更新该模板下第一条（或新建） */
    connectionId?: string;
    /** 为可多实例模板再开一条新连接 */
    createNew?: boolean;
    displayName?: string;
    baseUrl?: string;
    apiKeyCipher?: string;
    clearApiKey?: boolean;
    /** 手动追加到可用模型列表（任意已连接服务商） */
    customModelId?: string;
    locale?: UiLocale;
  },
): ProviderSettingsView {
  const stored = readStored(userDataRoot);
  const templateId = clean(input.templateId);
  const template = getProviderTemplate(templateId);
  // SDK 接入没有 Base URL / API Key 可填，走另一条流程（安装 + 登录）
  if (template?.access === "agent-sdk") {
    throw new ConfigError("请先在「CLI / SDK 接入」中安装并登录");
  }
  if (!template) throw new ConfigError("未知的服务商");

  const multi = allowsMultipleConnections(template.kind);
  let existing: ProviderConnection | undefined;
  let connectionId = clean(input.connectionId);

  if (input.createNew) {
    if (!multi) throw new ConfigError("该服务商只支持一条连接");
    connectionId = mintConnectionId(templateId);
    existing = undefined;
  } else if (connectionId) {
    existing = findConnection(stored.connections, connectionId);
    if (!existing) throw new ConfigError("请先配置该服务商");
    if (existing.templateId !== templateId) throw new ConfigError("服务商与连接不匹配");
  } else {
    // 未指定 connectionId：单槽按 templateId；多实例改第一条，没有则新建（主键=templateId 兼容旧档）
    existing = stored.connections.find((item) => item.templateId === templateId);
    connectionId = existing?.connectionId || templateId;
  }

  let apiKeyCipher = existing?.apiKeyCipher;
  if (input.clearApiKey) {
    apiKeyCipher = undefined;
    dropRuntimeApiKey(connectionId);
  } else if (typeof input.apiKeyCipher === "string" && input.apiKeyCipher.trim()) {
    apiKeyCipher = input.apiKeyCipher.trim();
  }
  const customModelIds = [...(existing?.customModelIds ?? [])];
  const extraModel = clean(input.customModelId);
  if (extraModel && !customModelIds.includes(extraModel)) customModelIds.push(extraModel);

  const displayName =
    input.displayName !== undefined ? clean(input.displayName) : existing?.displayName;

  // 非多实例：禁止同一 template 出现第二条
  if (!multi && !existing && stored.connections.some((item) => item.templateId === templateId)) {
    throw new ConfigError("该服务商已配置");
  }

  const next = validateConnection({
    connectionId,
    templateId,
    displayName: displayName || undefined,
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
  const index = connections.findIndex((item) => item.connectionId === next.connectionId);
  if (index >= 0) connections[index] = next;
  else connections.push(next);
  let { enabledModels, activeModel } = stored;
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
  const toRef = (modelId: string): ModelRef => ({
    templateId: next.templateId,
    connectionId: next.connectionId,
    modelId,
  });
  // 新连接且尚无激活模型时，默认启用该供应商的默认模型
  if (!activeModel && catalogIds.size > 0) {
    const modelId = extraModel || template.defaultModelId || [...catalogIds][0]!;
    activeModel = toRef(modelId);
    if (!enabledModels.some((m) => modelKey(m) === modelKey(activeModel!))) {
      enabledModels = [...enabledModels, activeModel];
    }
  } else if (extraModel) {
    const ref = toRef(extraModel);
    if (!enabledModels.some((m) => modelKey(m) === modelKey(ref))) {
      enabledModels = [...enabledModels, ref];
    }
    if (!activeModel) activeModel = ref;
  }
  patchStored(userDataRoot, stored, { connections, enabledModels, activeModel });
  // 目录缓存按模板 kind 存；多实例共享同一 templateId 的限窗即可
  syncProviderCatalog(userDataRoot, next.templateId, knownModelIdsForConnection(next));
  return readProviderSettings(userDataRoot, process.env, input.locale ?? "zh");
}

/** connectionId 优先；旧调用方仍可传 templateId（等于迁移后的 connectionId）。 */
export function deleteProviderConnection(
  userDataRoot: string,
  connectionId: string,
  locale: UiLocale = "zh",
): ProviderSettingsView {
  const stored = readStored(userDataRoot);
  const id = clean(connectionId);
  const target =
    findConnection(stored.connections, id) ??
    stored.connections.find((item) => item.templateId === id);
  if (!target) throw new ConfigError("请先配置该服务商");
  const connections = stored.connections.filter((item) => item.connectionId !== target.connectionId);
  dropRuntimeApiKey(target.connectionId);
  let enabledModels = stored.enabledModels.filter(
    (item) => connectionIdOf(item) !== target.connectionId,
  );
  let activeModel =
    stored.activeModel && connectionIdOf(stored.activeModel) === target.connectionId
      ? null
      : stored.activeModel;
  if (!activeModel && enabledModels.length > 0) activeModel = enabledModels[0]!;
  patchStored(userDataRoot, stored, { connections, enabledModels, activeModel });
  // 同模板还有别的连接时保留目录缓存
  if (!connections.some((item) => item.templateId === target.templateId)) {
    removeProviderCatalog(userDataRoot, target.templateId);
  }
  return readProviderSettings(userDataRoot, process.env, locale);
}

/** 从连接上移除手动追加的模型 id（内置 / 自动发现的目录项不可删）。 */
export function removeCustomModel(
  userDataRoot: string,
  ref: ModelRef,
  locale: UiLocale = "zh",
): ProviderSettingsView {
  const stored = readStored(userDataRoot);
  const modelId = clean(ref.modelId);
  if (!modelId) throw new ConfigError("模型无效");
  const connectionId = connectionIdOf(ref);
  const index = stored.connections.findIndex(
    (item) => item.connectionId === connectionId || item.templateId === clean(ref.templateId),
  );
  if (index < 0) throw new ConfigError("请先配置该服务商");
  const connection = stored.connections[index]!;
  const template = getProviderTemplate(connection.templateId);
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
    (item) =>
      connectionIdOf(item) !== next.connectionId || knownIds.has(item.modelId),
  );
  let activeModel = stored.activeModel;
  if (
    activeModel &&
    connectionIdOf(activeModel) === next.connectionId &&
    !knownIds.has(activeModel.modelId)
  ) {
    activeModel =
      enabledModels.find((item) => connectionIdOf(item) === next.connectionId) ??
      enabledModels[0] ??
      null;
  }
  if (activeModel && !enabledModels.some((item) => modelKey(item) === modelKey(activeModel!))) {
    enabledModels = [...enabledModels, activeModel];
  }
  patchStored(userDataRoot, stored, { connections, enabledModels, activeModel });
  syncProviderCatalog(userDataRoot, next.templateId, knownModelIdsForConnection(next));
  return readProviderSettings(userDataRoot, process.env, locale);
}

/** 向已连接服务商拉取最新模型目录，写入 discoveredModelIds。参数为 connectionId（兼容旧 templateId）。 */
export async function refreshProviderModels(
  userDataRoot: string,
  connectionId: string,
  locale: UiLocale = "zh",
): Promise<ProviderSettingsView> {
  const stored = readStored(userDataRoot);
  const id = clean(connectionId);
  const connection =
    findConnection(stored.connections, id) ??
    stored.connections.find((item) => item.templateId === id);
  if (!connection) throw new ConfigError("请先配置该服务商");
  const template = getProviderTemplate(connection.templateId, locale);
  if (!template) throw new ConfigError("未知的服务商");
  if (!supportsModelDiscovery(template.kind)) {
    throw new ConfigError("该服务商不支持自动拉取模型列表");
  }
  const baseUrl = connection.baseUrl || template.defaultBaseUrl;
  if (!baseUrl) throw new ConfigError("请填写服务地址");
  const apiKey = runtimeApiKey(template, connection);

  let discoveredModelIds: string[];
  try {
    discoveredModelIds = await discoverRemoteModels({
      baseUrl,
      apiKey: template.requiresApiKey ? apiKey : undefined,
      kind: template.kind,
    });
    if (discoveredModelIds.length === 0) throwModelCatalogUnavailable();
  } catch (error) {
    // 服务挂了 / 空目录：清掉陈旧 discovered，保留手配；再抛错给 UI toast
    clearDiscoveredModels(userDataRoot, connection);
    throw error;
  }

  const nextConnection = validateConnection({
    ...connection,
    discoveredModelIds,
  });
  const connections = stored.connections.map((item) =>
    item.connectionId === connection.connectionId ? nextConnection : item,
  );
  const knownIds = new Set([
    ...(template.models ?? []).map((model) => model.id),
    ...discoveredModelIds,
    ...(nextConnection.customModelIds ?? []),
  ]);
  let enabledModels = stored.enabledModels.filter(
    (item) =>
      connectionIdOf(item) !== nextConnection.connectionId || knownIds.has(item.modelId),
  );
  let activeModel = stored.activeModel;
  const activeMissing =
    !activeModel ||
    (connectionIdOf(activeModel) === nextConnection.connectionId &&
      !knownIds.has(activeModel.modelId));
  if (activeMissing) {
    const modelId =
      (template.defaultModelId && knownIds.has(template.defaultModelId)
        ? template.defaultModelId
        : discoveredModelIds[0])!;
    activeModel = {
      templateId: nextConnection.templateId,
      connectionId: nextConnection.connectionId,
      modelId,
    };
  }
  if (activeModel && !enabledModels.some((item) => modelKey(item) === modelKey(activeModel!))) {
    enabledModels = [...enabledModels, activeModel];
  }
  patchStored(userDataRoot, stored, { connections, enabledModels, activeModel });
  const saved = connections.find((item) => item.connectionId === nextConnection.connectionId);
  if (saved) syncProviderCatalog(userDataRoot, saved.templateId, knownModelIdsForConnection(saved));
  return readProviderSettings(userDataRoot, process.env, locale);
}

/** 刷新失败时复位 discovered；手配 customModelIds 不动。 */
function clearDiscoveredModels(userDataRoot: string, connection: ProviderConnection): void {
  const stored = readStored(userDataRoot);
  const nextConnection = validateConnection({
    ...connection,
    discoveredModelIds: undefined,
  });
  if (connection.apiKeyCipher && !nextConnection.apiKeyCipher) {
    nextConnection.apiKeyCipher = connection.apiKeyCipher;
  }
  const connections = stored.connections.map((item) =>
    item.connectionId === connection.connectionId ? nextConnection : item,
  );
  const knownIds = new Set(knownModelIdsForConnection(nextConnection));
  let enabledModels = stored.enabledModels.filter(
    (item) =>
      connectionIdOf(item) !== nextConnection.connectionId || knownIds.has(item.modelId),
  );
  let activeModel = stored.activeModel;
  if (
    activeModel &&
    connectionIdOf(activeModel) === nextConnection.connectionId &&
    !knownIds.has(activeModel.modelId)
  ) {
    activeModel =
      enabledModels.find((item) => connectionIdOf(item) === nextConnection.connectionId) ??
      enabledModels[0] ??
      null;
  }
  if (activeModel && !enabledModels.some((item) => modelKey(item) === modelKey(activeModel!))) {
    enabledModels = [...enabledModels, activeModel];
  }
  patchStored(userDataRoot, stored, { connections, enabledModels, activeModel });
  syncProviderCatalog(
    userDataRoot,
    nextConnection.templateId,
    knownModelIdsForConnection(nextConnection),
  );
}

/** 该连接上「确实存在」的模型 id：模板目录 + 发现 + 手动追加（可发现类不塞假 default）。 */
function knownModelIdsForConnection(connection: ProviderConnection): string[] {
  const template = getProviderTemplate(connection.templateId);
  const ids = [
    ...(template?.models ?? []).map((model) => model.id),
    ...(connection.discoveredModelIds ?? []),
    ...(connection.customModelIds ?? []),
  ];
  if (
    ids.length === 0 &&
    template?.defaultModelId &&
    template.kind &&
    !supportsModelDiscovery(template.kind)
  ) {
    ids.push(template.defaultModelId);
  }
  return ids;
}

import fs from "node:fs";
import path from "node:path";

import { ConfigError, type ModelConfig } from "./load.js";
import type { UiLocale } from "../i18n/index.js";
import {
  discoverRemoteModels,
  supportsModelDiscovery,
} from "./discover-models.js";
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
  peekTemplateModelLimits,
  removeProviderCatalog,
  resolveModelLimits,
  syncProviderCatalog,
} from "./model-catalog.js";
import {
  getProviderTemplate,
  listProviderTemplateViews,
  listVendorGroups,
} from "./provider-templates.js";

export { supportsModelDiscovery } from "./discover-models.js";

const FILE_VERSION = 2 as const;
const PLACEHOLDER_KEY = "ollama";
const MAX_DISCOVERED_MODELS = 200;

export interface ProviderConnection {
  templateId: string;
  baseUrl?: string;
  apiKeyCipher?: string;
  /** Ollama / 自定义等无目录时用户填写的模型 id */
  customModelIds?: string[];
  /** 从服务商 List Models 拉回的候选（可刷新） */
  discoveredModelIds?: string[];
}

export interface ModelRef {
  templateId: string;
  modelId: string;
}

export interface ProviderConnectionView extends ProviderConnection {
  hasApiKey: boolean;
  piProviderId: string;
  requiresApiKey: boolean;
  vendorId: string;
  vendorLabel: string;
  optionLabel: string;
  label: string;
}

export interface AvailableModelView {
  templateId: string;
  modelId: string;
  name: string;
  vendorLabel: string;
  optionLabel: string;
  enabled: boolean;
  active: boolean;
  /** 仅手动追加、不在内置/发现目录中，可从列表移除 */
  custom: boolean;
}

export interface ProviderSettingsView {
  connections: ProviderConnectionView[];
  enabledModels: ModelRef[];
  activeModel: ModelRef | null;
  availableModels: AvailableModelView[];
  configured: boolean;
  overriddenByEnvironment: boolean;
  templates: ReturnType<typeof listProviderTemplateViews>;
  vendors: ReturnType<typeof listVendorGroups>;
}

interface StoredFile {
  version: typeof FILE_VERSION;
  connections: ProviderConnection[];
  enabledModels: ModelRef[];
  activeModel: ModelRef | null;
}

/**
 * 密文已落盘，但本进程还没收到桌面解密后的明文。
 * 退出重进时 runtime 先起来、密钥稍后才注入；这不是密钥丢了。
 */
export class ProviderSecretPendingError extends ConfigError {
  constructor() {
    super("模型密钥还在载入，请稍后再试");
  }
}

/** 明文 Key 只留在进程内存，key = templateId。 */
const runtimeSecrets = new Map<string, string>();
const secretReadyListeners = new Set<() => void>();

/** 桌面把明文注入内存后通知。用于把退出时中断的回合接上，而不是先报缺密钥。 */
export function onRuntimeProviderSecrets(listener: () => void): () => void {
  secretReadyListeners.add(listener);
  return () => {
    secretReadyListeners.delete(listener);
  };
}

export function setRuntimeProviderSecrets(secrets: Record<string, string>): void {
  let added = false;
  for (const [templateId, apiKey] of Object.entries(secrets)) {
    const key = apiKey.trim();
    if (!templateId.trim()) continue;
    if (!key) {
      runtimeSecrets.delete(templateId);
      continue;
    }
    runtimeSecrets.set(templateId, key);
    added = true;
  }
  if (!added) return;
  for (const listener of secretReadyListeners) {
    try {
      listener();
    } catch {
      // 某一个等待方失败不挡住其余回合。
    }
  }
}

export function clearRuntimeProviderSecrets(): void {
  runtimeSecrets.clear();
}

/** 要密钥的服务商：内存里有明文才可用。盘上有密文只说明还没注入，不是密钥丢了。 */
function runtimeApiKey(
  template: { id: string; requiresApiKey: boolean },
  connection: ProviderConnection,
): string {
  if (!template.requiresApiKey) return runtimeSecrets.get(template.id) || PLACEHOLDER_KEY;
  const key = runtimeSecrets.get(template.id) ?? "";
  if (key) return key;
  if (connection.apiKeyCipher) throw new ProviderSecretPendingError();
  throw new ConfigError("当前服务商缺少 API Key，请重新保存密钥");
}

export function readProviderSettings(
  userDataRoot: string,
  env: NodeJS.ProcessEnv = process.env,
  locale: UiLocale = "zh",
): ProviderSettingsView {
  const stored = readStored(userDataRoot);
  const overriddenByEnvironment = envOverrides(env);
  const connections = stored.connections.map((item) => toConnectionView(item, locale));
  const availableModels = buildAvailableModels(stored, locale);
  return {
    connections,
    enabledModels: stored.enabledModels,
    activeModel: stored.activeModel,
    availableModels,
    configured: Boolean(
      overriddenByEnvironment.model ||
        stored.enabledModels.some((model) =>
          stored.connections.some((connection) => connection.templateId === model.templateId),
        ),
    ),
    overriddenByEnvironment: Boolean(
      overriddenByEnvironment.model ||
        overriddenByEnvironment.baseUrl ||
        overriddenByEnvironment.apiKey ||
        overriddenByEnvironment.provider,
    ),
    templates: listProviderTemplateViews(locale),
    vendors: listVendorGroups(locale),
  };
}

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
  const existing = stored.connections.find((item) => item.templateId === clean(input.templateId));
  let apiKeyCipher = existing?.apiKeyCipher;
  if (input.clearApiKey) {
    apiKeyCipher = undefined;
    runtimeSecrets.delete(clean(input.templateId));
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
  persist(userDataRoot, { version: FILE_VERSION, connections, enabledModels, activeModel });
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
  runtimeSecrets.delete(templateId);
  let enabledModels = stored.enabledModels.filter((item) => item.templateId !== templateId);
  let activeModel = stored.activeModel?.templateId === templateId ? null : stored.activeModel;
  if (!activeModel && enabledModels.length > 0) activeModel = enabledModels[0]!;
  persist(userDataRoot, { version: FILE_VERSION, connections, enabledModels, activeModel });
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
  persist(userDataRoot, { version: FILE_VERSION, connections, enabledModels, activeModel });
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
    throw new ConfigError("服务商未返回可用模型");
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
    !activeModel ||
    (activeModel.templateId === id && !knownIds.has(activeModel.modelId));
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
  persist(userDataRoot, { version: FILE_VERSION, connections, enabledModels, activeModel });
  const saved = connections.find((item) => item.templateId === id);
  if (saved) syncProviderCatalog(userDataRoot, id, knownModelIdsForConnection(saved));
  return readProviderSettings(userDataRoot, process.env, locale);
}

export function setModelEnabled(
  userDataRoot: string,
  ref: ModelRef,
  enabled: boolean,
  locale: UiLocale = "zh",
): ProviderSettingsView {
  const stored = readStored(userDataRoot);
  const model = validateModelRef(ref, stored.connections);
  let enabledModels = [...stored.enabledModels];
  let activeModel = stored.activeModel;
  const key = modelKey(model);
  const exists = enabledModels.some((item) => modelKey(item) === key);
  if (enabled && !exists) {
    enabledModels.push(model);
    if (!activeModel) activeModel = model;
  }
  if (!enabled && exists) {
    enabledModels = enabledModels.filter((item) => modelKey(item) !== key);
    if (activeModel && modelKey(activeModel) === key) {
      activeModel = enabledModels[0] ?? null;
    }
  }
  persist(userDataRoot, {
    version: FILE_VERSION,
    connections: stored.connections,
    enabledModels,
    activeModel,
  });
  return readProviderSettings(userDataRoot, process.env, locale);
}

export function setActiveModel(
  userDataRoot: string,
  ref: ModelRef,
  locale: UiLocale = "zh",
): ProviderSettingsView {
  const stored = readStored(userDataRoot);
  const model = validateModelRef(ref, stored.connections);
  let enabledModels = [...stored.enabledModels];
  if (!enabledModels.some((item) => modelKey(item) === modelKey(model))) {
    enabledModels.push(model);
  }
  persist(userDataRoot, {
    version: FILE_VERSION,
    connections: stored.connections,
    enabledModels,
    activeModel: model,
  });
  return readProviderSettings(userDataRoot, process.env, locale);
}

/** 校验 ref 已连接且已启用（会话切换用）。 */
export function requireEnabledModelRef(userDataRoot: string, ref: ModelRef): ModelRef {
  const stored = readStored(userDataRoot);
  const model = validateModelRef(ref, stored.connections);
  if (!stored.enabledModels.some((item) => modelKey(item) === modelKey(model))) {
    throw new ConfigError("请先在设置中启用该模型");
  }
  return model;
}

/** 会话 sidecar 回落：已连接且已启用则返回规范化 ref，否则 null。 */
export function tryEnabledModelRef(
  userDataRoot: string,
  ref: ModelRef | null | undefined,
): ModelRef | null {
  if (!ref) return null;
  try {
    return requireEnabledModelRef(userDataRoot, ref);
  } catch {
    return null;
  }
}

/** 仅更新「最近使用」标记；不自动把未启用模型加进 enabled。 */
export function touchActiveModel(userDataRoot: string, ref: ModelRef): void {
  const stored = readStored(userDataRoot);
  const model = validateModelRef(ref, stored.connections);
  if (!stored.enabledModels.some((item) => modelKey(item) === modelKey(model))) return;
  if (stored.activeModel && modelKey(stored.activeModel) === modelKey(model)) return;
  persist(userDataRoot, {
    version: FILE_VERSION,
    connections: stored.connections,
    enabledModels: stored.enabledModels,
    activeModel: model,
  });
}

/** 设备级回落：activeModel（最近使用）→ enabled 第一个。会话级解析见 session/model/session-model。 */
export function loadModelConfig(userDataRoot: string, env: NodeJS.ProcessEnv = process.env): ModelConfig {
  const override = envOverrides(env);
  if (override.model) {
    return modelConfigFromEnvOverride(override);
  }

  const stored = readStored(userDataRoot);
  const active =
    (stored.activeModel &&
    stored.enabledModels.some((item) => modelKey(item) === modelKey(stored.activeModel!))
      ? stored.activeModel
      : null) ??
    stored.enabledModels[0] ??
    null;
  if (!active) throw new ConfigError("打开会话前请先在设置中连接服务商并启用一个模型");
  return loadModelConfigFromRef(userDataRoot, active, env);
}

/** 无会话模型时可回落的候选：仍已连接的 enabled 第一个。 */
export function firstEnabledModelRef(userDataRoot: string): ModelRef | null {
  const stored = readStored(userDataRoot);
  for (const model of stored.enabledModels) {
    const usable = tryEnabledModelRef(userDataRoot, model);
    if (usable) return usable;
  }
  return null;
}

export function loadModelConfigFromRef(
  userDataRoot: string,
  ref: ModelRef,
  env: NodeJS.ProcessEnv = process.env,
): ModelConfig {
  const override = envOverrides(env);
  if (override.model) return modelConfigFromEnvOverride(override);

  const stored = readStored(userDataRoot);
  const model = validateModelRef(ref, stored.connections);
  const connection = stored.connections.find((item) => item.templateId === model.templateId);
  if (!connection) throw new ConfigError("当前模型所属服务商尚未配置");
  const template = getProviderTemplate(model.templateId);
  if (!template) throw new ConfigError("未知的服务商");
  const apiKey = runtimeApiKey(template, connection);
  const limits = resolveModelLimits(userDataRoot, template.id, model.modelId);
  return {
    providerId: template.piProviderId,
    templateId: template.id,
    modelId: model.modelId,
    apiKey,
    baseUrl: connection.baseUrl || template.defaultBaseUrl,
    kind: template.kind,
    profileId: model.templateId,
    contextWindow: limits.contextWindow,
    maxTokens: limits.maxTokens,
  };
}

function modelConfigFromEnvOverride(override: ReturnType<typeof envOverrides>): ModelConfig {
  const provider = override.provider || "ollama";
  const template = getProviderTemplate(provider);
  const templateId = template?.id ?? provider;
  const modelId = override.model!;
  const limits =
    peekTemplateModelLimits(templateId, modelId) ?? {
      name: modelId,
      contextWindow: DEFAULT_CONTEXT_WINDOW,
      maxTokens: DEFAULT_MAX_TOKENS,
    };
  return {
    providerId: template?.piProviderId ?? provider,
    templateId,
    modelId,
    apiKey: override.apiKey || (template?.requiresApiKey === false ? PLACEHOLDER_KEY : ""),
    baseUrl: override.baseUrl || template?.defaultBaseUrl,
    kind: template?.kind ?? "custom-openai",
    contextWindow: limits.contextWindow,
    maxTokens: limits.maxTokens,
  };
}

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

function buildAvailableModels(stored: StoredFile, locale: UiLocale): AvailableModelView[] {
  const enabled = new Set(stored.enabledModels.map(modelKey));
  const activeKey = stored.activeModel ? modelKey(stored.activeModel) : "";
  const rows: AvailableModelView[] = [];
  for (const connection of stored.connections) {
    const template = getProviderTemplate(connection.templateId, locale);
    if (!template) continue;
    const models = [
      ...(template.models ?? []),
      ...(connection.discoveredModelIds ?? []).map((id) => ({
        id,
        name: id,
        api: template.api ?? "openai-completions",
        reasoning: false,
      })),
      ...(connection.customModelIds ?? []).map((id) => ({
        id,
        name: id,
        api: template.api ?? "openai-completions",
        reasoning: false,
      })),
    ];
    if (models.length === 0 && template.defaultModelId) {
      models.push({
        id: template.defaultModelId,
        name: template.defaultModelId,
        api: template.api ?? "openai-completions",
        reasoning: false,
      });
    }
    const catalogIds = new Set([
      ...(template.models ?? []).map((model) => model.id),
      ...(connection.discoveredModelIds ?? []),
    ]);
    const customIds = new Set(connection.customModelIds ?? []);
    const seen = new Set<string>();
    for (const model of models) {
      if (seen.has(model.id)) continue;
      seen.add(model.id);
      const ref = { templateId: connection.templateId, modelId: model.id };
      const key = modelKey(ref);
      rows.push({
        templateId: connection.templateId,
        modelId: model.id,
        name: model.name,
        vendorLabel: template.vendorLabel,
        optionLabel: template.optionLabel,
        enabled: enabled.has(key),
        active: key === activeKey,
        custom: customIds.has(model.id) && !catalogIds.has(model.id),
      });
    }
  }
  return rows;
}

function toConnectionView(
  connection: ProviderConnection,
  locale: UiLocale,
): ProviderConnectionView {
  const template = getProviderTemplate(connection.templateId, locale);
  const requiresApiKey = template?.requiresApiKey ?? true;
  return {
    ...connection,
    hasApiKey:
      Boolean(connection.apiKeyCipher) ||
      Boolean(runtimeSecrets.get(connection.templateId)) ||
      !requiresApiKey,
    piProviderId: template?.piProviderId ?? connection.templateId,
    requiresApiKey,
    vendorId: template?.vendorId ?? connection.templateId,
    vendorLabel: template?.vendorLabel ?? connection.templateId,
    optionLabel: template?.optionLabel ?? connection.templateId,
    label: template?.label ?? connection.templateId,
  };
}

function validateConnection(value: ProviderConnection): ProviderConnection {
  const templateId = clean(value.templateId);
  if (!templateId) throw new ConfigError("请选择服务商");
  const template = getProviderTemplate(templateId);
  if (!template) throw new ConfigError("未知的服务商");
  let baseUrl: string | undefined;
  if (value.baseUrl !== undefined && value.baseUrl !== null && String(value.baseUrl).trim()) {
    baseUrl = normalizeBaseUrl(String(value.baseUrl));
  } else if (template.defaultBaseUrl && template.kind !== "pi-native") {
    baseUrl = template.defaultBaseUrl;
  }
  if ((template.kind === "ollama" || template.kind === "custom-openai") && !baseUrl) {
    throw new ConfigError("请填写服务地址");
  }
  const apiKeyCipher =
    typeof value.apiKeyCipher === "string" && value.apiKeyCipher.trim()
      ? value.apiKeyCipher.trim()
      : undefined;
  const customModelIds = Array.isArray(value.customModelIds)
    ? [...new Set(value.customModelIds.map((id) => clean(id)).filter(Boolean))].slice(0, 50)
    : undefined;
  const discoveredModelIds = Array.isArray(value.discoveredModelIds)
    ? [
        ...new Set(
          value.discoveredModelIds.map((id) => clean(id)).filter((id) => id && id.length <= 200),
        ),
      ].slice(0, MAX_DISCOVERED_MODELS)
    : undefined;
  return {
    templateId,
    ...(baseUrl ? { baseUrl } : {}),
    ...(apiKeyCipher ? { apiKeyCipher } : {}),
    ...(customModelIds?.length ? { customModelIds } : {}),
    ...(discoveredModelIds?.length ? { discoveredModelIds } : {}),
  };
}

function validateModelRef(ref: ModelRef, connections: ProviderConnection[]): ModelRef {
  const templateId = clean(ref.templateId);
  const modelId = clean(ref.modelId);
  if (!templateId || !modelId || modelId.length > 200) throw new ConfigError("模型无效");
  if (!connections.some((item) => item.templateId === templateId)) {
    throw new ConfigError("请先配置该服务商");
  }
  if (!getProviderTemplate(templateId)) throw new ConfigError("未知的服务商");
  return { templateId, modelId };
}

function modelKey(ref: ModelRef): string {
  return `${ref.templateId}::${ref.modelId}`;
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) throw new ConfigError("服务地址无效");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ConfigError("服务地址无效");
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) {
    throw new ConfigError("服务地址无效");
  }
  return trimmed.replace(/\/+$/, "");
}

function readStored(userDataRoot: string): StoredFile {
  const file = path.join(userDataRoot, "settings", "provider.json");
  if (!fs.existsSync(file)) {
    return { version: FILE_VERSION, connections: [], enabledModels: [], activeModel: null };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    if (raw.version === 2 && Array.isArray(raw.connections)) {
      const connections = (raw.connections as ProviderConnection[]).map(validateConnection);
      const enabledModels = Array.isArray(raw.enabledModels)
        ? (raw.enabledModels as ModelRef[])
            .map((item) => {
              try {
                return validateModelRef(item, connections);
              } catch {
                return null;
              }
            })
            .filter((item): item is ModelRef => Boolean(item))
        : [];
      let activeModel: ModelRef | null = null;
      if (raw.activeModel && typeof raw.activeModel === "object") {
        try {
          activeModel = validateModelRef(raw.activeModel as ModelRef, connections);
        } catch {
          activeModel = enabledModels[0] ?? null;
        }
      }
      return { version: FILE_VERSION, connections, enabledModels, activeModel };
    }
    // v1 档案结构丢弃，重新配置
    return { version: FILE_VERSION, connections: [], enabledModels: [], activeModel: null };
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new ConfigError("本机 AI 服务配置无法读取");
  }
}

function persist(userDataRoot: string, value: StoredFile): void {
  const directory = path.join(userDataRoot, "settings");
  const target = path.join(directory, "provider.json");
  const temporary = `${target}.tmp`;
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
  try {
    const legacy = path.join(directory, "model.json");
    if (fs.existsSync(legacy)) fs.unlinkSync(legacy);
  } catch {
    /* ignore */
  }
}

function envOverrides(env: NodeJS.ProcessEnv) {
  return {
    model: clean(env.AGENTUP_MODEL_NAME),
    baseUrl: clean(env.AGENTUP_MODEL_BASE_URL),
    apiKey: clean(env.AGENTUP_MODEL_API_KEY),
    provider: clean(env.AGENTUP_MODEL_PROVIDER),
  };
}

function clean(value: string | undefined): string {
  return value?.trim() ?? "";
}

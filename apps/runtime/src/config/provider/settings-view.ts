import type { UiLocale } from "../../i18n/index.js";
import { peekTemplateModelLimits } from "../model-catalog.js";
import { supportsModelDiscovery } from "../discover-models.js";
import {
  getProviderTemplate,
  listProviderTemplateViews,
  listVendorGroups,
} from "../provider-templates.js";
import { reconcileAgentSdkDiskState } from "../providers/agent-sdk/installer.js";
import { buildAgentSdkViews } from "./agent-sdk-state.js";
import { envOverrides } from "./env.js";
import { hasRuntimeApiKey } from "./secrets.js";
import { readStored } from "./store.js";
import type {
  AvailableModelView,
  ProviderConnection,
  ProviderConnectionView,
  ProviderSettingsView,
  StoredFile,
} from "./types.js";
import { modelKey } from "./util.js";

/** 设置页整页视图：连接 + 启用模型 + 可用目录 + 模板/厂商 + 本地接入状态。 */
export function readProviderSettings(
  userDataRoot: string,
  env: NodeJS.ProcessEnv = process.env,
  locale: UiLocale = "zh",
): ProviderSettingsView {
  // 盘↔状态对齐：避免「已经接入过了」却仍显示开始接入
  reconcileAgentSdkDiskState(userDataRoot);
  const stored = readStored(userDataRoot);
  const overriddenByEnvironment = envOverrides(env);
  const connections = stored.connections.map((item) => toConnectionView(item, locale));
  /** 只有登录成功的本地接入才进「启用服务」列表：没登录查不到模型，也不该被启用 */
  const readySdkIds = new Set(
    stored.agentSdks.filter((item) => item.state === "ready").map((item) => item.templateId),
  );
  const availableModels = buildAvailableModels(stored, locale, readySdkIds);
  return {
    connections,
    enabledModels: stored.enabledModels,
    activeModel: stored.activeModel,
    availableModels,
    configured: Boolean(
      overriddenByEnvironment.model ||
        stored.enabledModels.some((model) => {
          const connectionId = model.connectionId || model.templateId;
          return (
            stored.connections.some(
              (connection) =>
                connection.connectionId === connectionId ||
                connection.templateId === model.templateId,
            ) || readySdkIds.has(model.templateId)
          );
        }),
    ),
    overriddenByEnvironment: Boolean(
      overriddenByEnvironment.model ||
        overriddenByEnvironment.baseUrl ||
        overriddenByEnvironment.apiKey ||
        overriddenByEnvironment.provider,
    ),
    templates: listProviderTemplateViews(locale),
    vendors: listVendorGroups(locale),
    agentSdks: buildAgentSdkViews(stored.agentSdks, locale),
  };
}

/** 可用模型目录 = 已连接服务商（模板 + 发现 + 手动追加）+ 已登录的本地接入。 */
export function buildAvailableModels(
  stored: StoredFile,
  locale: UiLocale,
  readySdkIds: Set<string> = new Set(),
): AvailableModelView[] {
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
    // 可发现类（Ollama / 自定义）：空目录就空着，禁止用 defaultModelId 冒充「已发现」
    if (
      models.length === 0 &&
      template.defaultModelId &&
      !supportsModelDiscovery(template.kind)
    ) {
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
    // 多端点：端点名（若有）或 host，避免两条自定义都叫同一句
    const sourceLabel = connectionSourceLabel(connection, template.label);
    for (const model of models) {
      if (seen.has(model.id)) continue;
      seen.add(model.id);
      const ref = {
        templateId: connection.templateId,
        connectionId: connection.connectionId,
        modelId: model.id,
      };
      const key = modelKey(ref);
      // API：只展示内置模板已知窗口（pi-native / ark），勿用默认 128k 冒充
      const limits = peekTemplateModelLimits(connection.templateId, model.id);
      const contextWindow =
        limits && limits.contextWindow > 0 ? limits.contextWindow : undefined;
      rows.push({
        templateId: connection.templateId,
        connectionId: connection.connectionId,
        modelId: model.id,
        name: model.name,
        vendorId: template.vendorId,
        vendorLabel: template.vendorLabel,
        optionLabel: template.optionLabel,
        label: sourceLabel,
        enabled: enabled.has(key),
        active: key === activeKey,
        custom: customIds.has(model.id) && !catalogIds.has(model.id),
        ...(contextWindow === undefined ? {} : { contextWindow }),
      });
    }
  }
  // 本地接入没有「连接」记录，能用哪些模型由本地 SDK 登录后给出
  for (const templateId of readySdkIds) {
    const template = getProviderTemplate(templateId, locale);
    if (!template) continue;
    const record = stored.agentSdks.find((item) => item.templateId === templateId);
    const models = record?.models?.length ? record.models : (template.models ?? []);
    // 模板默认项没有倍率/窗口，只有 SDK 查回来的目录才有
    const rates = new Map(
      (record?.models ?? [])
        .filter((model) => typeof model.credits === "number")
        .map((model) => [model.id, model.credits as number]),
    );
    const windows = new Map(
      (record?.models ?? [])
        .filter((model) => typeof model.contextWindow === "number" && model.contextWindow > 0)
        .map((model) => [model.id, model.contextWindow as number]),
    );
    for (const model of models) {
      const ref = { templateId, connectionId: templateId, modelId: model.id };
      const key = modelKey(ref);
      const credits = rates.get(model.id);
      const contextWindow = windows.get(model.id);
      rows.push({
        templateId,
        connectionId: templateId,
        modelId: model.id,
        name: model.name,
        vendorId: template.vendorId,
        vendorLabel: template.vendorLabel,
        optionLabel: template.optionLabel,
        label: template.label,
        enabled: enabled.has(key),
        active: key === activeKey,
        custom: false,
        // 0 是真实倍率：只能用 !== undefined 判
        ...(credits === undefined ? {} : { credits }),
        ...(contextWindow === undefined ? {} : { contextWindow }),
      });
    }
  }
  return rows;
}

/** 多端点展示名：优先旧档 displayName，否则拼 host，免用户手填。 */
function connectionSourceLabel(connection: ProviderConnection, baseLabel: string): string {
  const named = connection.displayName?.trim();
  if (named) return named;
  const host = hostOfBaseUrl(connection.baseUrl);
  return host ? `${baseLabel} · ${host}` : baseLabel;
}

function hostOfBaseUrl(baseUrl: string | undefined): string | undefined {
  if (!baseUrl?.trim()) return undefined;
  try {
    return new URL(baseUrl).host || undefined;
  } catch {
    return undefined;
  }
}

/** 连接 + 模板静态描述 + 本机是否已有明文密钥。 */
export function toConnectionView(
  connection: ProviderConnection,
  locale: UiLocale,
): ProviderConnectionView {
  const template = getProviderTemplate(connection.templateId, locale);
  const requiresApiKey = template?.requiresApiKey ?? true;
  const baseLabel = template?.label ?? connection.templateId;
  return {
    ...connection,
    hasApiKey:
      Boolean(connection.apiKeyCipher) ||
      hasRuntimeApiKey(connection.connectionId) ||
      !requiresApiKey,
    piProviderId: template?.piProviderId ?? connection.templateId,
    requiresApiKey,
    vendorId: template?.vendorId ?? connection.templateId,
    vendorLabel: template?.vendorLabel ?? connection.templateId,
    optionLabel: template?.optionLabel ?? connection.templateId,
    label: connectionSourceLabel(connection, baseLabel),
  };
}

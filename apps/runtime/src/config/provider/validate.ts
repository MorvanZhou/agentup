import { ConfigError } from "../load.js";
import { getProviderTemplate } from "../provider-templates.js";
import { MAX_AGENT_SDK_MODELS, MAX_DISCOVERED_MODELS } from "./constants.js";
import type {
  AgentSdkModel,
  AgentSdkRecord,
  AgentSdkState,
  ModelRef,
  ProviderConnection,
  StoredFile,
} from "./types.js";
import { clean, normalizeBaseUrl } from "./util.js";

const AGENT_SDK_STATES: readonly AgentSdkState[] = [
  "not_installed",
  "installing",
  "install_failed",
  "installed",
  "not_logged_in",
  "logging_in",
  "ready",
  "error",
];

/** 连接落盘前的形状校验：补全默认地址、裁掉脏 id、丢掉空字段。 */
export function validateConnection(value: ProviderConnection): ProviderConnection {
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

export function validateModelRef(ref: ModelRef, stored: StoredFile): ModelRef {
  const templateId = clean(ref.templateId);
  const modelId = clean(ref.modelId);
  if (!templateId || !modelId || modelId.length > 200) throw new ConfigError("模型无效");
  const template = getProviderTemplate(templateId);
  if (!template) throw new ConfigError("未知的服务商");
  // 本地接入没有连接记录，靠「已安装且已登录」判定可用
  if (template.access === "agent-sdk") return validateAgentSdkModelRef(templateId, modelId, stored);
  if (!stored.connections.some((item) => item.templateId === templateId)) {
    throw new ConfigError("请先配置该服务商");
  }
  return { templateId, modelId };
}

/** 本地接入的启用/切换：状态必须 ready，模型必须在这家 SDK 给的目录里。 */
function validateAgentSdkModelRef(
  templateId: string,
  modelId: string,
  stored: StoredFile,
): ModelRef {
  const record = stored.agentSdks.find((item) => item.templateId === templateId);
  if (!record || record.state !== "ready") {
    throw new ConfigError("请先安装并登录该本地接入");
  }
  const known = record.models?.length
    ? record.models
    : (getProviderTemplate(templateId)?.models ?? []);
  if (known.length > 0 && !known.some((model) => model.id === modelId)) {
    throw new ConfigError("该模型不在本地接入的目录里");
  }
  return { templateId, modelId };
}

/** 丢弃未知模板或非法状态的记录，避免坏数据把设置页卡住。 */
export function validateAgentSdkRecord(value: AgentSdkRecord): AgentSdkRecord | null {
  const templateId = clean(value?.templateId);
  if (!templateId || !getProviderTemplate(templateId)) return null;
  if (!AGENT_SDK_STATES.includes(value?.state)) return null;
  const models = normalizeAgentSdkModels(value?.models);
  return {
    templateId,
    state: value.state,
    ...(clean(value.installedVersion) ? { installedVersion: clean(value.installedVersion) } : {}),
    ...(clean(value.lastError) ? { lastError: clean(value.lastError) } : {}),
    ...(clean(value.accountLabel) ? { accountLabel: clean(value.accountLabel) } : {}),
    ...(models.length ? { models } : {}),
  };
}

/** 本地 SDK 报上来的模型：留 id + 展示名 + credit 倍率，去掉脏数据与重复项。 */
export function normalizeAgentSdkModels(value: unknown): AgentSdkModel[] {
  if (!Array.isArray(value)) return [];
  const out: AgentSdkModel[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as { id?: unknown; name?: unknown; credits?: unknown };
    const id = clean(typeof row.id === "string" ? row.id : "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    // 0 是真实倍率，只挡负数与非数字（负数一定是脏数据）
    const credits = typeof row.credits === "number" && row.credits >= 0 ? row.credits : undefined;
    out.push({
      id,
      name: clean(typeof row.name === "string" ? row.name : "") || id,
      ...(credits === undefined ? {} : { credits }),
    });
    if (out.length >= MAX_AGENT_SDK_MODELS) break;
  }
  return out;
}

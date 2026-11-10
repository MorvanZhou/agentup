import type { ModelConfig } from "../load.js";
import { ConfigError } from "../load.js";
import { toOpenAiCompatRoot } from "../openai-compat-url.js";
import { resolveModelLimits } from "../model-catalog.js";
import { getProviderTemplate, type ProviderTemplate } from "../provider-templates.js";
import { PLACEHOLDER_KEY } from "./constants.js";
import { envOverrides, modelConfigFromEnvOverride } from "./env.js";
import { runtimeApiKey } from "./secrets.js";
import { readStored } from "./store.js";
import type { ModelRef } from "./types.js";
import { modelKey } from "./util.js";
import { validateModelRef } from "./validate.js";

/** 设备级回落：activeModel（最近使用）→ enabled 第一个。会话级解析见 session/model/session-model。 */
export function loadModelConfig(
  userDataRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): ModelConfig {
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

export function loadModelConfigFromRef(
  userDataRoot: string,
  ref: ModelRef,
  env: NodeJS.ProcessEnv = process.env,
): ModelConfig {
  const override = envOverrides(env);
  if (override.model) return modelConfigFromEnvOverride(override);

  const stored = readStored(userDataRoot);
  const model = validateModelRef(ref, stored);
  const template = getProviderTemplate(model.templateId);
  if (!template) throw new ConfigError("未知的服务商");
  // 本地 Agent App 不用填密钥：装好 + 登录即可，状态校验已在 validateModelRef 里做过
  if (template.access === "agent-sdk") return agentSdkModelConfig(userDataRoot, model, template);
  const connectionId = model.connectionId || model.templateId;
  const connection =
    stored.connections.find((item) => item.connectionId === connectionId) ??
    stored.connections.find((item) => item.templateId === model.templateId);
  if (!connection) throw new ConfigError("当前模型所属服务商尚未配置");
  const apiKey = runtimeApiKey(template, connection);
  const limits = resolveModelLimits(userDataRoot, template.id, model.modelId);
  // 模板默认可能带 /chat/completions；运行时只认 OpenAI root，避免再拼一层
  const rawBase = connection.baseUrl || template.defaultBaseUrl || "";
  const baseUrl = rawBase ? toOpenAiCompatRoot(rawBase) : undefined;
  return {
    providerId: template.piProviderId,
    templateId: template.id,
    modelId: model.modelId,
    apiKey,
    baseUrl,
    kind: template.kind,
    // 多端点用 connectionId 区分 profile，避免两条自定义撞同一注册键
    profileId: connection.connectionId,
    contextWindow: limits.contextWindow,
    maxTokens: limits.maxTokens,
  };
}

/** 本地接入的模型配置：没有 baseUrl / apiKey，登录态由各家 CLI 自己管。 */
function agentSdkModelConfig(
  userDataRoot: string,
  model: ModelRef,
  template: ProviderTemplate,
): ModelConfig {
  const limits = resolveModelLimits(userDataRoot, template.id, model.modelId);
  return {
    providerId: template.piProviderId,
    templateId: template.id,
    modelId: model.modelId,
    apiKey: PLACEHOLDER_KEY,
    kind: template.kind,
    profileId: model.connectionId || model.templateId,
    contextWindow: limits.contextWindow,
    maxTokens: limits.maxTokens,
  };
}

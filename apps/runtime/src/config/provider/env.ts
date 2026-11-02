import type { ModelConfig } from "../load.js";
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
  peekTemplateModelLimits,
} from "../model-catalog.js";
import { getProviderTemplate } from "../provider-templates.js";
import { PLACEHOLDER_KEY } from "./constants.js";
import type { EnvOverrides } from "./types.js";
import { clean } from "./util.js";

/** AGENTUP_MODEL_* 环境变量覆盖：CI / 自托管场景下不读本机档案。 */
export function envOverrides(env: NodeJS.ProcessEnv): EnvOverrides {
  return {
    model: clean(env.AGENTUP_MODEL_NAME),
    baseUrl: clean(env.AGENTUP_MODEL_BASE_URL),
    apiKey: clean(env.AGENTUP_MODEL_API_KEY),
    provider: clean(env.AGENTUP_MODEL_PROVIDER),
  };
}

/** 环境变量模式下的模型配置：模板只用来补默认值，找不到模板也能按原样跑。 */
export function modelConfigFromEnvOverride(override: EnvOverrides): ModelConfig {
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

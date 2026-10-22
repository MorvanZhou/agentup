import { ModelRuntime } from "@earendil-works/pi-coding-agent";

import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
} from "../../config/model-catalog.js";
import { getProviderTemplate } from "../../config/provider-templates.js";
import { volcengineArkRegisterConfig } from "../../config/providers/volcengine-ark.js";
import { resolveReasoningProfile } from "../../config/reasoning-profile.js";
import type { SessionPlan } from "../plan.js";

type CredentialStore = NonNullable<Parameters<typeof ModelRuntime.create>[0]>["credentials"] & object;
type Credential = Awaited<ReturnType<CredentialStore["read"]>>;

/** 凭据只留在内存里：不读写 `.runtime/auth.json`，也不碰用户的 `~/.pi/agent`。 */
function memoryCredentials(): CredentialStore {
  const data = new Map<string, NonNullable<Credential>>();
  return {
    async read(providerId) {
      return data.get(providerId);
    },
    async list() {
      return [...data].map(([providerId, credential]) => ({ providerId, type: credential.type }));
    },
    async modify(providerId, fn) {
      const next = await fn(data.get(providerId));
      if (next) data.set(providerId, next);
      return data.get(providerId);
    },
    async delete(providerId) {
      data.delete(providerId);
    },
  };
}

export async function openModelRuntime(plan: SessionPlan) {
  const runtime = await ModelRuntime.create({
    credentials: memoryCredentials(),
    modelsPath: null,
    refreshOnCreate: false,
  });
  const binding = plan.provider;
  const template = getProviderTemplate(binding.templateId);
  if (!template) throw new Error("未知的 Provider 模板");

  if (template.kind === "pi-native" && template.createNative) {
    runtime.registerNativeProvider(template.createNative());
    if (binding.apiKey) await runtime.setRuntimeApiKey(binding.providerId, binding.apiKey);
  } else if (template.kind === "volcengine-ark") {
    runtime.registerProvider(binding.providerId, volcengineArkRegisterConfig(binding.apiKey));
  } else {
    const baseUrl = binding.baseUrl || template.defaultBaseUrl;
    if (!baseUrl) throw new Error("缺少模型服务地址");
    // 自定义 / TokenHub 等：按 modelId 解析推理 profile，使 thinkingLevel 能落到 reasoning_effort 等字段。
    const reasoning = resolveReasoningProfile(binding.modelId, binding.templateId);
    runtime.registerProvider(binding.providerId, {
      name: template.label,
      baseUrl,
      api: template.api ?? "openai-completions",
      apiKey: binding.apiKey || "ollama",
      models: [
        {
          id: binding.modelId,
          name: binding.modelId,
          reasoning: reasoning.reasoning,
          ...(reasoning.thinkingLevelMap ? { thinkingLevelMap: reasoning.thinkingLevelMap } : {}),
          input: ["text", "image"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: binding.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
          maxTokens: binding.maxTokens ?? DEFAULT_MAX_TOKENS,
          compat: {
            supportsDeveloperRole: false,
            supportsReasoningEffort: reasoning.supportsReasoningEffort,
            ...(reasoning.thinkingFormat ? { thinkingFormat: reasoning.thinkingFormat } : {}),
          },
        },
      ],
    });
  }

  const model = runtime.getModel(binding.providerId, binding.modelId);
  if (!model) throw new Error("模型没有注册成功，请检查模型名称是否属于该 Provider");
  return { runtime, model };
}

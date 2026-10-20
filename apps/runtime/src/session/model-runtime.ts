import { ModelRuntime } from "@earendil-works/pi-coding-agent";

import { getProviderTemplate } from "../config/provider-templates.js";
import { volcengineArkRegisterConfig } from "../config/providers/volcengine-ark.js";
import type { SessionPlan } from "./plan.js";

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
    runtime.registerProvider(binding.providerId, {
      name: template.label,
      baseUrl,
      api: template.api ?? "openai-completions",
      apiKey: binding.apiKey || "ollama",
      models: [
        {
          id: binding.modelId,
          name: binding.modelId,
          reasoning: false,
          input: ["text", "image"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128_000,
          maxTokens: 16_384,
          compat: {
            supportsDeveloperRole: false,
            supportsReasoningEffort: false,
          },
        },
      ],
    });
  }

  const model = runtime.getModel(binding.providerId, binding.modelId);
  if (!model) throw new Error("模型没有注册成功，请检查模型名称是否属于该 Provider");
  return { runtime, model };
}

import type { Api, Model } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
} from "../../config/model-catalog.js";
import type { ProviderTemplate } from "../../config/provider-templates.js";
import { getProviderTemplate } from "../../config/provider-templates.js";
import { volcengineArkRegisterConfig } from "../../config/providers/volcengine-ark.js";
import { resolveReasoningProfile } from "../../config/reasoning-profile.js";
import type { SessionPlan, SessionProviderBinding } from "../plan.js";

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
    await registerPiNative(runtime, binding, template);
  } else if (template.kind === "volcengine-ark") {
    registerVolcengineArk(runtime, binding, template);
  } else {
    const baseUrl = binding.baseUrl || template.defaultBaseUrl;
    if (!baseUrl) throw new Error("缺少模型服务地址");
    registerDynamicModel(runtime, binding, template, {
      baseUrl,
      api: template.api ?? "openai-completions",
    });
  }

  const model = runtime.getModel(binding.providerId, binding.modelId);
  if (!model) throw new Error("模型没有注册成功，请检查模型名称是否属于该 Provider");
  return { runtime, model };
}

/** 内置目录有该 id 走 native；手动追加的未知 id 按同端点动态注册。 */
async function registerPiNative(
  runtime: ModelRuntime,
  binding: SessionProviderBinding,
  template: ProviderTemplate,
): Promise<void> {
  const native = template.createNative!();
  const known = native.getModels().find((item) => item.id === binding.modelId);
  if (known) {
    runtime.registerNativeProvider(native);
    if (binding.apiKey) await runtime.setRuntimeApiKey(binding.providerId, binding.apiKey);
    return;
  }
  const prototype = native.getModels()[0] as Model<Api> | undefined;
  const baseUrl = binding.baseUrl || prototype?.baseUrl;
  if (!baseUrl) throw new Error("缺少模型服务地址");
  registerDynamicModel(runtime, binding, template, {
    baseUrl,
    api: prototype?.api ?? template.api ?? "openai-completions",
    thinkingFormat: readThinkingFormat(prototype),
  });
}

function registerVolcengineArk(
  runtime: ModelRuntime,
  binding: SessionProviderBinding,
  template: ProviderTemplate,
): void {
  const config = volcengineArkRegisterConfig(binding.apiKey);
  if (config.models.some((item) => item.id === binding.modelId)) {
    runtime.registerProvider(binding.providerId, config);
    return;
  }
  // 目录外手动 id：勿 push 进窄字面量 models 数组（会炸 tsc）
  registerDynamicModel(runtime, binding, template, {
    baseUrl: config.baseUrl,
    api: config.api,
  });
}

function registerDynamicModel(
  runtime: ModelRuntime,
  binding: SessionProviderBinding,
  template: ProviderTemplate,
  options: { baseUrl: string; api: Api | string; thinkingFormat?: string },
): void {
  const reasoning = resolveReasoningProfile(binding.modelId, binding.templateId);
  const thinkingFormat = reasoning.thinkingFormat ?? options.thinkingFormat;
  runtime.registerProvider(binding.providerId, {
    name: template.label,
    baseUrl: options.baseUrl,
    api: options.api,
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
          ...(thinkingFormat ? { thinkingFormat } : {}),
        },
      },
    ],
  });
}

function readThinkingFormat(model: Model<Api> | undefined): string | undefined {
  const compat = model?.compat as { thinkingFormat?: string } | undefined;
  return typeof compat?.thinkingFormat === "string" ? compat.thinkingFormat : undefined;
}

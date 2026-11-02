import type { Api, Model } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
} from "../../config/model-catalog.js";
import type { ProviderTemplate } from "../../config/provider-templates.js";
import type { Visit } from "../../package/sync.js";
import { getProviderTemplate } from "../../config/provider-templates.js";
import type { McpTool } from "../external/mcp/server.js";
import { volcengineArkRegisterConfig } from "../../config/providers/volcengine-ark.js";
import { resolveReasoningProfile } from "../../config/reasoning-profile.js";
import type { SessionPlan, SessionProviderBinding } from "../plan.js";
import type { WorkspacePolicy } from "../context/workspace-policy.js";
import {
  AGENT_SDK_API,
  createAgentSdkStreamSimple,
  queryExternalAgent,
  type AgentSdkApprovalSink,
  type AgentSdkAskUserSink,
  type AgentSdkStreamContext,
} from "./agent-sdk.js";

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

/** 本地 Agent App 接入需要的东西：装在哪、谁来批工具。 */
export type OpenModelRuntimeOptions = {
  userDataRoot?: string;
  /** 外部 agent 的工具审批走这个通道；不传则一律拒绝。 */
  approvals?: AgentSdkApprovalSink;
  /** 外部 agent 的 AskUserQuestion 走提问通道，并把答案回填给 SDK。 */
  askUser?: AgentSdkAskUserSink;
  userId?: string;
  agentId?: string;
  /** 外部 agent 整回合超时（毫秒），不传用默认。 */
  turnTimeoutMs?: number;
  /** 供外部 agent 拼接上下文（人设 / AGENTS.md / 挂载目录）；不传就只给 cwd。 */
  visit?: Visit;
  workspacePolicy?: WorkspacePolicy;
  groupId?: string;
  groupWorkspaceRoot?: string;
  agentName?: string;
  /** 群执掌花名册（含 agent_id）；SDK append 用。 */
  groupRosterPrompt?: string;
  /** 交给外部 agent 的 MCP 工具（委托协调）；子会话不传。 */
  mcpTools?: McpTool[];
};

export async function openModelRuntime(plan: SessionPlan, options: OpenModelRuntimeOptions = {}) {
  const runtime = await ModelRuntime.create({
    credentials: memoryCredentials(),
    modelsPath: null,
    refreshOnCreate: false,
  });
  const binding = plan.provider;
  const template = getProviderTemplate(binding.templateId);
  if (!template) throw new Error("未知的 Provider 模板");
  let externalContext: AgentSdkStreamContext | undefined;

  if (template.kind === "pi-native" && template.createNative) {
    await registerPiNative(runtime, binding, template);
  } else if (template.kind === "volcengine-ark") {
    registerVolcengineArk(runtime, binding, template);
  } else if (template.kind === "agent-sdk") {
    externalContext = registerAgentSdk(runtime, binding, template, plan, options);
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
  return {
    runtime,
    model,
    ...(externalContext
      ? {
          externalQuery: (prompt: string) => queryExternalAgent(externalContext!, prompt),
        }
      : {}),
  };
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

/**
 * 本地 Agent App：注册一个自定义 api 的 provider，把 `streamSimple` 顶掉，
 * 整个回合交给外部 agent 跑（docs/agent_cli §3.2）。
 * baseUrl 是注册的硬要求，实际不会被用到——我们从不发 HTTP。
 */
function registerAgentSdk(
  runtime: ModelRuntime,
  binding: SessionProviderBinding,
  template: ProviderTemplate,
  plan: SessionPlan,
  options: OpenModelRuntimeOptions,
): AgentSdkStreamContext {
  const userDataRoot = options.userDataRoot;
  if (!userDataRoot) throw new Error("本地 Agent App 接入缺少用户数据目录");
  const reasoning = resolveReasoningProfile(binding.modelId, binding.templateId);
  const context: AgentSdkStreamContext = {
    userDataRoot,
    templateId: binding.templateId,
    providerId: binding.providerId,
    modelId: binding.modelId,
    cwd: plan.cwd,
    ...(options.approvals ? { approvals: options.approvals } : {}),
    ...(options.askUser ? { askUser: options.askUser } : {}),
    ...(options.userId ? { userId: options.userId } : {}),
    ...(options.agentId ? { agentId: options.agentId } : {}),
    ...(options.turnTimeoutMs ? { turnTimeoutMs: options.turnTimeoutMs } : {}),
    ...(options.visit ? { visit: options.visit } : {}),
    ...(options.workspacePolicy ? { workspacePolicy: options.workspacePolicy } : {}),
    ...(options.groupId ? { groupId: options.groupId } : {}),
    ...(options.groupWorkspaceRoot ? { groupWorkspaceRoot: options.groupWorkspaceRoot } : {}),
    ...(options.agentName ? { agentName: options.agentName } : {}),
    ...(options.groupRosterPrompt ? { groupRosterPrompt: options.groupRosterPrompt } : {}),
    ...(options.mcpTools && options.mcpTools.length > 0 ? { mcpTools: options.mcpTools } : {}),
  };
  runtime.registerProvider(binding.providerId, {
    name: template.label,
    baseUrl: "http://127.0.0.1",
    api: AGENT_SDK_API,
    apiKey: binding.apiKey || "ollama",
    streamSimple: createAgentSdkStreamSimple(context),
    models: [
      {
        id: binding.modelId,
        name: binding.modelId,
        reasoning: reasoning.reasoning,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: binding.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
        maxTokens: binding.maxTokens ?? DEFAULT_MAX_TOKENS,
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: reasoning.supportsReasoningEffort,
        },
      },
    ],
  });
  return context;
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

import type { UiLocale } from "../i18n/index.js";
import { readProviderSettings } from "../config/provider/index.js";
import { getProviderTemplate } from "../config/provider-templates.js";
import { peekVisitModelRef } from "../session/model/session-model.js";
import type { UserState } from "./user/state.js";

export function session(value: {
  userId: string;
  email: string;
  nickname: string;
  token: string;
  hasAvatar?: boolean;
  avatarUrl?: string;
}) {
  return {
    user_id: value.userId,
    email: value.email,
    nickname: value.nickname,
    token: value.token,
    has_avatar: value.hasAvatar === true,
    avatar_url: value.avatarUrl ?? null,
  };
}

export function serializeAgentCard(
  agent: {
    agentId: string;
    name: string;
    role: string;
    background: string;
    rules?: string;
    latestVersion: number;
    latestDigest: string;
    recruited: boolean;
    hasAvatar: boolean;
    avatarUrl?: string;
    remark: string;
    recruitCount: number;
    createdAt: string;
    updatedAt: string;
  },
  localVersion: number,
) {
  return {
    agent_id: agent.agentId,
    name: agent.name,
    role: agent.role,
    background: agent.background,
    rules: agent.rules ?? "",
    latest_version: agent.latestVersion,
    latest_digest: agent.latestDigest,
    recruited: agent.recruited,
    local_version: localVersion,
    has_avatar: agent.hasAvatar,
    avatar_url: agent.avatarUrl ?? null,
    remark: agent.remark,
    recruit_count: agent.recruitCount,
    created_at: agent.createdAt,
    updated_at: agent.updatedAt,
  };
}

export function serializeState(state: UserState) {
  return {
    unread: state.unread,
    previews: state.previews,
    last_active_at: state.lastActiveAt,
    command_allow: state.commandAllow,
  };
}

export function providerSettingsBody(settings: ReturnType<typeof readProviderSettings>) {
  return {
    connections: settings.connections.map((connection) => ({
      template_id: connection.templateId,
      base_url: connection.baseUrl,
      api_key_cipher: connection.apiKeyCipher,
      custom_model_ids: connection.customModelIds ?? [],
      discovered_model_ids: connection.discoveredModelIds ?? [],
      has_api_key: connection.hasApiKey,
      pi_provider_id: connection.piProviderId,
      requires_api_key: connection.requiresApiKey,
      vendor_id: connection.vendorId,
      vendor_label: connection.vendorLabel,
      option_label: connection.optionLabel,
      label: connection.label,
    })),
    enabled_models: settings.enabledModels.map((model) => ({
      template_id: model.templateId,
      model_id: model.modelId,
    })),
    active_model: settings.activeModel
      ? { template_id: settings.activeModel.templateId, model_id: settings.activeModel.modelId }
      : null,
    available_models: settings.availableModels.map((model) => ({
      template_id: model.templateId,
      model_id: model.modelId,
      name: model.name,
      vendor_id: model.vendorId,
      vendor_label: model.vendorLabel,
      option_label: model.optionLabel,
      label: model.label,
      enabled: model.enabled,
      active: model.active,
      custom: model.custom,
      credits: model.credits ?? null,
      context_window: model.contextWindow ?? null,
    })),
    configured: settings.configured,
    overridden_by_environment: settings.overriddenByEnvironment,
    vendors: settings.vendors.map((vendor) => ({
      id: vendor.id,
      label: vendor.label,
      options: vendor.options.map((option) => ({
        id: option.id,
        vendor_id: option.vendorId,
        vendor_label: option.vendorLabel,
        option_label: option.optionLabel,
        label: option.label,
        kind: option.kind,
        access: option.access,
        pi_provider_id: option.piProviderId,
        requires_api_key: option.requiresApiKey,
        default_base_url: option.defaultBaseUrl,
        default_model_id: option.defaultModelId,
        hint: option.hint,
        api: option.api,
        supports_model_discovery: option.supportsModelDiscovery,
        models: (option.models ?? []).map((model) => ({
          id: model.id,
          name: model.name,
          api: model.api,
          reasoning: model.reasoning,
        })),
      })),
    })),
    agent_sdks: settings.agentSdks.map((sdk) => ({
      template_id: sdk.templateId,
      vendor_label: sdk.vendorLabel,
      option_label: sdk.optionLabel,
      label: sdk.label,
      hint: sdk.hint ?? null,
      package: sdk.package,
      size_hint_mb: sdk.sizeHintMb,
      login_guide: sdk.loginGuide
        ? { command: sdk.loginGuide.command, doc_url: sdk.loginGuide.docUrl ?? null }
        : null,
      state: sdk.state,
      installed_version: sdk.installedVersion ?? null,
      last_error: sdk.lastError ?? null,
      // 登录账号的展示名；登出后为 null
      account_label: sdk.accountLabel ?? null,
      // 登录后从本地 SDK 查到的模型，「启用服务」列表直接用这份目录
      models: (sdk.models ?? []).map((model) => ({
        id: model.id,
        name: model.name,
        credits: model.credits ?? null,
        context_window: model.contextWindow ?? null,
        max_tokens: model.maxTokens ?? null,
      })),
      // CodeBuddy 站点：模板可选列表 + 本机已选；无声明时两端都省略
      auth_environments: sdk.authEnvironments ?? null,
      auth_environment: sdk.authEnvironment ?? null,
      // 粘贴 Key 文案档（opencode / github-pat / deepseek）；无声明为 null
      api_key_paste: sdk.apiKeyPaste ?? null,
    })),
    templates: settings.templates.map((template) => ({
      id: template.id,
      vendor_id: template.vendorId,
      vendor_label: template.vendorLabel,
      option_label: template.optionLabel,
      label: template.label,
      kind: template.kind,
      access: template.access,
      pi_provider_id: template.piProviderId,
      requires_api_key: template.requiresApiKey,
      default_base_url: template.defaultBaseUrl,
      default_model_id: template.defaultModelId,
      hint: template.hint,
      api: template.api,
      supports_model_discovery: template.supportsModelDiscovery,
      models: (template.models ?? []).map((model) => ({
        id: model.id,
        name: model.name,
        api: model.api,
        reasoning: model.reasoning,
      })),
    })),
  };
}

/** 当前 Visit 会话模型 + enabled 候选（供 Composer 下拉）。 */
export function sessionModelBody(
  userDataRoot: string,
  _cwd: string,
  sessionDir: string,
  locale: UiLocale = "zh",
) {
  const settings = readProviderSettings(userDataRoot, process.env, locale);
  const current = peekVisitModelRef(userDataRoot, sessionDir);
  const enabled = settings.availableModels.filter((model) => model.enabled);
  return {
    current: current
      ? { template_id: current.templateId, model_id: current.modelId }
      : null,
    models: enabled.map((model) => ({
      template_id: model.templateId,
      model_id: model.modelId,
      name: model.name,
      vendor_id: model.vendorId,
      vendor_label: model.vendorLabel,
      option_label: model.optionLabel,
      label: model.label,
      credits: model.credits ?? null,
      context_window: model.contextWindow ?? null,
    })),
    configured: settings.configured,
    // 会话当前模型是不是本地 Agent App（SDK）接入：桌面据此把「回合中发送」改成排队（§12.8）
    follow_up: current ? getProviderTemplate(current.templateId)?.kind === "agent-sdk" : false,
  };
}

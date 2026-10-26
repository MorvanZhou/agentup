import type { UiLocale } from "../i18n/index.js";
import { readProviderSettings } from "../config/provider.js";
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
      vendor_label: model.vendorLabel,
      option_label: model.optionLabel,
      enabled: model.enabled,
      active: model.active,
      custom: model.custom,
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
    templates: settings.templates.map((template) => ({
      id: template.id,
      vendor_id: template.vendorId,
      vendor_label: template.vendorLabel,
      option_label: template.optionLabel,
      label: template.label,
      kind: template.kind,
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
      vendor_label: model.vendorLabel,
      option_label: model.optionLabel,
    })),
    configured: settings.configured,
  };
}

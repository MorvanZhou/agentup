import type {
  AgentCard,
  AvailableProviderModel,
  InvocableSkill,
  PersonalAssistantProfile,
  ProviderConnection,
  ProviderModelRef,
  ProviderSettings,
  ProviderTemplate,
  ProviderVendorGroup,
  SessionModelState,
  UserPreferences,
  UserSkill,
  UserState,
} from "../../model/runtime/runtime";

import { t } from "../../model/ui/ui-locale";

import { DesktopApiError } from "./error";

export function agentListQuery(options?: { userId?: string; q?: string; recruited?: boolean }): string {
  const params = new URLSearchParams();
  if (options?.userId) params.set("user_id", options.userId);
  const q = options?.q?.trim();
  if (q) params.set("q", q.slice(0, 64));
  if (options?.recruited === true) params.set("recruited", "true");
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

export function readAgent(item: unknown): AgentCard {
  if (typeof item !== "object" || item === null) throw new DesktopApiError("Agent 列表无效");
  const agent = item as Record<string, unknown>;
  const background =
    typeof agent.background === "string"
      ? agent.background
      : typeof agent.summary === "string"
        ? agent.summary
        : null;
  if (
    typeof agent.agent_id !== "string" ||
    typeof agent.name !== "string" ||
    background === null ||
    typeof agent.latest_version !== "number" ||
    typeof agent.latest_digest !== "string" ||
    typeof agent.recruited !== "boolean" ||
    typeof agent.has_avatar !== "boolean"
  ) {
    throw new DesktopApiError("Agent 列表无效");
  }
  const localVersion = typeof agent.local_version === "number" && Number.isInteger(agent.local_version) && agent.local_version >= 0
    ? agent.local_version
    : 0;
  const avatarUrl =
    typeof agent.avatar_url === "string" && agent.avatar_url.trim() ? agent.avatar_url : undefined;
  const recruitCount =
    typeof agent.recruit_count === "number" &&
    Number.isInteger(agent.recruit_count) &&
    agent.recruit_count >= 0
      ? agent.recruit_count
      : 0;
  const createdAt = typeof agent.created_at === "string" ? agent.created_at : "";
  const updatedAt = typeof agent.updated_at === "string" ? agent.updated_at : "";
  const remark =
    typeof agent.remark === "string" ? agent.remark.trim().replace(/\s+/g, " ").slice(0, 40) : "";
  const role = typeof agent.role === "string" ? agent.role.trim().replace(/\s+/g, " ").slice(0, 40) : "";
  const kind = agent.kind === "local" ? "local" : agent.kind === "personal" ? "personal" : "recruited";
  const rules = typeof agent.rules === "string" ? agent.rules : undefined;
  const skills =
    Array.isArray(agent.skills) && agent.skills.every((item) => typeof item === "string")
      ? (agent.skills as string[]).map((item) => item.trim()).filter(Boolean)
      : undefined;
  const mcpServers =
    agent.mcp_servers &&
    typeof agent.mcp_servers === "object" &&
    !Array.isArray(agent.mcp_servers)
      ? (agent.mcp_servers as Record<string, unknown>)
      : undefined;
  const publishedAgentId =
    typeof agent.published_agent_id === "string" && agent.published_agent_id.trim()
      ? agent.published_agent_id.trim()
      : undefined;
  return {
    kind,
    agentId: agent.agent_id,
    name: agent.name,
    role,
    background,
    latestVersion: agent.latest_version,
    latestDigest: agent.latest_digest,
    localVersion,
    recruited: agent.recruited,
    hasAvatar: agent.has_avatar,
    remark: agent.recruited ? remark : "",
    recruitCount,
    createdAt,
    updatedAt,
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(rules ? { rules } : {}),
    ...(skills ? { skills } : {}),
    ...(mcpServers ? { mcpServers } : {}),
    ...(publishedAgentId ? { publishedAgentId } : {}),
  };
}

export function readPersonalAssistantProfile(payload: Record<string, unknown>): PersonalAssistantProfile {
  if (
    typeof payload.name !== "string" ||
    typeof payload.role !== "string" ||
    typeof payload.background !== "string" ||
    (payload.avatar_url !== null && payload.avatar_url !== undefined && typeof payload.avatar_url !== "string")
  ) {
    throw new DesktopApiError(t("assistantProfileInvalid"));
  }
  return {
    name: payload.name,
    role: payload.role,
    background: payload.background,
    ...(typeof payload.avatar_url === "string" && payload.avatar_url ? { avatarUrl: payload.avatar_url } : {}),
  };
}

export function readUserState(payload: Record<string, unknown>): UserState {
  if (!payload.unread || typeof payload.unread !== "object" || Array.isArray(payload.unread)) {
    throw new DesktopApiError("本机状态无效");
  }
  const unread: Record<string, number> = {};
  for (const [agentId, count] of Object.entries(payload.unread as Record<string, unknown>)) {
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
      throw new DesktopApiError("本机状态无效");
    }
    if (count > 0) unread[agentId] = count;
  }
  if (!payload.previews || typeof payload.previews !== "object" || Array.isArray(payload.previews)) {
    throw new DesktopApiError("本机状态无效");
  }
  const previews: Record<string, string> = {};
  for (const [agentId, text] of Object.entries(payload.previews as Record<string, unknown>)) {
    if (typeof text !== "string") throw new DesktopApiError("本机状态无效");
    const clipped = text.trim();
    if (clipped) previews[agentId] = clipped;
  }
  if (
    !payload.last_active_at ||
    typeof payload.last_active_at !== "object" ||
    Array.isArray(payload.last_active_at)
  ) {
    throw new DesktopApiError("本机状态无效");
  }
  const lastActiveAt: Record<string, number> = {};
  for (const [agentId, at] of Object.entries(payload.last_active_at as Record<string, unknown>)) {
    if (typeof at !== "number" || !Number.isFinite(at) || !Number.isInteger(at) || at < 0) {
      throw new DesktopApiError("本机状态无效");
    }
    if (at > 0) lastActiveAt[agentId] = at;
  }
  if (
    !payload.command_allow ||
    typeof payload.command_allow !== "object" ||
    Array.isArray(payload.command_allow)
  ) {
    throw new DesktopApiError("本机状态无效");
  }
  const commandAllowRaw = payload.command_allow;
  const commandAllow: UserState["commandAllow"] = {};
  for (const [agentId, scope] of Object.entries(commandAllowRaw as Record<string, unknown>)) {
    if (scope !== "session" && scope !== "agent") throw new DesktopApiError("本机状态无效");
    commandAllow[agentId] = scope;
  }
  return { unread, previews, lastActiveAt, commandAllow };
}

export function readSessionModelState(payload: Record<string, unknown>): SessionModelState {
  if (
    (payload.current !== null &&
      (typeof payload.current !== "object" || Array.isArray(payload.current))) ||
    !Array.isArray(payload.models) ||
    typeof payload.configured !== "boolean"
  ) {
    throw new DesktopApiError("会话模型响应无效");
  }
  return {
    current: payload.current ? readProviderModelRef(payload.current) : null,
    models: payload.models.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new DesktopApiError("会话模型响应无效");
      }
      const row = item as Record<string, unknown>;
      if (
        typeof row.template_id !== "string" ||
        typeof row.model_id !== "string" ||
        typeof row.name !== "string" ||
        typeof row.vendor_label !== "string" ||
        typeof row.option_label !== "string"
      ) {
        throw new DesktopApiError("会话模型响应无效");
      }
      return {
        templateId: row.template_id,
        modelId: row.model_id,
        name: row.name,
        vendorLabel: row.vendor_label,
        optionLabel: row.option_label,
      };
    }),
    configured: payload.configured,
  };
}

export function readProviderSettings(payload: Record<string, unknown>): ProviderSettings {
  if (
    !Array.isArray(payload.connections) ||
    !Array.isArray(payload.enabled_models) ||
    (payload.active_model !== null &&
      (typeof payload.active_model !== "object" || Array.isArray(payload.active_model))) ||
    !Array.isArray(payload.available_models) ||
    typeof payload.configured !== "boolean" ||
    typeof payload.overridden_by_environment !== "boolean" ||
    !Array.isArray(payload.vendors) ||
    !Array.isArray(payload.templates)
  ) {
    throw new DesktopApiError("AI 服务配置响应无效");
  }
  return {
    connections: payload.connections.map(readProviderConnection),
    enabledModels: payload.enabled_models.map(readProviderModelRef),
    activeModel: payload.active_model ? readProviderModelRef(payload.active_model) : null,
    availableModels: payload.available_models.map(readAvailableProviderModel),
    configured: payload.configured,
    overriddenByEnvironment: payload.overridden_by_environment,
    vendors: payload.vendors.map(readProviderVendor),
    templates: payload.templates.map(readProviderTemplate),
  };
}

function readProviderModelRef(value: unknown): ProviderModelRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DesktopApiError("AI 服务模型无效");
  }
  const payload = value as Record<string, unknown>;
  if (typeof payload.template_id !== "string" || typeof payload.model_id !== "string") {
    throw new DesktopApiError("AI 服务模型无效");
  }
  return { templateId: payload.template_id, modelId: payload.model_id };
}

function readProviderConnection(value: unknown): ProviderConnection {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DesktopApiError("AI 服务连接无效");
  }
  const payload = value as Record<string, unknown>;
  if (
    typeof payload.template_id !== "string" ||
    typeof payload.has_api_key !== "boolean" ||
    typeof payload.pi_provider_id !== "string" ||
    typeof payload.requires_api_key !== "boolean" ||
    typeof payload.vendor_id !== "string" ||
    typeof payload.vendor_label !== "string" ||
    typeof payload.option_label !== "string" ||
    typeof payload.label !== "string" ||
    !Array.isArray(payload.custom_model_ids) ||
    !Array.isArray(payload.discovered_model_ids)
  ) {
    throw new DesktopApiError("AI 服务连接无效");
  }
  return {
    templateId: payload.template_id,
    baseUrl: typeof payload.base_url === "string" ? payload.base_url : undefined,
    apiKeyCipher: typeof payload.api_key_cipher === "string" ? payload.api_key_cipher : undefined,
    customModelIds: payload.custom_model_ids.filter((item): item is string => typeof item === "string"),
    discoveredModelIds: payload.discovered_model_ids.filter(
      (item): item is string => typeof item === "string",
    ),
    hasApiKey: payload.has_api_key,
    piProviderId: payload.pi_provider_id,
    requiresApiKey: payload.requires_api_key,
    vendorId: payload.vendor_id,
    vendorLabel: payload.vendor_label,
    optionLabel: payload.option_label,
    label: payload.label,
  };
}

function readAvailableProviderModel(value: unknown): AvailableProviderModel {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DesktopApiError("可用模型无效");
  }
  const payload = value as Record<string, unknown>;
  if (
    typeof payload.template_id !== "string" ||
    typeof payload.model_id !== "string" ||
    typeof payload.name !== "string" ||
    typeof payload.vendor_label !== "string" ||
    typeof payload.option_label !== "string" ||
    typeof payload.enabled !== "boolean" ||
    typeof payload.active !== "boolean"
  ) {
    throw new DesktopApiError("可用模型无效");
  }
  return {
    templateId: payload.template_id,
    modelId: payload.model_id,
    name: payload.name,
    vendorLabel: payload.vendor_label,
    optionLabel: payload.option_label,
    enabled: payload.enabled,
    active: payload.active,
    custom: payload.custom === true,
  };
}

function readProviderVendor(value: unknown): ProviderVendorGroup {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DesktopApiError("服务商分组无效");
  }
  const payload = value as Record<string, unknown>;
  if (typeof payload.id !== "string" || typeof payload.label !== "string" || !Array.isArray(payload.options)) {
    throw new DesktopApiError("服务商分组无效");
  }
  return {
    id: payload.id,
    label: payload.label,
    options: payload.options.map(readProviderTemplate),
  };
}

function readProviderTemplate(value: unknown): ProviderTemplate {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DesktopApiError("AI 服务模板无效");
  }
  const payload = value as Record<string, unknown>;
  if (
    typeof payload.id !== "string" ||
    typeof payload.vendor_id !== "string" ||
    typeof payload.vendor_label !== "string" ||
    typeof payload.option_label !== "string" ||
    typeof payload.label !== "string" ||
    typeof payload.kind !== "string" ||
    typeof payload.pi_provider_id !== "string" ||
    typeof payload.requires_api_key !== "boolean" ||
    typeof payload.supports_model_discovery !== "boolean" ||
    !Array.isArray(payload.models)
  ) {
    throw new DesktopApiError("AI 服务模板无效");
  }
  return {
    id: payload.id,
    vendorId: payload.vendor_id,
    vendorLabel: payload.vendor_label,
    optionLabel: payload.option_label,
    label: payload.label,
    kind: payload.kind,
    piProviderId: payload.pi_provider_id,
    requiresApiKey: payload.requires_api_key,
    defaultBaseUrl: typeof payload.default_base_url === "string" ? payload.default_base_url : undefined,
    defaultModelId: typeof payload.default_model_id === "string" ? payload.default_model_id : undefined,
    hint: typeof payload.hint === "string" ? payload.hint : undefined,
    api: typeof payload.api === "string" ? payload.api : undefined,
    supportsModelDiscovery: payload.supports_model_discovery,
    models: payload.models.map((model) => {
      if (!model || typeof model !== "object" || Array.isArray(model)) {
        throw new DesktopApiError("AI 服务模板无效");
      }
      const entry = model as Record<string, unknown>;
      if (
        typeof entry.id !== "string" ||
        typeof entry.name !== "string" ||
        typeof entry.api !== "string" ||
        typeof entry.reasoning !== "boolean"
      ) {
        throw new DesktopApiError("AI 服务模板无效");
      }
      return { id: entry.id, name: entry.name, api: entry.api, reasoning: entry.reasoning };
    }),
  };
}

export function readPreferences(payload: Record<string, unknown>): UserPreferences {
  const mode = payload.theme_mode;
  if (mode !== "system" && mode !== "light" && mode !== "dark") {
    throw new DesktopApiError("偏好响应无效");
  }
  if (typeof payload.skip_edit_resend_confirm !== "boolean") {
    throw new DesktopApiError("偏好响应无效");
  }
  const uiLocale = payload.ui_locale === "en" ? "en" : "zh";
  return { themeMode: mode, skipEditResendConfirm: payload.skip_edit_resend_confirm, uiLocale };
}

export function readUserSkill(item: unknown): UserSkill {
  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    throw new DesktopApiError("技能无效");
  }
  const skill = item as Record<string, unknown>;
  if (
    typeof skill.name !== "string" ||
    typeof skill.description !== "string" ||
    typeof skill.enabled !== "boolean"
  ) {
    throw new DesktopApiError("技能无效");
  }
  return { name: skill.name, description: skill.description, enabled: skill.enabled };
}

export function readInvocableSkill(item: unknown): InvocableSkill {
  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    throw new DesktopApiError("技能无效");
  }
  const skill = item as Record<string, unknown>;
  if (typeof skill.name !== "string" || typeof skill.description !== "string") {
    throw new DesktopApiError("技能无效");
  }
  return { name: skill.name, description: skill.description };
}

export function readAgentsMdContent(item: unknown): string {
  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    throw new DesktopApiError("AGENTS.md 无效");
  }
  const record = item as Record<string, unknown>;
  if (typeof record.content !== "string") throw new DesktopApiError("AGENTS.md 无效");
  return record.content;
}

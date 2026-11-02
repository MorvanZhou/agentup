import type {
  PersonalAssistantProfile,
  PreferencesUpdate,
  ProviderModelRef,
  ProviderSettings,
  UiLocale,
  UserPreferences,
  UserSkill,
} from "../../model/runtime/runtime";

import { DesktopApiError } from "./error";
import type { RuntimeHttp } from "./http";
import {
  readAgentsMdContent,
  readPersonalAssistantProfile,
  readPreferences,
  readProviderSettings,
  readUserSkill,
} from "./readers";

function withLang(path: string, locale?: UiLocale): string {
  if (!locale) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}lang=${encodeURIComponent(locale)}`;
}

function providerPath(path: string, locale?: UiLocale): string {
  return withLang(path, locale);
}

export async function personalAssistantProfile(
  http: RuntimeHttp,
  token: string,
  userId: string,
  locale?: UiLocale,
): Promise<PersonalAssistantProfile> {
  return readPersonalAssistantProfile(
    await http.request(
      withLang(`/personal-assistant/profile?user_id=${encodeURIComponent(userId)}`, locale),
      token,
    ),
  );
}

export async function savePersonalAssistantProfile(
  http: RuntimeHttp,
  token: string,
  userId: string,
  profile: { name: string; role: string; background: string; avatarDataUrl?: string },
  locale?: UiLocale,
): Promise<PersonalAssistantProfile> {
  return readPersonalAssistantProfile(
    await http.request(
      withLang("/personal-assistant/profile", locale),
      token,
      {
        user_id: userId,
        name: profile.name,
        role: profile.role,
        background: profile.background,
        ...(profile.avatarDataUrl ? { avatar_data_url: profile.avatarDataUrl } : {}),
      },
      "PUT",
    ),
  );
}

export async function providerSettings(
  http: RuntimeHttp,
  token: string,
  locale?: UiLocale,
): Promise<ProviderSettings> {
  return readProviderSettings(await http.request(providerPath("/settings/provider", locale), token));
}

export async function upsertProviderConnection(
  http: RuntimeHttp,
  token: string,
  connection: {
    templateId: string;
    baseUrl?: string;
    apiKeyCipher?: string;
    clearApiKey?: boolean;
    customModelId?: string;
  },
  locale?: UiLocale,
): Promise<ProviderSettings> {
  return readProviderSettings(
    await http.request(providerPath("/settings/provider/connections", locale), token, {
      template_id: connection.templateId,
      ...(connection.baseUrl ? { base_url: connection.baseUrl } : {}),
      ...(connection.apiKeyCipher ? { api_key_cipher: connection.apiKeyCipher } : {}),
      ...(connection.clearApiKey ? { clear_api_key: true } : {}),
      ...(connection.customModelId ? { custom_model_id: connection.customModelId } : {}),
    }),
  );
}

export async function deleteProviderConnection(
  http: RuntimeHttp,
  token: string,
  templateId: string,
  locale?: UiLocale,
): Promise<ProviderSettings> {
  return readProviderSettings(
    await http.request(
      providerPath(`/settings/provider/connections/${encodeURIComponent(templateId)}`, locale),
      token,
      undefined,
      "DELETE",
    ),
  );
}

export async function refreshProviderModels(
  http: RuntimeHttp,
  token: string,
  templateId: string,
  locale?: UiLocale,
): Promise<ProviderSettings> {
  return readProviderSettings(
    await http.request(
      providerPath(
        `/settings/provider/connections/${encodeURIComponent(templateId)}/refresh-models`,
        locale,
      ),
      token,
      {},
    ),
  );
}

export async function removeCustomProviderModel(
  http: RuntimeHttp,
  token: string,
  ref: ProviderModelRef,
  locale?: UiLocale,
): Promise<ProviderSettings> {
  return readProviderSettings(
    await http.request(
      providerPath(
        `/settings/provider/connections/${encodeURIComponent(ref.templateId)}/custom-models/${encodeURIComponent(ref.modelId)}`,
        locale,
      ),
      token,
      undefined,
      "DELETE",
    ),
  );
}

export async function setProviderModelEnabled(
  http: RuntimeHttp,
  token: string,
  ref: ProviderModelRef,
  enabled: boolean,
  locale?: UiLocale,
): Promise<ProviderSettings> {
  return readProviderSettings(
    await http.request(providerPath("/settings/provider/models/enabled", locale), token, {
      template_id: ref.templateId,
      model_id: ref.modelId,
      enabled,
    }),
  );
}

export async function setProviderActiveModel(
  http: RuntimeHttp,
  token: string,
  ref: ProviderModelRef,
  locale?: UiLocale,
): Promise<ProviderSettings> {
  return readProviderSettings(
    await http.request(providerPath("/settings/provider/models/active", locale), token, {
      template_id: ref.templateId,
      model_id: ref.modelId,
    }),
  );
}

export async function hydrateProviderRuntimeSecrets(
  http: RuntimeHttp,
  token: string,
  secrets: Record<string, string>,
): Promise<void> {
  await http.request("/settings/provider/runtime-secrets", token, { secrets }, "PUT");
}

/** CLI / SDK 接入：安装 / 登录 / 卸载（阶段 1） */

export interface AgentSdkInstallJob {
  jobId: string;
  templateId: string;
  phase: string;
  detail?: string;
  error?: string;
}

export interface AgentSdkLoginResult {
  authUrl: string | null;
  state: "logging_in" | "ready" | "not_logged_in";
  accountLabel?: string;
}

export async function installAgentSdk(
  http: RuntimeHttp,
  token: string,
  templateId: string,
): Promise<string> {
  const payload = await http.request(
    `/settings/provider/agents/${encodeURIComponent(templateId)}/install`,
    token,
    {},
  );
  const jobId = (payload as { job_id?: unknown }).job_id;
  if (typeof jobId !== "string") throw new DesktopApiError("本地接入安装启动失败");
  return jobId;
}

export async function agentSdkInstallJob(
  http: RuntimeHttp,
  token: string,
  templateId: string,
  jobId: string,
): Promise<AgentSdkInstallJob> {
  const payload = (await http.request(
    `/settings/provider/agents/${encodeURIComponent(templateId)}/install/${encodeURIComponent(jobId)}`,
    token,
  )) as { job_id?: unknown; template_id?: unknown; phase?: unknown; detail?: unknown; error?: unknown };
  return {
    jobId: typeof payload.job_id === "string" ? payload.job_id : "",
    templateId: typeof payload.template_id === "string" ? payload.template_id : templateId,
    phase: typeof payload.phase === "string" ? payload.phase : "failed",
    ...(typeof payload.detail === "string" ? { detail: payload.detail } : {}),
    ...(typeof payload.error === "string" ? { error: payload.error } : {}),
  };
}

export async function cancelAgentSdkInstall(
  http: RuntimeHttp,
  token: string,
  templateId: string,
  jobId: string,
): Promise<ProviderSettings> {
  return readProviderSettings(
    await http.request(
      `/settings/provider/agents/${encodeURIComponent(templateId)}/install/${encodeURIComponent(jobId)}/cancel`,
      token,
      {},
    ),
  );
}

export async function loginAgentSdk(
  http: RuntimeHttp,
  token: string,
  templateId: string,
): Promise<AgentSdkLoginResult> {
  const payload = (await http.request(
    `/settings/provider/agents/${encodeURIComponent(templateId)}/login`,
    token,
    {},
  )) as { auth_url?: unknown; state?: unknown; account_label?: unknown };
  return {
    authUrl: typeof payload.auth_url === "string" ? payload.auth_url : null,
    state:
      payload.state === "ready" || payload.state === "logging_in" ? payload.state : "not_logged_in",
    ...(typeof payload.account_label === "string" ? { accountLabel: payload.account_label } : {}),
  };
}

export async function checkAgentSdkLogin(
  http: RuntimeHttp,
  token: string,
  templateId: string,
): Promise<AgentSdkLoginResult> {
  const payload = (await http.request(
    `/settings/provider/agents/${encodeURIComponent(templateId)}/login-check`,
    token,
    {},
  )) as { auth_url?: unknown; state?: unknown; account_label?: unknown };
  return {
    authUrl: typeof payload.auth_url === "string" ? payload.auth_url : null,
    state:
      payload.state === "ready" || payload.state === "logging_in" ? payload.state : "not_logged_in",
    ...(typeof payload.account_label === "string" ? { accountLabel: payload.account_label } : {}),
  };
}

/** 登出：token 在 CLI 手里，runtime 代调 logout 后回整份设置（状态与模型目录都会变） */
export async function logoutAgentSdk(
  http: RuntimeHttp,
  token: string,
  templateId: string,
  locale?: UiLocale,
): Promise<ProviderSettings> {
  return readProviderSettings(
    await http.request(
      providerPath(`/settings/provider/agents/${encodeURIComponent(templateId)}/logout`, locale),
      token,
      {},
    ),
  );
}

/** 本地接入的模型目录：只能问本机 SDK，服务端不知道这家订阅能用什么 */
export async function refreshAgentSdkModels(
  http: RuntimeHttp,
  token: string,
  templateId: string,
  locale?: UiLocale,
): Promise<ProviderSettings> {
  return readProviderSettings(
    await http.request(
      providerPath(`/settings/provider/agents/${encodeURIComponent(templateId)}/models`, locale),
      token,
      {},
    ),
  );
}

export async function uninstallAgentSdk(
  http: RuntimeHttp,
  token: string,
  templateId: string,
  locale?: UiLocale,
): Promise<ProviderSettings> {
  return readProviderSettings(
    await http.request(
      providerPath(`/settings/provider/agents/${encodeURIComponent(templateId)}`, locale),
      token,
      undefined,
      "DELETE",
    ),
  );
}

export async function preferences(http: RuntimeHttp, token: string): Promise<UserPreferences> {
  return readPreferences(await http.request("/preferences", token));
}

export async function savePreferences(
  http: RuntimeHttp,
  token: string,
  update: PreferencesUpdate,
): Promise<UserPreferences> {
  const body: Record<string, unknown> = {};
  if (update.themeMode !== undefined) body.theme_mode = update.themeMode;
  if (update.skipEditResendConfirm !== undefined) {
    body.skip_edit_resend_confirm = update.skipEditResendConfirm;
  }
  if (update.uiLocale !== undefined) body.ui_locale = update.uiLocale;
  return readPreferences(await http.request("/preferences", token, body, "PUT"));
}

export async function userSkills(
  http: RuntimeHttp,
  token: string,
  userId: string,
): Promise<UserSkill[]> {
  const payload = await http.request(
    `/settings/skills?user_id=${encodeURIComponent(userId)}`,
    token,
  );
  if (!Array.isArray(payload.skills)) throw new DesktopApiError("技能列表无效");
  return payload.skills.map(readUserSkill);
}

export async function installUserSkill(
  http: RuntimeHttp,
  token: string,
  userId: string,
  packagePath: string,
  expectName?: string,
): Promise<UserSkill> {
  return readUserSkill(
    await http.request("/settings/skills/install", token, {
      user_id: userId,
      path: packagePath,
      ...(expectName ? { expect_name: expectName } : {}),
    }),
  );
}

export async function setUserSkillEnabled(
  http: RuntimeHttp,
  token: string,
  userId: string,
  name: string,
  enabled: boolean,
): Promise<UserSkill> {
  return readUserSkill(
    await http.request(
      `/settings/skills/${encodeURIComponent(name)}/enabled`,
      token,
      { user_id: userId, enabled },
      "PUT",
    ),
  );
}

export async function deleteUserSkill(
  http: RuntimeHttp,
  token: string,
  userId: string,
  name: string,
): Promise<void> {
  await http.request(
    `/settings/skills/${encodeURIComponent(name)}?user_id=${encodeURIComponent(userId)}`,
    token,
    undefined,
    "DELETE",
  );
}

export async function userMcp(
  http: RuntimeHttp,
  token: string,
  userId: string,
): Promise<Record<string, unknown>> {
  const payload = await http.request(
    `/settings/mcp?user_id=${encodeURIComponent(userId)}`,
    token,
  );
  if (!payload.mcp_servers || typeof payload.mcp_servers !== "object" || Array.isArray(payload.mcp_servers)) {
    throw new DesktopApiError("MCP 配置无效");
  }
  return payload.mcp_servers as Record<string, unknown>;
}

export async function saveUserMcp(
  http: RuntimeHttp,
  token: string,
  userId: string,
  mcpServers: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const payload = await http.request(
    "/settings/mcp",
    token,
    { user_id: userId, mcp_servers: mcpServers },
    "PUT",
  );
  if (!payload.mcp_servers || typeof payload.mcp_servers !== "object" || Array.isArray(payload.mcp_servers)) {
    throw new DesktopApiError("MCP 配置无效");
  }
  return payload.mcp_servers as Record<string, unknown>;
}

export async function userAgentsMd(
  http: RuntimeHttp,
  token: string,
  userId: string,
): Promise<string> {
  return readAgentsMdContent(
    await http.request(`/settings/agents-md?user_id=${encodeURIComponent(userId)}`, token),
  );
}

export async function saveUserAgentsMd(
  http: RuntimeHttp,
  token: string,
  userId: string,
  content: string,
): Promise<string> {
  return readAgentsMdContent(
    await http.request(`/settings/agents-md`, token, { user_id: userId, content }, "PUT"),
  );
}

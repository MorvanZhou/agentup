import { ConfigError } from "../../../../../config/load.js";
import { getProviderTemplate } from "../../../../../config/provider-templates.js";
import {
  agentSdkModels,
  setAgentSdkAccountLabel,
  setAgentSdkModels,
  setAgentSdkState,
} from "../../../../../config/provider/index.js";
import {
  agentSdkDir,
  readInstalledSdk,
} from "../../../../../config/providers/agent-sdk/installer.js";
import type { ExternalModel } from "../../contract.js";
import {
  clearClaudeApiKey,
  ensureClaudeHome,
  hasClaudeApiKey,
  readClaudeAccountLabel,
  readClaudeApiKey,
  writeClaudeApiKey,
} from "./home.js";
import {
  MODEL_CATALOG_UNAVAILABLE,
  throwModelCatalogUnavailable,
} from "../../../../../config/provider/model-list-policy.js";
import { listAnthropicModelsViaApi } from "./models-api.js";

/**
 * Claude Code（Agent SDK）登录 / 登出 / 探测 / 列模型。
 *
 * 第三方产品不得提供 claude.ai 订阅登录（官方 Quickstart NOTE）→
 * 开始登录 → auth_url + needs_api_key（Desktop 不自动开浏览器，粘贴框前手动开）；
 * 粘贴后写入隔离 CLAUDE_CONFIG_DIR home。
 *
 * 列模型：只认 Anthropic Models API 活目录（统一 model-list-policy）。
 */

/** Console API Keys 页；测例锁定，改版须重审。 */
export const CLAUDE_API_KEY_PAGE = "https://console.anthropic.com/settings/keys";

/** @deprecated 用 MODEL_CATALOG_UNAVAILABLE；保留别名给旧测例。 */
export const CLAUDE_MODELS_UNAVAILABLE = MODEL_CATALOG_UNAVAILABLE;

export interface LoginResult {
  auth_url: string | null;
  state: "logging_in" | "ready" | "not_logged_in";
  account_label?: string;
  /** Key 回落：设置页展示粘贴框并调 submitClaudeApiKey */
  needs_api_key?: boolean;
}

export async function startClaudeLogin(
  userDataRoot: string,
  templateId: string,
): Promise<LoginResult> {
  const template = getProviderTemplate(templateId);
  const installed = template?.agentSdk
    ? readInstalledSdk(agentSdkDir(userDataRoot, templateId), template.agentSdk.package)
    : null;
  if (!installed) throw new ConfigError("尚未接入，请先开始接入");

  if (hasClaudeApiKey(userDataRoot, templateId)) {
    return readyResult(userDataRoot, templateId);
  }

  ensureClaudeHome(userDataRoot, templateId);
  setAgentSdkState(userDataRoot, templateId, "logging_in");
  return {
    auth_url: CLAUDE_API_KEY_PAGE,
    state: "logging_in",
    needs_api_key: true,
  };
}

export async function checkClaudeLogin(
  userDataRoot: string,
  templateId: string,
): Promise<LoginResult> {
  if (hasClaudeApiKey(userDataRoot, templateId)) {
    return readyResult(userDataRoot, templateId);
  }
  setAgentSdkState(userDataRoot, templateId, "not_logged_in");
  return { auth_url: null, state: "not_logged_in" };
}

/** 粘贴 Anthropic Console API Key；写入隔离 home，并尽量拉活模型目录。 */
export async function submitClaudeApiKey(
  userDataRoot: string,
  templateId: string,
  apiKey: string,
): Promise<LoginResult> {
  const value = apiKey.trim();
  if (!value) throw new ConfigError("请输入 Anthropic API Key");

  const template = getProviderTemplate(templateId);
  if (!template?.agentSdk) throw new ConfigError("该接入方式不支持本地调用");
  if (!readInstalledSdk(agentSdkDir(userDataRoot, templateId), template.agentSdk.package)) {
    throw new ConfigError("尚未接入，请先开始接入");
  }

  if (value.length < 12) {
    throw new ConfigError("Anthropic API Key 看起来太短，请检查后重试");
  }

  writeClaudeApiKey(userDataRoot, templateId, value, "Claude");
  // 登录成功仍 ready；目录失败 → 清空（勿写假 FALLBACK），设置页会提示刷新/手动配置
  try {
    await refreshClaudeModels(userDataRoot, templateId);
  } catch {
    setAgentSdkModels(userDataRoot, templateId, []);
  }
  return readyResult(userDataRoot, templateId, { skipEnsure: true });
}

export async function logoutClaude(userDataRoot: string, templateId: string): Promise<void> {
  clearClaudeApiKey(userDataRoot, templateId);
  setAgentSdkState(userDataRoot, templateId, "not_logged_in");
  setAgentSdkModels(userDataRoot, templateId, []);
  setAgentSdkAccountLabel(userDataRoot, templateId, null);
}

/**
 * 只返回 Models API 活目录。失败或空列表 → 抛错，**不**回落假别名。
 * refresh 抛错时不改写已有目录（由调用方决定）；submit 失败会主动清空。
 */
export async function fetchClaudeModels(
  userDataRoot: string,
  templateId: string,
): Promise<ExternalModel[]> {
  const apiKey = readClaudeApiKey(userDataRoot, templateId);
  if (!apiKey) throw new ConfigError("尚未登录 Claude Code（请先粘贴 API Key）");

  let listed: ExternalModel[] = [];
  try {
    listed = await listAnthropicModelsViaApi(apiKey);
  } catch (error) {
    // 保留上游状态码片段，便于对照 curl；仍走统一「无法获取」前缀
    const detail = error instanceof Error ? error.message.trim() : "";
    if (detail.startsWith("Anthropic models API")) {
      throw new ConfigError(
        `暂时无法获取可用模型列表，请重新拉取，或手动配置（${detail}）`,
      );
    }
    throwModelCatalogUnavailable();
  }
  if (listed.length === 0) throwModelCatalogUnavailable();
  return listed;
}

export async function refreshClaudeModels(
  userDataRoot: string,
  templateId: string,
): Promise<ExternalModel[]> {
  const models = await fetchClaudeModels(userDataRoot, templateId);
  setAgentSdkModels(userDataRoot, templateId, models);
  return models;
}

export async function ensureClaudeModels(
  userDataRoot: string,
  templateId: string,
): Promise<void> {
  // 已有活目录则跳过；空目录再试一次（失败保持空，不写假列表）
  if (agentSdkModels(userDataRoot, templateId).length > 0) return;
  await refreshClaudeModels(userDataRoot, templateId).catch(() => undefined);
}

function readyResult(
  userDataRoot: string,
  templateId: string,
  options: { skipEnsure?: boolean } = {},
): LoginResult {
  const label = readClaudeAccountLabel(userDataRoot, templateId) ?? "Claude";
  setAgentSdkState(userDataRoot, templateId, "ready");
  setAgentSdkAccountLabel(userDataRoot, templateId, label);
  if (!options.skipEnsure) void ensureClaudeModels(userDataRoot, templateId);
  return {
    auth_url: null,
    state: "ready",
    account_label: label,
  };
}

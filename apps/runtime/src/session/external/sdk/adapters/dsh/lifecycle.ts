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
  clearDshApiKey,
  ensureDshHome,
  hasDshApiKey,
  readDshAccountLabel,
  writeDshApiKey,
} from "./home.js";

/**
 * DeepSeek Harness 登录 / 登出 / 探测 / 列模型。
 *
 * 无 OAuth：开始登录 → 打开平台 API Keys 页 + needs_api_key；
 * 粘贴后写入隔离 home，列模型走显式 FALLBACK（公开 SDK 无 models.list）。
 */

/** 平台 API Key 页；测例锁定，改版须重审。 */
export const DSH_API_KEY_PAGE = "https://platform.deepseek.com/api_keys";

/**
 * 公开 SDK 无 models.list → 显式 FALLBACK。
 * 对齐官方 llm-deepseek 默认目录（V4.1 Flash + V4 Pro）；
 * 旧 id `deepseek-v4-flash` 已退休，仅作兼容别名，勿再当默认。
 * @see https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/llm/llm-deepseek/README.md
 */
const FALLBACK_MODELS: ExternalModel[] = [
  { id: "deepseek-flash", name: "DeepSeek V4.1 Flash" },
  { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
];

export interface LoginResult {
  auth_url: string | null;
  state: "logging_in" | "ready" | "not_logged_in";
  account_label?: string;
  /** Key 回落：设置页展示粘贴框并调 submitDshApiKey */
  needs_api_key?: boolean;
}

export async function startDshLogin(
  userDataRoot: string,
  templateId: string,
): Promise<LoginResult> {
  const template = getProviderTemplate(templateId);
  const installed = template?.agentSdk
    ? readInstalledSdk(agentSdkDir(userDataRoot, templateId), template.agentSdk.package)
    : null;
  if (!installed) throw new ConfigError("尚未接入，请先开始接入");

  if (hasDshApiKey(userDataRoot, templateId)) {
    return readyResult(userDataRoot, templateId);
  }

  ensureDshHome(userDataRoot, templateId);
  setAgentSdkState(userDataRoot, templateId, "logging_in");
  return {
    auth_url: DSH_API_KEY_PAGE,
    state: "logging_in",
    needs_api_key: true,
  };
}

export async function checkDshLogin(
  userDataRoot: string,
  templateId: string,
): Promise<LoginResult> {
  if (hasDshApiKey(userDataRoot, templateId)) {
    return readyResult(userDataRoot, templateId);
  }
  setAgentSdkState(userDataRoot, templateId, "not_logged_in");
  return { auth_url: null, state: "not_logged_in" };
}

/** 粘贴 DeepSeek 平台 API Key；写入隔离 home。 */
export async function submitDshApiKey(
  userDataRoot: string,
  templateId: string,
  apiKey: string,
): Promise<LoginResult> {
  const value = apiKey.trim();
  if (!value) throw new ConfigError("请输入 DeepSeek API Key");

  const template = getProviderTemplate(templateId);
  if (!template?.agentSdk) throw new ConfigError("该接入方式不支持本地调用");
  if (!readInstalledSdk(agentSdkDir(userDataRoot, templateId), template.agentSdk.package)) {
    throw new ConfigError("尚未接入，请先开始接入");
  }

  // 不在此冷启 harness 验 Key（启流贵）；格式粗检 + 落盘，真无效等首轮报错。
  if (value.length < 8) {
    throw new ConfigError("DeepSeek API Key 看起来太短，请检查后重试");
  }

  writeDshApiKey(userDataRoot, templateId, value, "DeepSeek");
  setAgentSdkModels(userDataRoot, templateId, [...FALLBACK_MODELS]);
  return readyResult(userDataRoot, templateId);
}

export async function logoutDsh(userDataRoot: string, templateId: string): Promise<void> {
  clearDshApiKey(userDataRoot, templateId);
  setAgentSdkState(userDataRoot, templateId, "not_logged_in");
  setAgentSdkModels(userDataRoot, templateId, []);
  setAgentSdkAccountLabel(userDataRoot, templateId, null);
}

/**
 * 公开 SDK / CLI 均无稳定 models.list → 显式 FALLBACK。
 * 勿伪装成账号可用发现；实录写明数据源。
 */
export async function fetchDshModels(
  _userDataRoot: string,
  _templateId: string,
): Promise<ExternalModel[]> {
  return [...FALLBACK_MODELS];
}

export async function refreshDshModels(
  userDataRoot: string,
  templateId: string,
): Promise<ExternalModel[]> {
  const models = await fetchDshModels(userDataRoot, templateId);
  setAgentSdkModels(userDataRoot, templateId, models);
  return models;
}

export async function ensureDshModels(
  userDataRoot: string,
  templateId: string,
): Promise<void> {
  if (agentSdkModels(userDataRoot, templateId).length > 0) return;
  await refreshDshModels(userDataRoot, templateId).catch(() => undefined);
}

export function dshModelsFallback(): ExternalModel[] {
  return [...FALLBACK_MODELS];
}

function readyResult(userDataRoot: string, templateId: string): LoginResult {
  const label = readDshAccountLabel(userDataRoot, templateId) ?? "DeepSeek";
  setAgentSdkState(userDataRoot, templateId, "ready");
  setAgentSdkAccountLabel(userDataRoot, templateId, label);
  void ensureDshModels(userDataRoot, templateId);
  return {
    auth_url: null,
    state: "ready",
    account_label: label,
  };
}

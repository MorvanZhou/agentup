import { ConfigError } from "../../../../../config/load.js";
import { throwModelCatalogUnavailable } from "../../../../../config/provider/model-list-policy.js";
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
import { positiveTokenCount, withTokenLimits } from "../../host/model-meta.js";
import { disposeAgentSdkRuntimesForTemplate } from "../../host/runtime-pool.js";
import { acquireCopilotClient } from "./client-pool.js";
import {
  clearCopilotGithubToken,
  ensureCopilotHome,
  hasCopilotToken,
  readCopilotAccountLabel,
  writeCopilotGithubToken,
} from "./home.js";
import { withTimeout } from "./load.js";

/**
 * GitHub Copilot 登录 / 登出 / 探测 / 列模型。
 *
 * SDK 无 LoginAsync（#1109），捆绑 copilot-runtime 也不接受 `login`：
 * - 开始登录 → auth_url + needs_api_key（Desktop 手动开申请页；粘贴 fine-grained PAT / gho_）
 * - 若本机已有 Copilot / gh 凭据，getAuthStatus 直接 ready
 */

/** 细粒度 PAT 创建页；测例锁定，改版须重审。 */
export const COPILOT_TOKEN_PAGE =
  "https://github.com/settings/personal-access-tokens";

const AUTH_STATUS_TIMEOUT_MS = 15_000;
/** 冷启 ~150MB CLI 再 RPC；30s 常不够，登录路径复用同一 client 可省一次冷启 */
const MODEL_QUERY_TIMEOUT_MS = 90_000;
const MAX_MODELS = 200;
const RETRY_COOLDOWN_MS = 60_000;

const FALLBACK_MODELS: AgentSdkModel[] = [
  { id: "auto", name: "Copilot Auto" },
];

export interface LoginResult {
  auth_url: string | null;
  state: "logging_in" | "ready" | "not_logged_in";
  account_label?: string;
  /** Key 回落：设置页展示粘贴框并调 submitCopilotApiKey */
  needs_api_key?: boolean;
}

export interface AgentSdkModel {
  id: string;
  name: string;
  credits?: number;
  contextWindow?: number;
  maxTokens?: number;
}

const lastModelAttempt = new Map<string, number>();

export async function startCopilotLogin(
  userDataRoot: string,
  templateId: string,
): Promise<LoginResult> {
  const template = getProviderTemplate(templateId);
  const installed = template?.agentSdk
    ? readInstalledSdk(agentSdkDir(userDataRoot, templateId), template.agentSdk.package)
    : null;
  if (!installed) throw new ConfigError("尚未接入，请先开始接入");

  // 仅 AgentUp 自管 token 算已登录；勿用本机 keychain / gh / 环境变量直接 ready
  // （否则设置页会跳过粘贴框，模型目录也常拉不到）
  if (hasCopilotToken(userDataRoot, templateId)) {
    const probed = await probeAuth(userDataRoot, templateId);
    if (probed.state === "ready") return probed;
  }

  ensureCopilotHome(userDataRoot, templateId);
  setAgentSdkState(userDataRoot, templateId, "logging_in");
  return {
    auth_url: COPILOT_TOKEN_PAGE,
    state: "logging_in",
    needs_api_key: true,
  };
}

export async function checkCopilotLogin(
  userDataRoot: string,
  templateId: string,
): Promise<LoginResult> {
  return probeAuth(userDataRoot, templateId);
}

/** 粘贴 GitHub token（fine-grained PAT / gho_ / ghu_）；写入隔离 home。 */
export async function submitCopilotApiKey(
  userDataRoot: string,
  templateId: string,
  apiKey: string,
): Promise<LoginResult> {
  const token = apiKey.trim();
  if (!token) throw new ConfigError("请输入 GitHub token");
  if (token.startsWith("ghp_")) {
    throw new ConfigError("不支持经典 PAT（ghp_）；请用 fine-grained PAT 或 OAuth token");
  }

  const template = getProviderTemplate(templateId);
  if (!template?.agentSdk) throw new ConfigError("该接入方式不支持本地调用");
  if (!readInstalledSdk(agentSdkDir(userDataRoot, templateId), template.agentSdk.package)) {
    throw new ConfigError("尚未接入，请先开始接入");
  }

  // 换 token 先踢掉旧进程，再写入并鉴权
  await disposeAgentSdkRuntimesForTemplate(userDataRoot, templateId);
  writeCopilotGithubToken(userDataRoot, templateId, token);
  // 鉴权与拉模型共用池化 client；失败勿再额外冷启
  const verified = await verifyAndListModels(userDataRoot, templateId, token);
  if (!verified.ok) {
    clearCopilotGithubToken(userDataRoot, templateId);
    setAgentSdkState(userDataRoot, templateId, "not_logged_in", {
      lastError: verified.error || "token 无效",
    });
    throw new ConfigError(verified.error || "GitHub token 无效或无 Copilot 权限");
  }

  const label = verified.label;
  if (label) writeCopilotGithubToken(userDataRoot, templateId, token, label);
  setAgentSdkState(userDataRoot, templateId, "ready");
  setAgentSdkAccountLabel(userDataRoot, templateId, label);
  // 活目录落盘；拉失败写空（禁 auto FALLBACK 假目录），记冷却避免 ensure 连打
  lastModelAttempt.set(templateId, Date.now());
  setAgentSdkModels(
    userDataRoot,
    templateId,
    verified.models?.length ? verified.models : [],
  );
  return {
    auth_url: null,
    state: "ready",
    ...(label ? { account_label: label } : {}),
  };
}

export async function logoutCopilot(userDataRoot: string, templateId: string): Promise<void> {
  await disposeAgentSdkRuntimesForTemplate(userDataRoot, templateId);
  clearCopilotGithubToken(userDataRoot, templateId);
  setAgentSdkState(userDataRoot, templateId, "not_logged_in");
  setAgentSdkModels(userDataRoot, templateId, []);
  setAgentSdkAccountLabel(userDataRoot, templateId, null);
}

export async function fetchCopilotModels(
  userDataRoot: string,
  templateId: string,
): Promise<AgentSdkModel[]> {
  if (!hasCopilotToken(userDataRoot, templateId)) {
    throw new ConfigError("尚未登录 GitHub Copilot（请先粘贴 GitHub token）");
  }
  const lease = await acquireCopilotClient({ userDataRoot, templateId });
  try {
    // 官方面：client.listModels() → RPC models.list → api.individual.githubcopilot.com/models
    const listed = await listModelsOnce(lease.value.client);
    if (listed.timedOut) {
      throw new ConfigError("拉取 Copilot 模型目录超时，请稍后重试");
    }
    if (listed.error) {
      throw new ConfigError(listed.error);
    }
    const models = normalizeModels(listed.raw);
    // 空活目录：统一提示，禁 auto FALLBACK
    if (!models.length) throwModelCatalogUnavailable();
    return mergeWithAuto(models);
  } finally {
    lease.release();
  }
}

export async function refreshCopilotModels(
  userDataRoot: string,
  templateId: string,
): Promise<AgentSdkModel[]> {
  const models = await fetchCopilotModels(userDataRoot, templateId);
  setAgentSdkModels(userDataRoot, templateId, models);
  return models;
}

export async function ensureCopilotModels(
  userDataRoot: string,
  templateId: string,
): Promise<void> {
  // 仅模板占位（只有 auto / default）不算已拉活目录，继续刷新
  if (!isPlaceholderModelCatalog(agentSdkModels(userDataRoot, templateId))) return;
  const last = lastModelAttempt.get(templateId) ?? 0;
  if (Date.now() - last < RETRY_COOLDOWN_MS) return;
  lastModelAttempt.set(templateId, Date.now());
  try {
    await refreshCopilotModels(userDataRoot, templateId);
  } catch {
    /* 查不到不推翻登录 */
  }
}

async function probeAuth(
  userDataRoot: string,
  templateId: string,
): Promise<LoginResult> {
  // AgentUp 态只认自管 token；本机 Copilot CLI / gh 登录不自动标 ready
  if (!hasCopilotToken(userDataRoot, templateId)) {
    setAgentSdkState(userDataRoot, templateId, "not_logged_in");
    return { auth_url: null, state: "not_logged_in" };
  }

  try {
    const verified = await verifyAndListModels(userDataRoot, templateId);
    if (verified.ok) {
      const label =
        verified.label || readCopilotAccountLabel(userDataRoot, templateId);
      setAgentSdkState(userDataRoot, templateId, "ready");
      setAgentSdkAccountLabel(userDataRoot, templateId, label);
      if (verified.models?.length) {
        setAgentSdkModels(userDataRoot, templateId, verified.models);
        lastModelAttempt.set(templateId, Date.now());
      } else if (isPlaceholderModelCatalog(agentSdkModels(userDataRoot, templateId))) {
        // 探测成功但目录仍是占位：再开一次拉活（不先清空，失败可保留占位）
        await syncModelsAfterLogin(userDataRoot, templateId);
      }
      return {
        auth_url: null,
        state: "ready",
        ...(label ? { account_label: label } : {}),
      };
    }
  } catch {
    /* token 在但 RPC 失败 */
  }

  setAgentSdkState(userDataRoot, templateId, "not_logged_in");
  return { auth_url: null, state: "not_logged_in" };
}

/**
 * 一次冷启：鉴权 + 尽量顺手 listModels。
 * Copilot CLI 体积大，登录路径禁止再开第二次 spawn。
 */
async function verifyAndListModels(
  userDataRoot: string,
  templateId: string,
  tokenOverride?: string,
): Promise<{
  ok: boolean;
  label: string | null;
  error?: string;
  models?: AgentSdkModel[];
}> {
  try {
    const lease = await acquireCopilotClient({
      userDataRoot,
      templateId,
      tokenOverride,
    });
    try {
      const status = await withTimeout(
        lease.value.client.getAuthStatus(),
        AUTH_STATUS_TIMEOUT_MS,
      );
      if (!isAuthenticated(status)) {
        return { ok: false, label: null, error: "token 未能通过 Copilot 鉴权" };
      }
      const label = accountLabelOf(status);
      const listed = await listModelsOnce(lease.value.client);
      if (listed.raw != null) {
        const normalized = normalizeModels(listed.raw);
        // 空目录不写 FALLBACK；submit 侧会落空列表并提示刷新
        const models = normalized.length ? mergeWithAuto(normalized) : [];
        return { ok: true, label, models };
      }
      // 鉴权已过；目录网络失败时仍 ready，models 缺省 → submit 写空
      return { ok: true, label };
    } finally {
      lease.release();
    }
  } catch (error) {
    return {
      ok: false,
      label: null,
      error: error instanceof Error ? error.message : "无法验证 token",
    };
  }
}

/** client.listModels()：保留真实错误（勿把网络失败当成超时）。 */
async function listModelsOnce(client: {
  listModels: () => Promise<unknown>;
}): Promise<{ raw: unknown | null; timedOut?: boolean; error?: string }> {
  try {
    const raw = await Promise.race([
      client.listModels().then((value) => ({ kind: "ok" as const, value })),
      new Promise<{ kind: "timeout" }>((resolve) => {
        setTimeout(() => resolve({ kind: "timeout" }), MODEL_QUERY_TIMEOUT_MS);
      }),
    ]);
    if (raw.kind === "timeout") return { raw: null, timedOut: true };
    return { raw: raw.value };
  } catch (error) {
    return { raw: null, error: formatCopilotModelsError(error) };
  }
}

/** 把 SDK GenericFailure / DNS / SSL 收成可读短句。 */
export function formatCopilotModelsError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error ?? "");
  if (/api\.individual\.githubcopilot\.com/i.test(text) || /models\.list/i.test(text)) {
    if (/ENOTFOUND|dns|lookup/i.test(text)) {
      return "无法解析 api.individual.githubcopilot.com，请检查 DNS / 代理后再刷新模型列表";
    }
    if (/SSL|certificate|connection closed|Connect/i.test(text)) {
      return "无法连接 api.individual.githubcopilot.com（网络或代理拦截），鉴权已成功，可稍后刷新模型列表";
    }
  }
  if (/timed?\s*out|timeout|超时/i.test(text)) {
    return "拉取 Copilot 模型目录超时，请稍后重试";
  }
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed) return `拉取 Copilot 模型目录失败：${trimmed.slice(0, 180)}`;
  return "拉取 Copilot 模型目录失败，请稍后重试";
}

async function syncModelsAfterLogin(
  userDataRoot: string,
  templateId: string,
  options?: { accountChanged?: boolean },
): Promise<void> {
  // 换账号时清冷却；勿先清空目录——拉失败时保留旧列表 / 模板占位，避免 UI 空窗
  if (options?.accountChanged) {
    lastModelAttempt.delete(templateId);
  }
  try {
    await refreshCopilotModels(userDataRoot, templateId);
  } catch {
    /* 空着下次再试；UI 会暂时回落模板 auto */
  }
}

/** 空目录或仅 auto/default 占位 → 仍应去拉活列表 */
export function isPlaceholderModelCatalog(models: AgentSdkModel[]): boolean {
  if (models.length === 0) return true;
  return models.every((item) => item.id === "auto" || item.id === "default");
}

export function isAuthenticated(status: unknown): boolean {
  if (!status || typeof status !== "object") return false;
  const row = status as Record<string, unknown>;
  if (row.authenticated === true || row.isAuthenticated === true) return true;
  if (row.loggedIn === true || row.isLoggedIn === true) return true;
  const statusText =
    typeof row.status === "string"
      ? row.status.toLowerCase()
      : typeof row.state === "string"
        ? row.state.toLowerCase()
        : "";
  if (
    statusText === "authenticated" ||
    statusText === "logged-in" ||
    statusText === "logged_in" ||
    statusText === "ready"
  ) {
    return true;
  }
  // 有 login / user / account 字段也视为已登录
  if (accountLabelOf(status)) return true;
  return false;
}

export function accountLabelOf(status: unknown): string | null {
  if (!status || typeof status !== "object") return null;
  const row = status as Record<string, unknown>;
  for (const key of ["login", "user", "username", "email", "account", "name"]) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = value as Record<string, unknown>;
      for (const nestedKey of ["login", "name", "email", "id"]) {
        const nestedValue = nested[nestedKey];
        if (typeof nestedValue === "string" && nestedValue.trim()) {
          return nestedValue.trim();
        }
      }
    }
  }
  return null;
}

/** 测例可直接覆盖：归一 listModels 返回。 */
export function normalizeModels(raw: unknown): AgentSdkModel[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { models?: unknown }).models)
      ? ((raw as { models: unknown[] }).models)
      : [];
  const out: AgentSdkModel[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as {
      id?: unknown;
      name?: unknown;
      label?: unknown;
      displayName?: unknown;
      billing?: unknown;
      capabilities?: unknown;
    };
    const id = typeof row.id === "string" ? row.id.trim() : "";
    if (!id || seen.has(id)) continue;
    const name =
      (typeof row.label === "string" && row.label.trim()) ||
      (typeof row.name === "string" && row.name.trim()) ||
      (typeof row.displayName === "string" && row.displayName.trim()) ||
      id;
    const credits = creditsOf(row.billing);
    // 官方 RPC / CAPI：capabilities.limits.max_context_window_tokens
    const limits = copilotLimitsOf(row.capabilities);
    seen.add(id);
    out.push(
      withTokenLimits({
        id,
        name,
        ...(credits != null ? { credits } : {}),
        ...(limits.contextWindow === undefined ? {} : { contextWindow: limits.contextWindow }),
        ...(limits.maxTokens === undefined ? {} : { maxTokens: limits.maxTokens }),
      }),
    );
    if (out.length >= MAX_MODELS) break;
  }
  return out;
}

/** Copilot models.list → capabilities.limits。 */
function copilotLimitsOf(capabilities: unknown): {
  contextWindow?: number;
  maxTokens?: number;
} {
  if (!capabilities || typeof capabilities !== "object") return {};
  const limits = (capabilities as { limits?: unknown }).limits;
  if (!limits || typeof limits !== "object") return {};
  const row = limits as Record<string, unknown>;
  return {
    contextWindow: positiveTokenCount(row.max_context_window_tokens),
    maxTokens: positiveTokenCount(row.max_output_tokens),
  };
}

function creditsOf(billing: unknown): number | undefined {
  if (!billing || typeof billing !== "object") return undefined;
  const row = billing as Record<string, unknown>;
  for (const key of ["creditsMultiplier", "multiplier", "credits", "rate"]) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
    if (typeof value === "string") {
      const match = value.match(/([\d.]+)/);
      if (match) {
        const n = Number(match[1]);
        if (Number.isFinite(n) && n >= 0) return n;
      }
    }
  }
  return undefined;
}

function mergeWithAuto(catalog: AgentSdkModel[]): AgentSdkModel[] {
  const rest = catalog.filter((item) => item.id !== "auto" && item.id !== "default");
  return [...FALLBACK_MODELS, ...rest].slice(0, MAX_MODELS);
}

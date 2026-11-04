import { ConfigError } from "../../../../../config/load.js";
import { getProviderTemplate } from "../../../../../config/provider-templates.js";
import {
  agentSdkAccountLabel,
  agentSdkModels,
  setAgentSdkAccountLabel,
  setAgentSdkModels,
  setAgentSdkState,
} from "../../../../../config/provider/index.js";
import {
  agentSdkDir,
  readInstalledSdk,
} from "../../../../../config/providers/agent-sdk/installer.js";
import { cursorCredentialStore, readCursorApiKey } from "./credentials.js";
import { loadCursorModule, withTimeout } from "./load.js";

/**
 * Cursor 登录 / 登出 / 探测 / 列模型。
 * openBrowser: false → Desktop 用 auth_url 调 shell.openExternal。
 */

const LOGIN_URL_TIMEOUT_MS = 20_000;
const LOGIN_CHECK_TIMEOUT_MS = 15_000;
const MODEL_QUERY_TIMEOUT_MS = 30_000;
const MAX_MODELS = 200;
const RETRY_COOLDOWN_MS = 60_000;

interface PendingLogin {
  templateId: string;
  authUrl?: string;
  finished: boolean;
}

const pending = new Map<string, PendingLogin>();
const lastModelAttempt = new Map<string, number>();

export interface LoginResult {
  auth_url: string | null;
  state: "logging_in" | "ready" | "not_logged_in";
  account_label?: string;
}

export interface AgentSdkModel {
  id: string;
  name: string;
  credits?: number;
}

export async function startCursorLogin(
  userDataRoot: string,
  templateId: string,
): Promise<LoginResult> {
  const existing = pending.get(templateId);
  if (existing && !existing.finished) {
    return { auth_url: existing.authUrl ?? null, state: "logging_in" };
  }

  const template = getProviderTemplate(templateId);
  const installed = template?.agentSdk
    ? readInstalledSdk(agentSdkDir(userDataRoot, templateId), template.agentSdk.package)
    : null;
  if (!installed) throw new ConfigError("尚未接入，请先开始接入");

  const sdk = await loadCursorModule(userDataRoot, templateId);
  // 自管 store：不依赖 SDK 是否导出 FileCredentialStore 构造器
  const store = cursorCredentialStore(userDataRoot, templateId);
  const record: PendingLogin = { templateId, finished: false };
  pending.set(templateId, record);
  setAgentSdkState(userDataRoot, templateId, "logging_in");

  const settled = new Promise<"done" | "failed">((resolve) => {
    sdk.Cursor.auth
      .login({
        openBrowser: false,
        store,
        apiKeyName: "AgentUp",
        onLoginUrl: (url: string) => {
          if (url) record.authUrl = url;
        },
      })
      .then(async (result) => {
        const previous = agentSdkAccountLabel(userDataRoot, templateId);
        const label = result.email?.trim() || null;
        setAgentSdkState(userDataRoot, templateId, "ready");
        setAgentSdkAccountLabel(userDataRoot, templateId, label);
        await syncModelsAfterLogin(userDataRoot, templateId, {
          accountChanged: Boolean(label) && label !== previous,
        });
        record.finished = true;
        resolve("done");
      })
      .catch(() => {
        setAgentSdkState(userDataRoot, templateId, "not_logged_in", { lastError: "登录未完成" });
        record.finished = true;
        resolve("failed");
      });
  });

  const urlOrEnd = await Promise.race([
    settled.then(() => null as string | null),
    waitForAuthUrl(() => record.authUrl),
    withTimeout(new Promise<null>(() => {}), LOGIN_URL_TIMEOUT_MS),
  ]);

  if (urlOrEnd) {
    record.authUrl = urlOrEnd;
    return { auth_url: urlOrEnd, state: "logging_in" };
  }
  const finished = await Promise.race([settled, withTimeout(settled, LOGIN_CHECK_TIMEOUT_MS)]);
  record.finished = true;
  return finished === "done"
    ? { auth_url: null, state: "ready" }
    : { auth_url: null, state: "not_logged_in" };
}

export async function checkCursorLogin(
  userDataRoot: string,
  templateId: string,
): Promise<LoginResult> {
  const active = pending.get(templateId);
  if (active && !active.finished) return { auth_url: active.authUrl ?? null, state: "logging_in" };

  const sdk = await loadCursorModule(userDataRoot, templateId);
  const store = cursorCredentialStore(userDataRoot, templateId);
  const status = await withTimeout(sdk.Cursor.auth.status({ store }), LOGIN_CHECK_TIMEOUT_MS);
  if (status?.status === "logged-in") {
    const previous = agentSdkAccountLabel(userDataRoot, templateId);
    const label = status.email?.trim() || null;
    setAgentSdkState(userDataRoot, templateId, "ready");
    setAgentSdkAccountLabel(userDataRoot, templateId, label);
    await syncModelsAfterLogin(userDataRoot, templateId, {
      accountChanged: Boolean(label) && label !== previous,
    });
    return { auth_url: null, state: "ready", ...(label ? { account_label: label } : {}) };
  }
  setAgentSdkState(userDataRoot, templateId, "not_logged_in");
  return { auth_url: null, state: "not_logged_in" };
}

export async function logoutCursor(userDataRoot: string, templateId: string): Promise<void> {
  const sdk = await loadCursorModule(userDataRoot, templateId);
  const store = cursorCredentialStore(userDataRoot, templateId);
  await withTimeout(sdk.Cursor.auth.logout({ store }), 5_000);
  await store.clear().catch(() => undefined);
  pending.delete(templateId);
  setAgentSdkState(userDataRoot, templateId, "not_logged_in");
  setAgentSdkModels(userDataRoot, templateId, []);
  setAgentSdkAccountLabel(userDataRoot, templateId, null);
}

export async function fetchCursorModels(
  userDataRoot: string,
  templateId: string,
): Promise<AgentSdkModel[]> {
  const sdk = await loadCursorModule(userDataRoot, templateId);
  const apiKey = await readCursorApiKey(userDataRoot, templateId);
  if (!apiKey) throw new ConfigError("尚未登录 Cursor");
  const raw = await withTimeout(
    sdk.Cursor.models.list({ apiKey }),
    MODEL_QUERY_TIMEOUT_MS,
  );
  const models = normalizeModels(raw);
  if (!models.length) throw new ConfigError("Cursor 没有返回可用模型");
  return models;
}

export async function refreshCursorModels(
  userDataRoot: string,
  templateId: string,
): Promise<AgentSdkModel[]> {
  const models = await fetchCursorModels(userDataRoot, templateId);
  setAgentSdkModels(userDataRoot, templateId, models);
  return models;
}

export async function ensureCursorModels(userDataRoot: string, templateId: string): Promise<void> {
  if (agentSdkModels(userDataRoot, templateId).length > 0) return;
  const last = lastModelAttempt.get(templateId) ?? 0;
  if (Date.now() - last < RETRY_COOLDOWN_MS) return;
  lastModelAttempt.set(templateId, Date.now());
  try {
    await refreshCursorModels(userDataRoot, templateId);
  } catch {
    /* 查不到不推翻登录 */
  }
}

async function syncModelsAfterLogin(
  userDataRoot: string,
  templateId: string,
  options?: { accountChanged?: boolean },
): Promise<void> {
  if (!options?.accountChanged) {
    await ensureCursorModels(userDataRoot, templateId);
    return;
  }
  setAgentSdkModels(userDataRoot, templateId, []);
  lastModelAttempt.delete(templateId);
  try {
    await refreshCursorModels(userDataRoot, templateId);
  } catch {
    /* 空着下次再试 */
  }
}

function waitForAuthUrl(get: () => string | undefined): Promise<string | null> {
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const url = get();
      if (url) {
        clearInterval(timer);
        resolve(url);
        return;
      }
      if (Date.now() - started > LOGIN_URL_TIMEOUT_MS) {
        clearInterval(timer);
        resolve(null);
      }
    }, 50);
  });
}

function normalizeModels(raw: unknown): AgentSdkModel[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { models?: unknown }).models)
      ? ((raw as { models: unknown[] }).models)
      : [];
  const out: AgentSdkModel[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as { id?: unknown; name?: unknown; displayName?: unknown };
    const id = typeof row.id === "string" ? row.id.trim() : "";
    if (!id || seen.has(id)) continue;
    const name =
      (typeof row.name === "string" && row.name.trim()) ||
      (typeof row.displayName === "string" && row.displayName.trim()) ||
      id;
    seen.add(id);
    out.push({ id, name });
    if (out.length >= MAX_MODELS) break;
  }
  return out;
}

import type { ChildProcess } from "node:child_process";

import { ConfigError } from "../../../../../config/load.js";
import {
  agentSdkModels,
  setAgentSdkAccountLabel,
  setAgentSdkModels,
  setAgentSdkState,
} from "../../../../../config/provider/index.js";
import type { ExternalModel } from "../../contract.js";
import {
  accountLabel,
  clearAuth,
  ensureHome,
  hasOpencodeAuth,
} from "./home.js";
import {
  loadOpencodeSdkModule,
  resolveOpencodeCliPath,
  spawnOpencode,
} from "./load.js";
import { startOpencodeServer } from "./server.js";

/**
 * Console 账号页：Personal API keys 在此创建；完整 Key 只在创建时显示一次。
 * 导出给契约测：该 URL 失效/改版时测例变红，须重审 OpenCode 登录接入。
 */
export const OPENCODE_AUTH_PAGE = "https://opencode.ai/console/account";
const AUTH_PAGE = OPENCODE_AUTH_PAGE;
const LOGIN_URL_WAIT_MS = 8_000;
const LOGIN_MAX_MS = 15 * 60_000;
const MODEL_TIMEOUT_MS = 30_000;
const AUTH_PAGE_PROBE_MS = 15_000;
const FALLBACK_MODELS: ExternalModel[] = [
  { id: "default", name: "OpenCode 默认模型" },
];

/**
 * 探测登录页是否仍可达、仍落在 opencode.ai/console。
 * 失败 = 厂商改了入口；须重审 Key 粘贴 / AUTH_PAGE，不要静默换 URL。
 */
export async function probeOpencodeAuthPage(
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<{ status: number; finalUrl: string }> {
  const timeout = AbortSignal.timeout(AUTH_PAGE_PROBE_MS);
  const combined =
    signal != null
      ? AbortSignal.any([signal, timeout])
      : timeout;
  let response: Response;
  try {
    response = await fetchImpl(OPENCODE_AUTH_PAGE, {
      method: "GET",
      redirect: "follow",
      signal: combined,
      headers: { Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8" },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `OpenCode 登录页不可达（${OPENCODE_AUTH_PAGE}）：${detail}。请重审 adapters/opencode 登录契约。`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `OpenCode 登录页 HTTP ${response.status}（${OPENCODE_AUTH_PAGE}）。请重审 adapters/opencode 登录契约。`,
    );
  }
  const finalUrl = response.url || OPENCODE_AUTH_PAGE;
  if (!isOpencodeConsoleUrl(finalUrl)) {
    throw new Error(
      `OpenCode 登录页重定向离开 console（${finalUrl}）。请重审 adapters/opencode 登录契约。`,
    );
  }
  const html = await response.text();
  // SPA shell：未登录也是 Console HTML；丢标题通常表示入口改版或换成别的产品页
  if (!/OpenCode Console/i.test(html)) {
    throw new Error(
      `OpenCode 登录页 HTML 不再含 “OpenCode Console”（${finalUrl}）。请重审 adapters/opencode 登录契约。`,
    );
  }
  return { status: response.status, finalUrl };
}

function isOpencodeConsoleUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    if (!/(^|\.)opencode\.ai$/i.test(parsed.hostname)) return false;
    return parsed.pathname === "/console" || parsed.pathname.startsWith("/console/");
  } catch {
    return false;
  }
}

export interface LoginResult {
  auth_url: string | null;
  state: "logging_in" | "ready" | "not_logged_in";
  account_label?: string;
  device_code?: string;
  /** Key 回落：设置页需展示粘贴框并调 submitOpencodeApiKey */
  needs_api_key?: boolean;
}

interface PendingLogin {
  child: ChildProcess;
  authUrl?: string;
  deviceCode?: string;
  finished: boolean;
  timer: NodeJS.Timeout;
}

const pending = new Map<string, PendingLogin>();

export async function startOpencodeLogin(
  userDataRoot: string,
  templateId: string,
): Promise<LoginResult> {
  if (hasOpencodeAuth(userDataRoot, templateId)) return readyResult(userDataRoot, templateId);
  const key = pendingKey(userDataRoot, templateId);
  const active = pending.get(key);
  if (active && !active.finished) return pendingResult(active);
  if (!resolveOpencodeCliPath(userDataRoot, templateId)) {
    throw new ConfigError("找不到 OpenCode CLI，请重新安装");
  }

  ensureHome(userDataRoot, templateId);
  setAgentSdkState(userDataRoot, templateId, "logging_in");
  // 短时探测 CLI 是否吐出 device code；官方主路径仍是 Console Personal API Key + 粘贴。
  const child = spawnOpencode(userDataRoot, templateId, ["auth", "login", "opencode"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const record: PendingLogin = {
    child,
    finished: false,
    timer: setTimeout(() => finishPending(key, userDataRoot, templateId, "登录超时"), LOGIN_MAX_MS),
  };
  pending.set(key, record);
  let combined = "";
  const ingest = (chunk: Buffer | string) => {
    combined = `${combined}${String(chunk)}`.slice(-16_384);
    record.authUrl = firstHttpUrl(combined) ?? record.authUrl;
    record.deviceCode = firstDeviceCode(combined) ?? record.deviceCode;
  };
  child.stdout?.on("data", ingest);
  child.stderr?.on("data", ingest);
  child.on("error", () => finishPending(key, userDataRoot, templateId, "无法启动 OpenCode 登录"));
  child.on("close", () => {
    if (hasOpencodeAuth(userDataRoot, templateId)) {
      finishReady(key, userDataRoot, templateId);
    } else {
      finishPending(key, userDataRoot, templateId, "登录未完成");
    }
  });

  await waitUntil(
    () => Boolean(record.deviceCode || record.finished || hasOpencodeAuth(userDataRoot, templateId)),
    LOGIN_URL_WAIT_MS,
  );
  if (hasOpencodeAuth(userDataRoot, templateId)) return readyResult(userDataRoot, templateId);
  // 仅当 CLI 明确给出设备码时走 device 流；裸跳 Console 不算登录完成
  if (record.deviceCode && !record.finished) return pendingResult(record);

  // Key 回落：停掉挂起的 CLI，打开 Account 页并展示粘贴框
  clearTimeout(record.timer);
  try {
    child.kill("SIGTERM");
  } catch {
    /* 已退出 */
  }
  pending.delete(key);
  setAgentSdkState(userDataRoot, templateId, "logging_in");
  return { auth_url: AUTH_PAGE, state: "logging_in", needs_api_key: true };
}

export async function checkOpencodeLogin(
  userDataRoot: string,
  templateId: string,
): Promise<LoginResult> {
  if (hasOpencodeAuth(userDataRoot, templateId)) return readyResult(userDataRoot, templateId);
  const active = pending.get(pendingKey(userDataRoot, templateId));
  if (active && !active.finished) return pendingResult(active);
  setAgentSdkState(userDataRoot, templateId, "not_logged_in");
  return { auth_url: null, state: "not_logged_in" };
}

export async function submitOpencodeApiKey(
  userDataRoot: string,
  templateId: string,
  key: string,
): Promise<LoginResult> {
  const value = key.trim();
  if (!value) throw new ConfigError("请输入 OpenCode Key");
  const server = await startOpencodeServer({ userDataRoot, templateId });
  try {
    const sdk = await loadOpencodeSdkModule(userDataRoot, templateId);
    const client = sdk.createOpencodeClient({ baseUrl: server.url });
    const response = await client.auth.set({
      providerID: "opencode",
      auth: { type: "api", key: value },
    });
    assertNoSdkError(response, "OpenCode Key 保存失败");
  } finally {
    await server.close();
  }
  if (!hasOpencodeAuth(userDataRoot, templateId)) {
    throw new ConfigError("OpenCode Key 未写入隔离目录");
  }
  return readyResult(userDataRoot, templateId);
}

export async function logoutOpencode(userDataRoot: string, templateId: string): Promise<void> {
  const key = pendingKey(userDataRoot, templateId);
  const active = pending.get(key);
  if (active) {
    clearTimeout(active.timer);
    try {
      active.child.kill("SIGTERM");
    } catch {
      /* 已退出。 */
    }
    pending.delete(key);
  }
  clearAuth(userDataRoot, templateId);
  setAgentSdkState(userDataRoot, templateId, "not_logged_in");
  setAgentSdkAccountLabel(userDataRoot, templateId, null);
  setAgentSdkModels(userDataRoot, templateId, []);
}

export async function fetchOpencodeModels(
  userDataRoot: string,
  templateId: string,
): Promise<ExternalModel[]> {
  if (!hasOpencodeAuth(userDataRoot, templateId)) {
    throw new ConfigError("尚未登录 OpenCode");
  }
  const live = await withTimeout(fetchModelsFromServer(userDataRoot, templateId), MODEL_TIMEOUT_MS);
  if (live?.length) return live;
  const cli = await withTimeout(fetchModelsFromCli(userDataRoot, templateId), MODEL_TIMEOUT_MS);
  return opencodeModelsOrFallback(cli ?? []);
}

export function normalizeOpencodeModels(raw: unknown): ExternalModel[] {
  const data = unwrapData(raw);
  const providers = Array.isArray(data.providers) ? data.providers : [];
  const provider = providers.find(
    (value) => value && typeof value === "object" && (value as { id?: unknown }).id === "opencode",
  ) as { models?: unknown } | undefined;
  if (!provider?.models || typeof provider.models !== "object" || Array.isArray(provider.models)) {
    return [];
  }
  const out: ExternalModel[] = [];
  const seen = new Set<string>();
  for (const [key, value] of Object.entries(provider.models as Record<string, unknown>)) {
    const row =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    const rawId = typeof row.id === "string" && row.id.trim() ? row.id.trim() : key;
    const id = rawId.startsWith("opencode/") ? rawId : `opencode/${rawId}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : rawId;
    out.push({ id, name });
    if (out.length >= 200) break;
  }
  return out;
}

export function opencodeModelsOrFallback(models: ExternalModel[]): ExternalModel[] {
  return models.length > 0 ? models : [...FALLBACK_MODELS];
}

export function parseOpencodeModelsOutput(stdout: string): ExternalModel[] {
  const seen = new Set<string>();
  const models: ExternalModel[] = [];
  for (const line of stdout.replace(/\u001b\[[0-9;]*m/g, "").split(/\r?\n/)) {
    const match = line.trim().match(/\b(opencode\/[A-Za-z0-9._:/-]+)\b/);
    if (!match?.[1] || seen.has(match[1])) continue;
    seen.add(match[1]);
    models.push({ id: match[1], name: match[1].slice("opencode/".length) });
    if (models.length >= 200) break;
  }
  return models;
}

export async function refreshOpencodeModels(
  userDataRoot: string,
  templateId: string,
): Promise<ExternalModel[]> {
  const models = await fetchOpencodeModels(userDataRoot, templateId);
  setAgentSdkModels(userDataRoot, templateId, models);
  return models;
}

export async function ensureOpencodeModels(
  userDataRoot: string,
  templateId: string,
): Promise<void> {
  if (agentSdkModels(userDataRoot, templateId).length > 0) return;
  await refreshOpencodeModels(userDataRoot, templateId).catch(() => undefined);
}

async function fetchModelsFromServer(
  userDataRoot: string,
  templateId: string,
): Promise<ExternalModel[]> {
  const server = await startOpencodeServer({ userDataRoot, templateId });
  try {
    const sdk = await loadOpencodeSdkModule(userDataRoot, templateId);
    const client = sdk.createOpencodeClient({ baseUrl: server.url });
    return normalizeOpencodeModels(await client.config.providers());
  } finally {
    await server.close();
  }
}

async function fetchModelsFromCli(
  userDataRoot: string,
  templateId: string,
): Promise<ExternalModel[]> {
  return new Promise((resolve) => {
    const child = spawnOpencode(userDataRoot, templateId, ["models", "opencode"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout?.on("data", (chunk: Buffer | string) => {
      output += String(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      output += String(chunk);
    });
    child.on("error", () => resolve([]));
    child.on("close", (code) => resolve(code === 0 ? parseOpencodeModelsOutput(output) : []));
  });
}

function readyResult(userDataRoot: string, templateId: string): LoginResult {
  const label = accountLabel(userDataRoot, templateId);
  setAgentSdkState(userDataRoot, templateId, "ready");
  setAgentSdkAccountLabel(userDataRoot, templateId, label);
  void ensureOpencodeModels(userDataRoot, templateId);
  return {
    auth_url: null,
    state: "ready",
    ...(label ? { account_label: label } : {}),
  };
}

function pendingResult(record: PendingLogin): LoginResult {
  return {
    auth_url: record.authUrl ?? AUTH_PAGE,
    state: "logging_in",
    ...(record.deviceCode ? { device_code: record.deviceCode } : {}),
  };
}

function finishReady(key: string, userDataRoot: string, templateId: string): void {
  const record = pending.get(key);
  if (record) {
    record.finished = true;
    clearTimeout(record.timer);
    pending.delete(key);
  }
  readyResult(userDataRoot, templateId);
}

function finishPending(
  key: string,
  userDataRoot: string,
  templateId: string,
  lastError: string,
): void {
  const record = pending.get(key);
  if (record) {
    record.finished = true;
    clearTimeout(record.timer);
    try {
      if (record.child.exitCode === null) record.child.kill("SIGTERM");
    } catch {
      /* 已退出。 */
    }
    pending.delete(key);
  }
  setAgentSdkState(userDataRoot, templateId, "not_logged_in", { lastError });
}

function pendingKey(userDataRoot: string, templateId: string): string {
  return `${userDataRoot}\0${templateId}`;
}

function firstHttpUrl(text: string): string | null {
  const plain = text.replace(/\u001b\[[0-9;]*m/g, "");
  const match = plain.match(/https?:\/\/[^\s"'<>]+/i);
  return match?.[0]?.replace(/[),.;]+$/, "") ?? null;
}

function firstDeviceCode(text: string): string | null {
  const plain = text.replace(/\u001b\[[0-9;]*m/g, "");
  return plain.match(/\b([A-Z0-9]{4,8}(?:-[A-Z0-9]{3,8})+)\b/)?.[1] ?? null;
}

function waitUntil(check: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (check() || Date.now() - started >= timeoutMs) {
        clearInterval(timer);
        resolve();
      }
    }, 50);
  });
}

function unwrapData(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const row = raw as Record<string, unknown>;
  return row.data && typeof row.data === "object" && !Array.isArray(row.data)
    ? (row.data as Record<string, unknown>)
    : row;
}

function assertNoSdkError(raw: unknown, message: string): void {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  if ((raw as Record<string, unknown>).error) throw new ConfigError(message);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

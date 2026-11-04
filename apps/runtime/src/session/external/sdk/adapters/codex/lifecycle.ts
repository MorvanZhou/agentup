import { spawn } from "node:child_process";

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
import {
  clearCodexHomeAuth,
  ensureCodexHome,
  hasCodexAuth,
  readCodexAccountLabel,
} from "./home.js";
import { resolveCodexCliPath, withTimeout } from "./load.js";

/**
 * Codex 登录 / 登出 / 探测 / 列模型。
 * SDK 无 Cursor.auth 等价物 → spawn 安装目录内原生 CLI；
 * 用 --device-auth 把 verification URL 交给 Desktop openExternal。
 */

const LOGIN_URL_TIMEOUT_MS = 30_000;
const LOGIN_WAIT_MS = 15 * 60_000;
const STATUS_TIMEOUT_MS = 15_000;
const MODEL_QUERY_TIMEOUT_MS = 30_000;
const MAX_AGENT_SDK_MODELS = 200;
const RETRY_COOLDOWN_MS = 60_000;

/**
 * SDK 无 models.list；公开一等命令也无 `codex models`。
 * 社区 / 官方调试面：`codex debug models` 打出当前登录可见的 JSON 目录（可远程刷新）。
 * `default` 表示不传 ThreadOptions.model，交给 CLI 推荐。
 */
const FALLBACK_MODELS: AgentSdkModel[] = [
  { id: "default", name: "Codex 默认模型" },
];

interface PendingLogin {
  templateId: string;
  authUrl?: string;
  /** device-auth 一次性验证码；须在网页输入，不能只打开 URL */
  deviceCode?: string;
  finished: boolean;
  child?: ReturnType<typeof spawn>;
}

const pending = new Map<string, PendingLogin>();
const lastModelAttempt = new Map<string, number>();

export interface LoginResult {
  auth_url: string | null;
  state: "logging_in" | "ready" | "not_logged_in";
  account_label?: string;
  /** Codex device-auth 一次性码；其它厂商可省略 */
  device_code?: string;
}

export interface AgentSdkModel {
  id: string;
  name: string;
  credits?: number;
}

export async function startCodexLogin(
  userDataRoot: string,
  templateId: string,
): Promise<LoginResult> {
  const existing = pending.get(templateId);
  if (existing && !existing.finished) {
    return {
      auth_url: existing.authUrl ?? null,
      state: "logging_in",
      ...(existing.deviceCode ? { device_code: existing.deviceCode } : {}),
    };
  }

  const template = getProviderTemplate(templateId);
  const installed = template?.agentSdk
    ? readInstalledSdk(agentSdkDir(userDataRoot, templateId), template.agentSdk.package)
    : null;
  if (!installed) throw new ConfigError("尚未接入，请先开始接入");

  const cli = resolveCodexCliPath(userDataRoot, templateId);
  if (!cli) throw new ConfigError("找不到 Codex CLI，请重新安装");

  const home = ensureCodexHome(userDataRoot, templateId);
  const record: PendingLogin = { templateId, finished: false };
  pending.set(templateId, record);
  setAgentSdkState(userDataRoot, templateId, "logging_in");

  // device-auth：打印 verification URL，适合 Electron（不依赖本机 1455 回调）
  const child = spawn(cli, ["login", "--device-auth"], {
    env: codexCliEnv(home),
    stdio: ["ignore", "pipe", "pipe"],
  });
  record.child = child;

  const settled = new Promise<"done" | "failed">((resolve) => {
    let combined = "";
    const ingest = (chunk: Buffer | string) => {
      const text = String(chunk);
      combined += text;
      const url = firstHttpUrl(text) ?? firstHttpUrl(combined);
      if (url) record.authUrl = url;
      const code = firstDeviceCode(text) ?? firstDeviceCode(combined);
      if (code) record.deviceCode = code;
    };
    child.stdout?.on("data", ingest);
    child.stderr?.on("data", ingest);
    child.on("error", () => {
      setAgentSdkState(userDataRoot, templateId, "not_logged_in", {
        lastError: "无法启动 Codex 登录",
      });
      record.finished = true;
      pending.delete(templateId);
      resolve("failed");
    });
    child.on("close", (code) => {
      if (code === 0 && hasCodexAuth(userDataRoot, templateId)) {
        const previous = agentSdkAccountLabel(userDataRoot, templateId);
        const label = readCodexAccountLabel(userDataRoot, templateId);
        setAgentSdkState(userDataRoot, templateId, "ready");
        setAgentSdkAccountLabel(userDataRoot, templateId, label);
        void syncModelsAfterLogin(userDataRoot, templateId, {
          accountChanged: Boolean(label) && label !== previous,
        });
        record.finished = true;
        pending.delete(templateId);
        resolve("done");
        return;
      }
      setAgentSdkState(userDataRoot, templateId, "not_logged_in", {
        lastError: "登录未完成",
      });
      record.finished = true;
      pending.delete(templateId);
      resolve("failed");
    });
  });

  // 外层：尽快把 URL + device code 还给 Desktop；登录本身可在后台继续
  const urlOrEnd = await Promise.race([
    settled.then(() => null as string | null),
    waitForAuthUrl(() => record.authUrl),
    withTimeout(new Promise<null>(() => {}), LOGIN_URL_TIMEOUT_MS),
  ]);
  // device code 常与 URL 同批输出；再等一小会儿
  if (!record.deviceCode) {
    await waitForDeviceCode(() => record.deviceCode, 2_000);
  }

  if (urlOrEnd || record.authUrl) {
    const authUrl = urlOrEnd ?? record.authUrl ?? null;
    if (authUrl) record.authUrl = authUrl;
    // 给长登录一个硬上限，避免子进程挂死把 UI 锁在 logging_in
    void withTimeout(settled, LOGIN_WAIT_MS).then((outcome) => {
      if (outcome === null && !record.finished) {
        try {
          child.kill("SIGTERM");
        } catch {
          /* ignore */
        }
        record.finished = true;
        pending.delete(templateId);
        setAgentSdkState(userDataRoot, templateId, "not_logged_in", {
          lastError: "登录超时",
        });
      }
    });
    return {
      auth_url: authUrl,
      state: "logging_in",
      ...(record.deviceCode ? { device_code: record.deviceCode } : {}),
    };
  }

  const finished = await Promise.race([settled, withTimeout(settled, STATUS_TIMEOUT_MS)]);
  record.finished = true;
  if (finished === "done") {
    const label = readCodexAccountLabel(userDataRoot, templateId);
    return {
      auth_url: null,
      state: "ready",
      ...(label ? { account_label: label } : {}),
    };
  }
  return { auth_url: null, state: "not_logged_in" };
}

export async function checkCodexLogin(
  userDataRoot: string,
  templateId: string,
): Promise<LoginResult> {
  const active = pending.get(templateId);
  if (active && !active.finished) {
    // 子进程已死但 close 还没清 pending：避免 UI 永久卡在登录中
    const alive = active.child && !active.child.killed && active.child.exitCode === null;
    if (!alive && active.child) {
      active.finished = true;
      pending.delete(templateId);
      if (!hasCodexAuth(userDataRoot, templateId)) {
        setAgentSdkState(userDataRoot, templateId, "not_logged_in");
        return { auth_url: null, state: "not_logged_in" };
      }
    } else {
      return {
        auth_url: active.authUrl ?? null,
        state: "logging_in",
        ...(active.deviceCode ? { device_code: active.deviceCode } : {}),
      };
    }
  }

  if (hasCodexAuth(userDataRoot, templateId)) {
    const previous = agentSdkAccountLabel(userDataRoot, templateId);
    const label = readCodexAccountLabel(userDataRoot, templateId);
    setAgentSdkState(userDataRoot, templateId, "ready");
    setAgentSdkAccountLabel(userDataRoot, templateId, label);
    await syncModelsAfterLogin(userDataRoot, templateId, {
      accountChanged: Boolean(label) && label !== previous,
    });
    return { auth_url: null, state: "ready", ...(label ? { account_label: label } : {}) };
  }

  // 再问一次 CLI status（auth 文件偶发延迟）
  const status = await runCodexLoginStatus(userDataRoot, templateId);
  if (status) {
    const label = readCodexAccountLabel(userDataRoot, templateId);
    setAgentSdkState(userDataRoot, templateId, "ready");
    setAgentSdkAccountLabel(userDataRoot, templateId, label);
    await syncModelsAfterLogin(userDataRoot, templateId, {});
    return { auth_url: null, state: "ready", ...(label ? { account_label: label } : {}) };
  }

  setAgentSdkState(userDataRoot, templateId, "not_logged_in");
  return { auth_url: null, state: "not_logged_in" };
}

export async function logoutCodex(userDataRoot: string, templateId: string): Promise<void> {
  const active = pending.get(templateId);
  if (active?.child) {
    try {
      active.child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
  pending.delete(templateId);

  const cli = resolveCodexCliPath(userDataRoot, templateId);
  const home = ensureCodexHome(userDataRoot, templateId);
  if (cli) {
    await withTimeout(
      new Promise<void>((resolve) => {
        const child = spawn(cli, ["logout"], {
          env: codexCliEnv(home),
          stdio: "ignore",
        });
        child.on("close", () => resolve());
        child.on("error", () => resolve());
      }),
      5_000,
    );
  }
  clearCodexHomeAuth(userDataRoot, templateId);
  setAgentSdkState(userDataRoot, templateId, "not_logged_in");
  setAgentSdkModels(userDataRoot, templateId, []);
  setAgentSdkAccountLabel(userDataRoot, templateId, null);
}

export async function fetchCodexModels(
  userDataRoot: string,
  templateId: string,
): Promise<AgentSdkModel[]> {
  if (!hasCodexAuth(userDataRoot, templateId)) {
    throw new ConfigError("尚未登录 Codex");
  }
  const catalog = await runCodexDebugModels(userDataRoot, templateId);
  if (!catalog.length) return [...FALLBACK_MODELS];
  // 保留 default（不传 model）+ CLI 目录；无 credits
  return mergeWithDefault(catalog);
}

/** 解析 `codex debug models` stdout（可含前导噪声）；测例直接覆盖。 */
export function parseCodexDebugModels(stdout: string): AgentSdkModel[] {
  const jsonText = extractJsonObject(stdout);
  if (!jsonText) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    return [];
  }
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { models?: unknown }).models)
      ? ((raw as { models: unknown[] }).models)
      : [];
  const out: AgentSdkModel[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const record = item as {
      slug?: unknown;
      id?: unknown;
      model?: unknown;
      name?: unknown;
      display_name?: unknown;
      displayName?: unknown;
      visibility?: unknown;
    };
    // visibility=list 为 picker 可见；缺字段时照收（bundled / 旧格式）
    if (
      typeof record.visibility === "string" &&
      record.visibility.length > 0 &&
      record.visibility !== "list"
    ) {
      continue;
    }
    const id =
      (typeof record.slug === "string" && record.slug.trim()) ||
      (typeof record.id === "string" && record.id.trim()) ||
      (typeof record.model === "string" && record.model.trim()) ||
      "";
    if (!id || id === "default" || seen.has(id)) continue;
    const name =
      (typeof record.display_name === "string" && record.display_name.trim()) ||
      (typeof record.displayName === "string" && record.displayName.trim()) ||
      (typeof record.name === "string" && record.name.trim()) ||
      id;
    seen.add(id);
    out.push({ id, name });
    if (out.length >= MAX_AGENT_SDK_MODELS) break;
  }
  return out;
}

async function runCodexDebugModels(
  userDataRoot: string,
  templateId: string,
): Promise<AgentSdkModel[]> {
  const cli = resolveCodexCliPath(userDataRoot, templateId);
  if (!cli) return [];
  const home = ensureCodexHome(userDataRoot, templateId);
  const stdout = await withTimeout(
    new Promise<string>((resolve, reject) => {
      const child = spawn(cli, ["debug", "models"], {
        env: codexCliEnv(home),
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      let err = "";
      child.stdout?.on("data", (chunk: Buffer | string) => {
        out += String(chunk);
      });
      child.stderr?.on("data", (chunk: Buffer | string) => {
        err += String(chunk);
      });
      child.on("error", (error) => reject(error));
      child.on("close", (code) => {
        if (code === 0) {
          resolve(out || err);
          return;
        }
        reject(new Error(`codex debug models exited ${code ?? "?"}`));
      });
    }),
    MODEL_QUERY_TIMEOUT_MS,
  );
  if (stdout == null) return [];
  return parseCodexDebugModels(stdout);
}

function mergeWithDefault(catalog: AgentSdkModel[]): AgentSdkModel[] {
  const rest = catalog.filter((item) => item.id !== "default");
  return [...FALLBACK_MODELS, ...rest].slice(0, MAX_AGENT_SDK_MODELS);
}

/** stdout 可能夹杂日志；从首个 `{` 起截到匹配的 JSON 对象。 */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) {
    const arrayStart = text.indexOf("[");
    if (arrayStart < 0) return null;
    return text.slice(arrayStart).trim() || null;
  }
  const slice = text.slice(start);
  // 优先整段 parse；失败再尝试括号配对截断
  try {
    JSON.parse(slice);
    return slice;
  } catch {
    /* 继续配对 */
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < slice.length; i += 1) {
    const ch = slice[i]!;
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return slice.slice(0, i + 1);
    }
  }
  return null;
}

export async function refreshCodexModels(
  userDataRoot: string,
  templateId: string,
): Promise<AgentSdkModel[]> {
  const models = await fetchCodexModels(userDataRoot, templateId);
  setAgentSdkModels(userDataRoot, templateId, models);
  return models;
}

export async function ensureCodexModels(userDataRoot: string, templateId: string): Promise<void> {
  if (agentSdkModels(userDataRoot, templateId).length > 0) return;
  const last = lastModelAttempt.get(templateId) ?? 0;
  if (Date.now() - last < RETRY_COOLDOWN_MS) return;
  lastModelAttempt.set(templateId, Date.now());
  try {
    await refreshCodexModels(userDataRoot, templateId);
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
    await ensureCodexModels(userDataRoot, templateId);
    return;
  }
  setAgentSdkModels(userDataRoot, templateId, []);
  lastModelAttempt.delete(templateId);
  try {
    await refreshCodexModels(userDataRoot, templateId);
  } catch {
    /* 空着下次再试 */
  }
}

async function runCodexLoginStatus(
  userDataRoot: string,
  templateId: string,
): Promise<boolean> {
  const cli = resolveCodexCliPath(userDataRoot, templateId);
  if (!cli) return false;
  const home = ensureCodexHome(userDataRoot, templateId);
  const code = await withTimeout(
    new Promise<number | null>((resolve) => {
      const child = spawn(cli, ["login", "status"], {
        env: codexCliEnv(home),
        stdio: "ignore",
      });
      child.on("close", (exit) => resolve(exit));
      child.on("error", () => resolve(null));
    }),
    STATUS_TIMEOUT_MS,
  );
  return code === 0;
}

function codexCliEnv(home: string): NodeJS.ProcessEnv {
  // 最小环境：不继承 runtime 其它供应商明文 Key
  const pathKey = process.platform === "win32" ? "Path" : "PATH";
  return {
    CODEX_HOME: home,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    [pathKey]: process.env[pathKey] ?? process.env.PATH ?? "",
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
  };
}

function firstHttpUrl(text: string): string | null {
  // 去掉 ANSI 颜色后再找 URL
  const plain = text.replace(/\u001b\[[0-9;]*m/g, "");
  const match = plain.match(/https?:\/\/[^\s"'<>]+/i);
  if (!match) return null;
  return match[0].replace(/[),.;]+$/, "");
}

/** Codex device-auth：`WLVL-IWW3Y` 一类一次性码（非 URL） */
function firstDeviceCode(text: string): string | null {
  const plain = text.replace(/\u001b\[[0-9;]*m/g, "");
  const labeled = plain.match(
    /one-time code[^\n]*\n\s*([A-Z0-9]{4,8}(?:-[A-Z0-9]{3,8})+)\b/i,
  );
  if (labeled?.[1]) return labeled[1];
  const chinese = plain.match(/一次性[^\n]*\n\s*([A-Z0-9]{4,8}(?:-[A-Z0-9]{3,8})+)\b/);
  if (chinese?.[1]) return chinese[1];
  const loose = plain.match(/\b([A-Z0-9]{4,5}-[A-Z0-9]{4,6})\b/);
  return loose?.[1] ?? null;
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

function waitForDeviceCode(
  get: () => string | undefined,
  ms: number,
): Promise<string | null> {
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const code = get();
      if (code) {
        clearInterval(timer);
        resolve(code);
        return;
      }
      if (Date.now() - started > ms) {
        clearInterval(timer);
        resolve(null);
      }
    }, 50);
  });
}

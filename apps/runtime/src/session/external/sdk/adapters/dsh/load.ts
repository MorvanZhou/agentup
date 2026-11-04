import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { ConfigError } from "../../../../../config/load.js";
import { getProviderTemplate } from "../../../../../config/provider-templates.js";
import {
  agentSdkDir,
  readInstalledSdk,
} from "../../../../../config/providers/agent-sdk/installer.js";
import { ensureDshHome, readDshApiKey } from "./home.js";

/**
 * 从自管目录加载 @deepseek-ai/dsh-sdk-client，并解析同版本 dsh CLI。
 * 不查 PATH；不读用户 ~/.dsh。
 */

export type DshHarnessNotification = {
  method: string;
  params: Record<string, unknown>;
};

export type DshRunResult = {
  sessionId: string;
  finalResponse: string;
  finishReason: string | null;
  events?: unknown[];
  notifications?: DshHarnessNotification[];
};

export type DshHarness = {
  client: {
    start: () => void;
    onRequest: (
      handler: (method: string, params: unknown) => Promise<unknown> | unknown,
    ) => void;
  };
  start: () => Promise<void>;
  run: (
    input: string,
    options?: {
      sessionId?: string;
      onNotification?: (notification: DshHarnessNotification) => void;
    },
  ) => Promise<DshRunResult>;
  close: () => Promise<void>;
};

export type DshSdkModule = {
  DeepSeekHarness: new (options?: Record<string, unknown>) => DshHarness;
};

export async function loadDshModule(
  userDataRoot: string,
  templateId: string,
): Promise<DshSdkModule> {
  const template = getProviderTemplate(templateId);
  const profile = template?.agentSdk;
  if (!template || !profile) throw new ConfigError("该接入方式不支持本地调用");
  const dir = agentSdkDir(userDataRoot, templateId);
  const installed = readInstalledSdk(dir, profile.package);
  if (!installed) throw new ConfigError("尚未接入，请先开始接入");
  try {
    const entryUrl = resolveEsmEntryUrl(dir, profile.package);
    const loaded = (await import(entryUrl)) as DshSdkModule & {
      default?: DshSdkModule;
    };
    const module =
      typeof loaded.DeepSeekHarness === "function" ? loaded : loaded.default;
    if (!module || typeof module.DeepSeekHarness !== "function") {
      throw new ConfigError("DeepSeek Harness SDK 缺少 DeepSeekHarness");
    }
    return module;
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new ConfigError(
      `DeepSeek Harness SDK 无法加载：${error instanceof Error ? error.message : "未知原因"}`,
    );
  }
}

/** 安装目录内 dsh CLI 绝对路径；供 launch dshBin。 */
export function resolveDshCliPath(
  userDataRoot: string,
  templateId: string,
): string | null {
  const profile = getProviderTemplate(templateId)?.agentSdk;
  if (!profile) return null;
  const dir = agentSdkDir(userDataRoot, templateId);
  if (!readInstalledSdk(dir, profile.package)) return null;

  const candidates = [
    path.join(dir, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"),
    path.join(dir, "node_modules", "@deepseek-ai", "dsh", "bin", "dsh.js"),
    path.join(dir, "node_modules", ".bin", "dsh"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * 优先 package.exports["."].import；与 Copilot / Codex load 同策略。
 */
export function resolveEsmEntryUrl(installDir: string, packageName: string): string {
  const pkgDir = path.join(installDir, "node_modules", ...packageName.split("/"));
  const pkgJsonPath = path.join(pkgDir, "package.json");
  if (!fs.existsSync(pkgJsonPath)) {
    throw new ConfigError(`尚未找到已接入的 ${packageName}`);
  }
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as {
    exports?: unknown;
    module?: string;
    main?: string;
  };
  const rel = resolveExportRel(pkg.exports) ?? pkg.module ?? pkg.main ?? "lib/index.js";
  const absolute = path.resolve(pkgDir, rel);
  if (!fs.existsSync(absolute)) {
    throw new ConfigError(`${packageName} 缺少入口 ${rel}`);
  }
  return pathToFileURL(absolute).href;
}

function resolveExportRel(exportsField: unknown): string | undefined {
  if (typeof exportsField === "string") return exportsField;
  if (!exportsField || typeof exportsField !== "object" || Array.isArray(exportsField)) {
    return undefined;
  }
  const root = (exportsField as Record<string, unknown>)["."];
  if (typeof root === "string") return root;
  if (root && typeof root === "object" && !Array.isArray(root)) {
    const row = root as Record<string, unknown>;
    if (typeof row.import === "string") return row.import;
    if (typeof row.default === "string") return row.default;
  }
  return undefined;
}

/**
 * 子进程 env：整份替换，只留最小集合 + DEEPSEEK_API_KEY + DSH_HOME。
 * 不继承其它供应商明文 Key。
 */
export function dshChildEnv(
  userDataRoot: string,
  templateId: string,
  extras?: {
    systemPrompt?: string;
  },
): NodeJS.ProcessEnv {
  const home = ensureDshHome(userDataRoot, templateId);
  const apiKey = readDshApiKey(userDataRoot, templateId);
  if (!apiKey) throw new ConfigError("尚未登录 DeepSeek Harness（请先粘贴 API Key）");

  const pathKey = process.platform === "win32" ? "Path" : "PATH";
  const env: NodeJS.ProcessEnv = {
    DSH_HOME: home,
    DEEPSEEK_API_KEY: apiKey,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    TMPDIR: process.env.TMPDIR,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    [pathKey]: process.env[pathKey] ?? process.env.PATH ?? "",
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    // 代理 / SSL：厂商请求常经公网
    HTTPS_PROXY: process.env.HTTPS_PROXY,
    HTTP_PROXY: process.env.HTTP_PROXY,
    https_proxy: process.env.https_proxy,
    http_proxy: process.env.http_proxy,
    NO_PROXY: process.env.NO_PROXY,
    no_proxy: process.env.no_proxy,
    SSL_CERT_FILE: process.env.SSL_CERT_FILE,
    NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS,
  };
  const systemPrompt = extras?.systemPrompt?.trim();
  if (systemPrompt) env.DSH_SYSTEM_PROMPT = systemPrompt;
  return env;
}

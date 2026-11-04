import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { ConfigError } from "../../../../../config/load.js";
import { getProviderTemplate } from "../../../../../config/provider-templates.js";
import {
  agentSdkDir,
  readInstalledSdk,
} from "../../../../../config/providers/agent-sdk/installer.js";

/**
 * 从自管目录加载 @github/copilot-sdk，并解析捆绑的 copilot-runtime。
 * 不查 PATH；不读用户本机 ~/.copilot（凭据经 baseDirectory / gitHubToken）。
 */

export type CopilotSdkModule = {
  CopilotClient: new (options?: Record<string, unknown>) => CopilotSdkClient;
  approveAll: (request: unknown, invocation?: unknown) => unknown;
  RuntimeConnection?: {
    forStdio?: (options?: Record<string, unknown>) => unknown;
  };
};

export type CopilotSdkClient = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  getAuthStatus: () => Promise<unknown>;
  listModels: () => Promise<unknown>;
  createSession: (config?: Record<string, unknown>) => Promise<CopilotSdkSession>;
  ping?: () => Promise<unknown>;
};

export type CopilotSdkSession = {
  sessionId?: string;
  on: {
    (event: string, handler: (event: unknown) => void): unknown;
    (handler: (event: unknown) => void): unknown;
  };
  send: (options: Record<string, unknown>) => Promise<unknown>;
  sendAndWait?: (options: Record<string, unknown>) => Promise<unknown>;
  abort?: () => Promise<unknown> | unknown;
  disconnect: () => Promise<void>;
};

export async function loadCopilotModule(
  userDataRoot: string,
  templateId: string,
): Promise<CopilotSdkModule> {
  const template = getProviderTemplate(templateId);
  const profile = template?.agentSdk;
  if (!template || !profile) throw new ConfigError("该接入方式不支持本地调用");
  const dir = agentSdkDir(userDataRoot, templateId);
  const installed = readInstalledSdk(dir, profile.package);
  if (!installed) throw new ConfigError("尚未接入，请先开始接入");
  try {
    const entryUrl = resolveEsmEntryUrl(dir, profile.package);
    const loaded = (await import(entryUrl)) as CopilotSdkModule & {
      default?: CopilotSdkModule;
    };
    const module = unwrapModule(loaded);
    assertCopilotSurface(module);
    return module;
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new ConfigError(
      `GitHub Copilot SDK 无法加载：${error instanceof Error ? error.message : "未知原因"}`,
    );
  }
}

/** 安装目录内 copilot-runtime；供 COPILOT_CLI_PATH / 调试。 */
export function resolveCopilotCliPath(
  userDataRoot: string,
  templateId: string,
): string | null {
  const profile = getProviderTemplate(templateId)?.agentSdk;
  if (!profile) return null;
  const dir = agentSdkDir(userDataRoot, templateId);
  if (!readInstalledSdk(dir, profile.package)) return null;
  try {
    return findNativeCopilotRuntime(dir);
  } catch {
    return null;
  }
}

/**
 * 优先 package.exports["."].import；与 Codex / Cursor load 同策略。
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
  const rel = pickEsmRel(pkg) ?? "dist/index.js";
  const absolute = path.resolve(pkgDir, rel);
  if (!fs.existsSync(absolute)) {
    throw new ConfigError(`GitHub Copilot SDK 缺少入口：${rel}`);
  }
  return pathToFileURL(absolute).href;
}

function pickEsmRel(pkg: {
  exports?: unknown;
  module?: string;
  main?: string;
}): string | null {
  const exp = pkg.exports;
  if (exp && typeof exp === "object" && !Array.isArray(exp)) {
    const root = (exp as Record<string, unknown>)["."];
    if (typeof root === "string") return root;
    if (root && typeof root === "object" && !Array.isArray(root)) {
      const map = root as Record<string, unknown>;
      for (const key of ["import", "default", "node", "require"]) {
        const value = map[key];
        if (typeof value === "string") return value;
        if (value && typeof value === "object" && !Array.isArray(value)) {
          const nested = value as Record<string, unknown>;
          if (typeof nested.default === "string") return nested.default;
          if (typeof nested.import === "string") return nested.import;
        }
      }
    }
  }
  if (typeof pkg.module === "string") return pkg.module;
  if (typeof pkg.main === "string") return pkg.main;
  return null;
}

function unwrapModule(
  loaded: CopilotSdkModule & { default?: CopilotSdkModule },
): CopilotSdkModule {
  if (typeof loaded.CopilotClient === "function") return loaded;
  if (loaded.default && typeof loaded.default.CopilotClient === "function") {
    return loaded.default;
  }
  return loaded;
}

function assertCopilotSurface(module: CopilotSdkModule): void {
  if (typeof module.CopilotClient !== "function") {
    throw new ConfigError("GitHub Copilot SDK 缺少 CopilotClient");
  }
  if (typeof module.approveAll !== "function") {
    throw new ConfigError("GitHub Copilot SDK 缺少 approveAll");
  }
}

/** 对齐 SDK runtimeArtifacts：@github/copilot-sdk-<platform>/prebuilds/.../copilot-runtime */
export function findNativeCopilotRuntime(installDir: string): string {
  const platform = runtimePlatformOf(process.platform, process.arch);
  if (!platform) {
    throw new ConfigError(
      `GitHub Copilot 不支持当前平台：${process.platform}/${process.arch}`,
    );
  }
  const packageName = `@github/copilot-sdk-${platform}`;
  const require = createRequire(path.join(installDir, "agentup-require.cjs"));
  let packageRoot: string;
  try {
    const pkgJson = require.resolve(`${packageName}/package.json`);
    packageRoot = path.dirname(pkgJson);
  } catch {
    throw new ConfigError(
      "找不到 Copilot CLI runtime（请确认安装时拉下了 optionalDependencies）",
    );
  }
  const binaryName = platform.startsWith("win32")
    ? "copilot-runtime.exe"
    : "copilot-runtime";
  const binary = path.join(packageRoot, "prebuilds", platform, binaryName);
  if (!fs.existsSync(binary)) {
    throw new ConfigError(`找不到 ${platform} 的 Copilot runtime：${binaryName}`);
  }
  return binary;
}

export function runtimePlatformOf(
  platform: string,
  arch: string,
  musl = isMusl(),
): string | null {
  if (arch !== "x64" && arch !== "arm64") return null;
  if (platform === "linux") return `${musl ? "linuxmusl" : "linux"}-${arch}`;
  if (platform === "darwin" || platform === "win32") return `${platform}-${arch}`;
  return null;
}

function isMusl(): boolean {
  if (process.platform !== "linux") return false;
  const report = process.report?.getReport() as
    | { header?: { glibcVersionRuntime?: string } }
    | undefined;
  return report?.header?.glibcVersionRuntime === undefined;
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(null);
      });
  });
}

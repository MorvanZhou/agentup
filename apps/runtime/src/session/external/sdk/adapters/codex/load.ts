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
 * 从自管目录加载 @openai/codex-sdk，并解析捆绑的原生 CLI 路径。
 * 不查 PATH；不读用户本机 ~/.codex。
 */

export type CodexSdkModule = {
  Codex: new (options?: Record<string, unknown>) => CodexSdkClient;
};

export type CodexSdkClient = {
  startThread: (options?: Record<string, unknown>) => CodexSdkThread;
  resumeThread: (id: string, options?: Record<string, unknown>) => CodexSdkThread;
};

export type CodexSdkThread = {
  readonly id: string | null;
  runStreamed: (
    input: string | unknown[],
    turnOptions?: Record<string, unknown>,
  ) => Promise<{ events: AsyncIterable<unknown> }>;
  run: (
    input: string | unknown[],
    turnOptions?: Record<string, unknown>,
  ) => Promise<CodexRunResult>;
};

export type CodexRunResult = {
  items: unknown[];
  finalResponse: string;
  usage: CodexUsage | null;
};

export type CodexUsage = {
  input_tokens?: number;
  cached_input_tokens?: number;
  cache_write_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
};

const PLATFORM_PACKAGE_BY_TARGET: Record<string, string> = {
  "x86_64-unknown-linux-musl": "@openai/codex-linux-x64",
  "aarch64-unknown-linux-musl": "@openai/codex-linux-arm64",
  "x86_64-apple-darwin": "@openai/codex-darwin-x64",
  "aarch64-apple-darwin": "@openai/codex-darwin-arm64",
  "x86_64-pc-windows-msvc": "@openai/codex-win32-x64",
  "aarch64-pc-windows-msvc": "@openai/codex-win32-arm64",
};

export async function loadCodexModule(
  userDataRoot: string,
  templateId: string,
): Promise<CodexSdkModule> {
  const template = getProviderTemplate(templateId);
  const profile = template?.agentSdk;
  if (!template || !profile) throw new ConfigError("该接入方式不支持本地调用");
  const dir = agentSdkDir(userDataRoot, templateId);
  const installed = readInstalledSdk(dir, profile.package);
  if (!installed) throw new ConfigError("尚未安装，请先开始接入");
  try {
    const entryUrl = resolveEsmEntryUrl(dir, profile.package);
    const loaded = (await import(entryUrl)) as CodexSdkModule & { default?: CodexSdkModule };
    const module = unwrapModule(loaded);
    assertCodexSurface(module);
    return module;
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new ConfigError(
      `Codex SDK 无法加载：${error instanceof Error ? error.message : "未知原因"}`,
    );
  }
}

/** 安装目录内原生 `codex` 可执行文件；登录 / PathOverride 共用。 */
export function resolveCodexCliPath(userDataRoot: string, templateId: string): string | null {
  const profile = getProviderTemplate(templateId)?.agentSdk;
  if (!profile) return null;
  const dir = agentSdkDir(userDataRoot, templateId);
  if (!readInstalledSdk(dir, profile.package)) return null;
  try {
    return findNativeCodexBinary(dir);
  } catch {
    return null;
  }
}

/**
 * 优先 package.exports["."].import；与 Cursor load 同策略。
 */
export function resolveEsmEntryUrl(installDir: string, packageName: string): string {
  const pkgDir = path.join(installDir, "node_modules", ...packageName.split("/"));
  const pkgJsonPath = path.join(pkgDir, "package.json");
  if (!fs.existsSync(pkgJsonPath)) {
    throw new ConfigError(`尚未找到已安装的 ${packageName}`);
  }
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as {
    exports?: unknown;
    module?: string;
    main?: string;
  };
  const rel = pickEsmRel(pkg) ?? "dist/index.js";
  const absolute = path.resolve(pkgDir, rel);
  if (!fs.existsSync(absolute)) {
    throw new ConfigError(`Codex SDK 缺少入口：${rel}`);
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

function unwrapModule(loaded: CodexSdkModule & { default?: CodexSdkModule }): CodexSdkModule {
  if (typeof loaded.Codex === "function") return loaded;
  if (loaded.default && typeof loaded.default.Codex === "function") return loaded.default;
  return loaded;
}

function assertCodexSurface(module: CodexSdkModule): void {
  if (typeof module.Codex !== "function") {
    throw new ConfigError("Codex SDK 缺少 Codex 构造器");
  }
}

/** 对齐 SDK 内部 findCodexPath：解析 optionalDependencies 里的平台包。 */
export function findNativeCodexBinary(installDir: string): string {
  const target = targetTripleOf(process.platform, process.arch);
  if (!target) {
    throw new ConfigError(`Codex 不支持当前平台：${process.platform}/${process.arch}`);
  }
  const platformPackage = PLATFORM_PACKAGE_BY_TARGET[target];
  if (!platformPackage) {
    throw new ConfigError(`Codex 缺少平台包映射：${target}`);
  }
  const require = createRequire(path.join(installDir, "agentup-require.cjs"));
  let vendorRoot: string;
  try {
    // @openai/codex-sdk 依赖 @openai/codex；从安装根解析
    const codexPkgJson = require.resolve("@openai/codex/package.json");
    const codexRequire = createRequire(codexPkgJson);
    const platformPkgJson = codexRequire.resolve(`${platformPackage}/package.json`);
    vendorRoot = path.join(path.dirname(platformPkgJson), "vendor");
  } catch {
    throw new ConfigError(
      "找不到 Codex CLI 原生二进制（请确认安装时拉下了 optionalDependencies）",
    );
  }
  const binaryName = process.platform === "win32" ? "codex.exe" : "codex";
  const modern = path.join(vendorRoot, target, "bin", binaryName);
  if (fs.existsSync(modern)) return modern;
  const legacy = path.join(vendorRoot, target, "codex", binaryName);
  if (fs.existsSync(legacy)) return legacy;
  throw new ConfigError(`找不到 ${target} 的 Codex 可执行文件`);
}

function targetTripleOf(platform: string, arch: string): string | null {
  if (platform === "linux" || platform === "android") {
    if (arch === "x64") return "x86_64-unknown-linux-musl";
    if (arch === "arm64") return "aarch64-unknown-linux-musl";
    return null;
  }
  if (platform === "darwin") {
    if (arch === "x64") return "x86_64-apple-darwin";
    if (arch === "arm64") return "aarch64-apple-darwin";
    return null;
  }
  if (platform === "win32") {
    if (arch === "x64") return "x86_64-pc-windows-msvc";
    if (arch === "arm64") return "aarch64-pc-windows-msvc";
    return null;
  }
  return null;
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

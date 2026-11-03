import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { ConfigError } from "../../../../../config/load.js";
import { getProviderTemplate } from "../../../../../config/provider-templates.js";
import {
  agentSdkDir,
  readInstalledSdk,
} from "../../../../../config/providers/agent-sdk/installer.js";
import { ensureCursorRipgrepPath } from "./ripgrep.js";

/**
 * 从自管目录加载 @cursor/sdk（不查 PATH / 不读 IDE 安装）。
 * 要求 Node ≥ 22.13（包 engines）。
 *
 * 注意：必须走 package exports 的 **import（ESM）** 入口。
 * `require.resolve` 默认落到 CJS 大包，再用 `import()` 时部分类不是 constructor
 * （曾出现 FileCredentialStore is not a constructor）。
 */

/** 鸭子类型：只取我们用到的导出，避免绑死 SDK 版本。 */
export type CursorSdkModule = {
  Agent: {
    create: (options: Record<string, unknown>) => Promise<CursorSdkAgent>;
  };
  Cursor: {
    auth: {
      login: (options?: Record<string, unknown>) => Promise<CursorLoginResult>;
      logout: (options?: Record<string, unknown>) => Promise<void>;
      status: (options?: Record<string, unknown>) => Promise<CursorAuthStatus>;
    };
    models: {
      list: (options?: Record<string, unknown>) => Promise<unknown>;
    };
  };
  /** 可能缺失：我们优先自管凭据，不强制依赖 */
  FileCredentialStore?: new (filePath?: string) => CursorCredentialStore;
  JsonlLocalAgentStore: new (dir: string) => unknown;
  InMemoryCredentialStore?: new () => CursorCredentialStore;
};

export type CursorCredentialStore = {
  load: () => Promise<CursorStoredCredentials | null | undefined>;
  save: (credentials: CursorStoredCredentials) => Promise<void>;
  clear: () => Promise<void>;
};

export type CursorStoredCredentials = {
  version: 1;
  backendUrl: string;
  apiKey: string;
  apiKeyExpiresAtMs?: number;
  email?: string;
  createdAtMs: number;
};

export type CursorLoginResult = {
  apiKey: string;
  email?: string;
  apiKeyExpiresAtMs: number;
};

export type CursorAuthStatus =
  | { status: "logged-out" }
  | { status: "logged-in"; backendUrl: string; email?: string; apiKeyExpiresAtMs?: number };

export type CursorSdkAgent = {
  agentId?: string;
  send: (
    prompt: string | Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => Promise<CursorSdkRun>;
  close: () => Promise<void> | void;
  [Symbol.asyncDispose]?: () => Promise<void>;
};

export type CursorSdkRun = {
  stream: () => AsyncIterable<unknown>;
  wait: () => Promise<CursorRunResult>;
  cancel: () => Promise<void> | void;
  status?: string;
};

export type CursorRunResult = {
  status: "finished" | "error" | "cancelled";
  result?: string;
  error?: { message?: string; code?: string };
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  durationMs?: number;
};

export async function loadCursorModule(
  userDataRoot: string,
  templateId: string,
): Promise<CursorSdkModule> {
  assertNodeVersion();
  const template = getProviderTemplate(templateId);
  const profile = template?.agentSdk;
  if (!template || !profile) throw new ConfigError("该接入方式不支持本地调用");
  const dir = agentSdkDir(userDataRoot, templateId);
  const installed = readInstalledSdk(dir, profile.package);
  if (!installed) throw new ConfigError("尚未安装，请先开始接入");
  // Electron 入口找不到平台包旁的 rg；Agent.create 前写入 CURSOR_RIPGREP_PATH
  ensureCursorRipgrepPath(dir);
  try {
    const entryUrl = resolveEsmEntryUrl(dir, profile.package);
    const loaded = (await import(entryUrl)) as CursorSdkModule & { default?: CursorSdkModule };
    const module = unwrapModule(loaded);
    assertCursorSurface(module);
    return module;
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new ConfigError(
      `Cursor SDK 无法加载：${error instanceof Error ? error.message : "未知原因"}`,
    );
  }
}

/**
 * 优先 package.exports["."].import，避免 CJS 大包被 dynamic import 后丢构造器。
 * 直接读安装目录里的 package.json——`exports` 常不暴露 `./package.json`，
 * 不能 `require.resolve('@cursor/sdk/package.json')`。
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
  const rel = pickEsmRel(pkg) ?? "dist/esm/index.js";
  const absolute = path.resolve(pkgDir, rel);
  if (!fs.existsSync(absolute)) {
    throw new ConfigError(`Cursor SDK 缺少 ESM 入口：${rel}`);
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
      for (const key of ["import", "default", "node"]) {
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
  return null;
}

function unwrapModule(loaded: CursorSdkModule & { default?: CursorSdkModule }): CursorSdkModule {
  if (loaded.Agent && loaded.Cursor) return loaded;
  if (loaded.default?.Agent && loaded.default?.Cursor) return loaded.default;
  return loaded;
}

function assertCursorSurface(module: CursorSdkModule): void {
  if (!module.Agent || typeof module.Agent.create !== "function") {
    throw new ConfigError("Cursor SDK 缺少 Agent.create");
  }
  if (!module.Cursor?.auth?.login || !module.Cursor?.models?.list) {
    throw new ConfigError("Cursor SDK 缺少 Cursor.auth / Cursor.models");
  }
  if (typeof module.JsonlLocalAgentStore !== "function") {
    throw new ConfigError("Cursor SDK 缺少 JsonlLocalAgentStore（请确认走 ESM 入口）");
  }
}

function assertNodeVersion(): void {
  const [major, minor] = process.versions.node.split(".").map((part) => Number(part));
  if ((major ?? 0) < 22 || ((major ?? 0) === 22 && (minor ?? 0) < 13)) {
    throw new ConfigError(
      `Cursor SDK 需要 Node.js ≥ 22.13（当前 ${process.versions.node}）`,
    );
  }
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

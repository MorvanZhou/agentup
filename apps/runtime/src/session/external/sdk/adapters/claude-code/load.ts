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
 * 从自管目录加载 @anthropic-ai/claude-agent-sdk（不查 PATH）。
 * 平台 native CLI 在 optionalDeps；缺失时由调用方传 pathToClaudeCodeExecutable。
 */

export type ClaudeQuery = (params: {
  prompt: string;
  options?: Record<string, unknown>;
}) => AsyncIterable<unknown>;

export interface ClaudeAgentSdkModule {
  query?: ClaudeQuery;
}

export function loadClaudeModule(
  userDataRoot: string,
  templateId: string,
): Promise<ClaudeAgentSdkModule> {
  const template = getProviderTemplate(templateId);
  const profile = template?.agentSdk;
  if (!template || !profile) throw new ConfigError("该接入方式不支持本地调用");
  const dir = agentSdkDir(userDataRoot, templateId);
  const installed = readInstalledSdk(dir, profile.package);
  if (!installed) throw new ConfigError("尚未接入，请先开始接入");
  try {
    const require = createRequire(path.join(dir, "agentup-require.cjs"));
    const entry = require.resolve(profile.package);
    return import(pathToFileURL(entry).href) as Promise<ClaudeAgentSdkModule>;
  } catch (error) {
    throw new ConfigError(
      `Claude Agent SDK 无法加载：${error instanceof Error ? error.message : "未知原因"}`,
    );
  }
}

/**
 * 安装目录内 Claude Code native CLI 绝对路径。
 * optionalDeps 包名形如 @anthropic-ai/claude-agent-sdk-<platform>-<arch>。
 */
export function resolveClaudeCliPath(
  userDataRoot: string,
  templateId: string,
): string | null {
  const profile = getProviderTemplate(templateId)?.agentSdk;
  if (!profile) return null;
  const dir = agentSdkDir(userDataRoot, templateId);
  if (!readInstalledSdk(dir, profile.package)) return null;

  const platformPkg = claudePlatformPackageName();
  const candidates = [
    path.join(dir, "node_modules", platformPkg, "claude"),
    path.join(dir, "node_modules", platformPkg, "claude.exe"),
    path.join(dir, "node_modules", ".bin", "claude"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function claudePlatformPackageName(): string {
  const platform = process.platform;
  const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x64" : process.arch;
  // Linux musl 与 glibc 分包装；粗检：存在 musl 特征则用 musl 包名
  if (platform === "linux") {
    const musl = fs.existsSync("/etc/alpine-release") || detectMusl();
    return `@anthropic-ai/claude-agent-sdk-linux-${arch}${musl ? "-musl" : ""}`;
  }
  if (platform === "darwin") {
    return `@anthropic-ai/claude-agent-sdk-darwin-${arch}`;
  }
  if (platform === "win32") {
    return `@anthropic-ai/claude-agent-sdk-win32-${arch}`;
  }
  return `@anthropic-ai/claude-agent-sdk-${platform}-${arch}`;
}

function detectMusl(): boolean {
  try {
    return fs.readFileSync("/proc/self/maps", "utf8").includes("musl");
  } catch {
    return false;
  }
}

/** 登录 / 查模型没有 timeout 参数，未登录会挂起 → 外层掐断。 */
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

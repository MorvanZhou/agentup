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
 * 从自管目录加载 CodeBuddy SDK（不查 PATH）。
 */

export interface CodebuddySession {
  getAvailableModels?: () => Promise<unknown>;
  getAvailableModelsRaw?: () => Promise<unknown>;
  close?: () => void;
}

export type CodebuddyQuery = (params: {
  prompt: string;
  options?: Record<string, unknown>;
}) => AsyncIterable<unknown>;

export interface CodebuddyModule {
  unstable_v2_authenticate?: (options: Record<string, unknown>) => Promise<unknown>;
  unstable_v2_logout?: (options?: Record<string, unknown>) => Promise<void>;
  unstable_v2_createSession?: (options: Record<string, unknown>) => CodebuddySession;
  query?: CodebuddyQuery;
}

/** 旧名兼容：设置页 / 测例仍可能写 AgentSdkModule */
export type AgentSdkModule = CodebuddyModule;
export type AgentSdkQuery = CodebuddyQuery;
export type AgentSdkSession = CodebuddySession;

export function loadCodebuddyModule(userDataRoot: string, templateId: string): Promise<CodebuddyModule> {
  const template = getProviderTemplate(templateId);
  const profile = template?.agentSdk;
  if (!template || !profile) throw new ConfigError("该接入方式不支持本地调用");
  const dir = agentSdkDir(userDataRoot, templateId);
  const installed = readInstalledSdk(dir, profile.package);
  if (!installed) throw new ConfigError("尚未接入，请先开始接入");
  try {
    const require = createRequire(path.join(dir, "agentup-require.cjs"));
    const entry = require.resolve(profile.package);
    return import(pathToFileURL(entry).href) as Promise<CodebuddyModule>;
  } catch (error) {
    throw new ConfigError(
      `本地 SDK 无法加载：${error instanceof Error ? error.message : "未知原因"}`,
    );
  }
}

/** @deprecated 兼容旧 loader 名；新代码用 loadCodebuddyModule */
export const loadAgentSdkModule = loadCodebuddyModule;

export function installedCliPath(userDataRoot: string, templateId: string): string | null {
  const profile = getProviderTemplate(templateId)?.agentSdk;
  if (!profile) return null;
  return readInstalledSdk(agentSdkDir(userDataRoot, templateId), profile.package)?.cliPath ?? null;
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

import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { ConfigError } from "../../load.js";
import { getProviderTemplate } from "../../provider-templates.js";
import { agentSdkDir, readInstalledSdk } from "./installer.js";

/**
 * 从自管目录加载已安装的本地 SDK（不查 PATH，不依赖全局安装）。
 * 登录与查模型都要走这里，避免两处各写一份 require 逻辑。
 */

/** SDK 暴露面只取我们用到的部分，避免被类型定义绑死版本。 */
export interface AgentSdkSession {
  getAvailableModels?: () => Promise<unknown>;
  /** 完整目录：带 credits 倍率、上下文上限、描述等；简版只有 {modelId, name} */
  getAvailableModelsRaw?: () => Promise<unknown>;
  close?: () => void;
}

/** 一次性的整回合调用：`query({ prompt, options })` 产出消息流。 */
export type AgentSdkQuery = (params: {
  prompt: string;
  options?: Record<string, unknown>;
}) => AsyncIterable<unknown>;

export interface AgentSdkModule {
  unstable_v2_authenticate?: (options: Record<string, unknown>) => Promise<unknown>;
  unstable_v2_logout?: (options?: Record<string, unknown>) => Promise<void>;
  unstable_v2_createSession?: (options: Record<string, unknown>) => AgentSdkSession;
  /** 缺了它就没法跑任务：阶段 2 的执行入口。 */
  query?: AgentSdkQuery;
}

export function loadAgentSdkModule(userDataRoot: string, templateId: string): Promise<AgentSdkModule> {
  const template = getProviderTemplate(templateId);
  const profile = template?.agentSdk;
  if (!template || !profile) throw new ConfigError("该接入方式不支持本地调用");
  const dir = agentSdkDir(userDataRoot, templateId);
  const installed = readInstalledSdk(dir, profile.package);
  if (!installed) throw new ConfigError("尚未安装，请先开始接入");
  try {
    const require = createRequire(path.join(dir, "agentup-require.cjs"));
    const entry = require.resolve(profile.package);
    return import(pathToFileURL(entry).href) as Promise<AgentSdkModule>;
  } catch (error) {
    throw new ConfigError(
      `本地 SDK 无法加载：${error instanceof Error ? error.message : "未知原因"}`,
    );
  }
}

/** 安装目录内的 CLI 入口；交给 SDK 起子进程，避免吃到用户 PATH 上的 node。 */
export function installedCliPath(userDataRoot: string, templateId: string): string | null {
  const profile = getProviderTemplate(templateId)?.agentSdk;
  if (!profile) return null;
  return readInstalledSdk(agentSdkDir(userDataRoot, templateId), profile.package)?.cliPath ?? null;
}

/** SDK 的登录 / 查模型都没有 timeout 参数，未登录时会一直挂着 → 统一外层掐断。 */
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

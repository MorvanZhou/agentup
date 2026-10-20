import os from "node:os";
import path from "node:path";

import type { ProviderTemplateKind } from "./provider-templates.js";

export interface ModelConfig {
  providerId: string;
  templateId: string;
  modelId: string;
  apiKey: string;
  baseUrl?: string;
  kind: ProviderTemplateKind;
  profileId?: string;
}

export interface RuntimeConfig {
  backendUrl: string;
  userDataRoot: string;
  model: ModelConfig;
}

export interface LocalConfig {
  backendUrl: string;
  userDataRoot: string;
  host: string;
  port: number;
}

export class ConfigError extends Error {}

const DEFAULTS = {
  AGENTUP_BACKEND_URL: "http://127.0.0.1:8787",
} as const;

export function loadLocalConfig(env: NodeJS.ProcessEnv = process.env): LocalConfig {
  const host = read(env, "AGENTUP_RUNTIME_HOST", "127.0.0.1");
  if (host !== "127.0.0.1") throw new ConfigError("AGENTUP_RUNTIME_HOST 只能是 127.0.0.1");
  const port = Number(read(env, "AGENTUP_RUNTIME_PORT", "47391"));
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new ConfigError("AGENTUP_RUNTIME_PORT 无效");
  return {
    backendUrl: read(env, "AGENTUP_BACKEND_URL", DEFAULTS.AGENTUP_BACKEND_URL),
    userDataRoot: resolveDataRoot(read(env, "AGENTUP_USER_DATA_ROOT", defaultUserDataRoot())),
    host,
    port,
  };
}

export function defaultUserDataRoot(): string {
  return path.join(os.homedir(), ".agentup");
}

function read(env: NodeJS.ProcessEnv, name: string, fallback = ""): string {
  const value = env[name];
  if (value?.trim()) return value.trim();
  return fallback;
}

function resolveDataRoot(raw: string): string {
  if (path.isAbsolute(raw)) return raw;
  return path.resolve(os.homedir(), raw);
}

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn, type SpawnOptions } from "node:child_process";

import { ConfigError } from "../../../../../config/load.js";
import { getProviderTemplate } from "../../../../../config/provider-templates.js";
import {
  agentSdkDir,
  readInstalledSdk,
} from "../../../../../config/providers/agent-sdk/installer.js";
import { ensureHome } from "./home.js";

export type OpencodeSdkClient = {
  auth: { set(parameters: Record<string, unknown>): Promise<unknown> };
  config: { providers(parameters?: Record<string, unknown>): Promise<unknown> };
  event: {
    subscribe(parameters?: Record<string, unknown>): Promise<{ stream: AsyncIterable<unknown> }>;
  };
  question: { reply(parameters: Record<string, unknown>): Promise<unknown> };
  permission: { reply(parameters: Record<string, unknown>): Promise<unknown> };
  session: {
    create(parameters?: Record<string, unknown>): Promise<unknown>;
    delete(parameters: Record<string, unknown>): Promise<unknown>;
    abort(parameters: Record<string, unknown>): Promise<unknown>;
    promptAsync(parameters: Record<string, unknown>): Promise<unknown>;
  };
};

export type OpencodeSdkModule = {
  createOpencodeClient(options?: Record<string, unknown>): OpencodeSdkClient;
};

export function resolveOpencodeCliPath(
  userDataRoot: string,
  templateId: string,
): string | null {
  const profile = getProviderTemplate(templateId)?.agentSdk;
  if (!profile) return null;
  const installDir = agentSdkDir(userDataRoot, templateId);
  if (!readInstalledSdk(installDir, profile.package)) return null;

  // postinstall 会把当前平台二进制硬链到主包 bin/opencode.exe（macOS 也沿用该文件名）。
  const wrapper = path.join(installDir, "node_modules", "opencode-ai", "bin", "opencode.exe");
  if (fs.existsSync(wrapper)) return wrapper;

  const platform = process.platform === "win32" ? "windows" : process.platform;
  const suffix = process.platform === "win32" ? "opencode.exe" : "opencode";
  const candidates = [
    `opencode-${platform}-${process.arch}`,
    `opencode-${platform}-${process.arch}-baseline`,
  ];
  for (const packageName of candidates) {
    const candidate = path.join(
      installDir,
      "node_modules",
      packageName,
      "bin",
      suffix,
    );
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export async function loadOpencodeSdkModule(
  userDataRoot: string,
  templateId: string,
): Promise<OpencodeSdkModule> {
  const installDir = agentSdkDir(userDataRoot, templateId);
  const entry = resolveOpencodeSdkEntry(installDir);
  try {
    const loaded = (await import(entry)) as OpencodeSdkModule & {
      default?: OpencodeSdkModule;
    };
    const module =
      typeof loaded.createOpencodeClient === "function" ? loaded : loaded.default;
    if (!module || typeof module.createOpencodeClient !== "function") {
      throw new ConfigError("OpenCode SDK 缺少 createOpencodeClient");
    }
    return module;
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new ConfigError(
      `OpenCode SDK 无法加载：${error instanceof Error ? error.message : "未知原因"}`,
    );
  }
}

export function resolveOpencodeSdkEntry(installDir: string): string {
  const packageDir = path.join(installDir, "node_modules", "@opencode-ai", "sdk");
  const packageJson = path.join(packageDir, "package.json");
  if (!fs.existsSync(packageJson)) throw new ConfigError("尚未找到已接入的 OpenCode SDK");
  const parsed = JSON.parse(fs.readFileSync(packageJson, "utf8")) as {
    exports?: Record<string, unknown>;
  };
  const v2 = parsed.exports?.["./v2"];
  const rel =
    typeof v2 === "string"
      ? v2
      : v2 && typeof v2 === "object" && !Array.isArray(v2)
        ? ((v2 as Record<string, unknown>).import as string | undefined)
        : undefined;
  const absolute = path.resolve(packageDir, rel ?? "dist/v2/index.js");
  if (!fs.existsSync(absolute)) throw new ConfigError("OpenCode SDK 缺少 v2 入口");
  return pathToFileURL(absolute).href;
}

export function opencodeEnv(userDataRoot: string, templateId: string): NodeJS.ProcessEnv {
  const home = ensureHome(userDataRoot, templateId);
  const pathKey = process.platform === "win32" ? "Path" : "PATH";
  return {
    OPENCODE_DATA_DIR: path.join(home, "data"),
    OPENCODE_CONFIG_DIR: path.join(home, "config"),
    XDG_DATA_HOME: path.join(home, "xdg-data"),
    XDG_CONFIG_HOME: path.join(home, "config"),
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    [pathKey]: process.env[pathKey] ?? process.env.PATH ?? "",
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
  };
}

export function spawnOpencode(
  userDataRoot: string,
  templateId: string,
  args: string[],
  options: Omit<SpawnOptions, "env"> & { env?: NodeJS.ProcessEnv } = {},
) {
  const cli = resolveOpencodeCliPath(userDataRoot, templateId);
  if (!cli) throw new ConfigError("找不到 OpenCode CLI，请重新安装");
  return spawn(cli, args, {
    ...options,
    env: { ...opencodeEnv(userDataRoot, templateId), ...options.env },
    windowsHide: true,
  });
}

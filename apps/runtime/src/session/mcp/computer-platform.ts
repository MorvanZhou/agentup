import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { McpServerEntry } from "@earendil-works/pi-coding-agent";

import { resolveNpmRunner } from "../../config/npm-runner.js";

/** 平台 Computer Use MCP 名（本机桌面 AX；强制 deferred）。 */
export const COMPUTER_MCP_NAME = "computer";

/**
 * 钉版本，避免 latest 漂移。
 * 与本机 spike（Calculator AX 闭环）对齐的 npm 发行。
 */
export const COMPUTER_MCP_PACKAGE = "open-computer-use@1.1.3";

/** 包名（不含版本），用于 node_modules 路径。 */
export const COMPUTER_MCP_PACKAGE_NAME = "open-computer-use";

/** 钉死版本号，写入 `.agentup-ready` 便于升级重装。 */
export const COMPUTER_MCP_VERSION = "1.1.3";

const HERE = path.dirname(fileURLToPath(import.meta.url));

let installPromise: Promise<void> | null = null;

/** `<userDataRoot>/runtime/open-computer-use`：AgentUp 自管安装前缀。 */
export function computerInstallDir(userDataRoot: string): string {
  return path.join(userDataRoot, "runtime", "open-computer-use");
}

/** 已安装 CLI：`node_modules/open-computer-use/bin/open-computer-use`。 */
export function computerCliPath(userDataRoot: string): string {
  return path.join(
    computerInstallDir(userDataRoot),
    "node_modules",
    COMPUTER_MCP_PACKAGE_NAME,
    "bin",
    "open-computer-use",
  );
}

/** MCP 启动器：先 ensure 安装，再 exec CLI `mcp`（避免首用竞态）。 */
export function computerMcpLaunchPath(): string {
  return path.join(HERE, "computer-mcp-launch.js");
}

function readyMarkerPath(userDataRoot: string): string {
  return path.join(computerInstallDir(userDataRoot), ".agentup-ready");
}

/** 盘上已是钉版且 CLI 存在。 */
export function isComputerUseInstalled(userDataRoot: string): boolean {
  const ready = readyMarkerPath(userDataRoot);
  if (!fs.existsSync(ready)) return false;
  try {
    const version = fs.readFileSync(ready, "utf8").trim();
    if (version !== COMPUTER_MCP_VERSION) return false;
  } catch {
    return false;
  }
  return fs.existsSync(computerCliPath(userDataRoot));
}

/**
 * 用 AgentUp 钉版 npm 装到 `<userDataRoot>/runtime/open-computer-use`。
 * 临时目录构建 → 自检 → 原子 rename；失败可重试。
 */
export function ensureComputerUseInstalled(userDataRoot: string): Promise<void> {
  if (installPromise) return installPromise;
  installPromise = (async () => {
    if (isComputerUseInstalled(userDataRoot)) return;
    await installComputerUse(userDataRoot);
  })().catch((error) => {
    installPromise = null;
    throw error;
  });
  return installPromise;
}

/** 单测可清掉 in-flight Promise。 */
export function resetComputerUseInstallForTests(): void {
  installPromise = null;
}

async function installComputerUse(userDataRoot: string): Promise<void> {
  const runner = resolveNpmRunner();
  if (!runner) {
    throw new Error("无法定位 npm（需要 AgentUp 钉版 npm 或系统 Node 旁的 npm-cli.js）");
  }

  const target = computerInstallDir(userDataRoot);
  const tmp = path.join(
    path.dirname(target),
    `open-computer-use.tmp-${randomUUID()}`,
  );
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(
    path.join(tmp, "package.json"),
    `${JSON.stringify({ name: "agentup-computer-use", version: "1.0.0", private: true }, null, 2)}\n`,
  );

  try {
    await runNpmInstall(runner, tmp);
    const cli = path.join(
      tmp,
      "node_modules",
      COMPUTER_MCP_PACKAGE_NAME,
      "bin",
      "open-computer-use",
    );
    if (!fs.existsSync(cli)) {
      throw new Error("open-computer-use 安装完成但未找到 CLI，已回滚");
    }

    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(tmp, target);
    fs.writeFileSync(readyMarkerPath(userDataRoot), `${COMPUTER_MCP_VERSION}\n`, "utf8");
  } catch (error) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw error;
  }
}

function runNpmInstall(
  runner: { command: string; args: string[] },
  prefix: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const execDir = path.dirname(runner.command);
    const env = {
      ...process.env,
      PATH: `${execDir}${path.delimiter}${process.env.PATH ?? ""}`,
      npm_config_audit: "false",
      npm_config_fund: "false",
      ...(process.env.HOME ? {} : { HOME: os.homedir() }),
    };
    const child = spawn(
      runner.command,
      [
        ...runner.args,
        "install",
        "--prefix",
        prefix,
        COMPUTER_MCP_PACKAGE,
        "--no-audit",
        "--no-fund",
      ],
      { env, cwd: prefix, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `npm install ${COMPUTER_MCP_PACKAGE} failed (${code})`));
    });
  });
}

/** 厂商 SDK / Pi 共用的 stdio MCP 形。 */
export function computerStdioConfig(userDataRoot: string): {
  command: string;
  args: string[];
  env: Record<string, string>;
  exposure: "deferred";
} {
  // 启动器先 ensure 再跑 CLI；勿整表拷 process.env（Codex toml）。
  return {
    command: process.execPath,
    args: [computerMcpLaunchPath(), userDataRoot],
    env: {},
    exposure: "deferred",
  };
}

/** Pi LoadedMcpConfig 条目：平台注入，强制 deferred。 */
export function computerMcpEntry(userDataRoot: string): McpServerEntry {
  const stdio = computerStdioConfig(userDataRoot);
  return {
    name: COMPUTER_MCP_NAME,
    source: "agentup:platform",
    scope: "global",
    config: {
      command: stdio.command,
      args: stdio.args,
      env: stdio.env,
      exposure: "deferred",
    },
  };
}

/** 合并平台 Computer Use：同名强制覆盖为 deferred 平台条目。 */
export function injectComputerUseMcp<T extends { servers: McpServerEntry[] }>(
  config: T,
  userDataRoot: string,
): T {
  const entry = computerMcpEntry(userDataRoot);
  const servers = config.servers.filter((server) => server.name !== COMPUTER_MCP_NAME);
  servers.push(entry);
  // 预热安装（异步，不阻塞开会话；启动器仍会再 ensure 一次）
  void ensureComputerUseInstalled(userDataRoot).catch(() => undefined);
  return { ...config, servers };
}

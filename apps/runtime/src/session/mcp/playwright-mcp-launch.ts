/**
 * Playwright / Browser Use 上游入口：
 * 先装到 `<userDataRoot>/runtime/playwright-mcp`，再把 stdio 交给 `@playwright/mcp/cli.js`。
 *
 * 由 stdio 配置以 `node playwright-mcp-launch.js <userDataRoot> ...mcpArgs` 拉起。
 * 禁止 npx / .cmd，避免 Windows 弹 cmd → 系统 node。
 *
 * Browser Use 回落到钉版 Chromium 时，桥进程会带 AGENTUP_BROWSER_ENSURE_BROWSERS=1，
 * 此处再 ensure 一次 browsers，避免首用竞态。
 *
 * Win 曾出现缺 zipBundle 仍写 ready：ensure 完整性门禁会重装；若仍 MODULE_NOT_FOUND
 * 秒崩，再 invalidate + 重装并重试一次（stdout 保持 MCP stdio，只 tee stderr）。
 */
import { spawn, type ChildProcess } from "node:child_process";

import {
  ensurePlaywrightBrowsers,
  ensurePlaywrightMcpInstalled,
  invalidatePlaywrightMcpInstall,
  playwrightCliPath,
  playwrightUpstreamCrashLooksLikeCorruptInstall,
} from "./playwright-platform.js";
import { shouldWindowsHideChild } from "../windows-hide.js";

const userDataRoot = process.argv[2]?.trim();
if (!userDataRoot) {
  console.error("agentup playwright-mcp-launch: missing userDataRoot");
  process.exit(1);
}

const mcpArgs = process.argv.slice(3);

async function ensureInstalled(): Promise<void> {
  await ensurePlaywrightMcpInstalled(userDataRoot);
  if (process.env.AGENTUP_BROWSER_ENSURE_BROWSERS === "1") {
    await ensurePlaywrightBrowsers(userDataRoot);
  }
}

function spawnCli(): ChildProcess {
  const cli = playwrightCliPath(userDataRoot);
  return spawn(process.execPath, [cli, ...mcpArgs], {
    // stdin/stdout 必须交给 MCP；stderr 可 tee，便于识别 MODULE_NOT_FOUND
    stdio: ["inherit", "inherit", "pipe"],
    windowsHide: shouldWindowsHideChild(),
    env: process.env,
  });
}

function forwardSignals(child: ChildProcess): void {
  const relay = (signal: NodeJS.Signals) => {
    try {
      child.kill(signal);
    } catch {
      // ignore
    }
  };
  process.once("SIGTERM", () => relay("SIGTERM"));
  process.once("SIGINT", () => relay("SIGINT"));
}

async function runOnce(): Promise<{ code: number | null; signal: NodeJS.Signals | null; stderr: string }> {
  await ensureInstalled();
  const child = spawnCli();
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer | string) => {
    const text = String(chunk);
    stderr += text;
    process.stderr.write(text);
  });
  forwardSignals(child);
  return await new Promise((resolve, reject) => {
    child.on("error", (error) => {
      console.error(
        `agentup playwright-mcp-launch: spawn failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      reject(error);
    });
    child.on("exit", (code, signal) => {
      resolve({ code, signal, stderr });
    });
  });
}

try {
  let result = await runOnce();
  if (playwrightUpstreamCrashLooksLikeCorruptInstall(result.stderr, result.code)) {
    console.error(
      "agentup playwright-mcp-launch: corrupt install detected (MODULE_NOT_FOUND); reinstalling once",
    );
    invalidatePlaywrightMcpInstall(userDataRoot);
    result = await runOnce();
  }
  if (result.signal) {
    process.kill(process.pid, result.signal);
  } else {
    process.exit(result.code ?? 1);
  }
} catch (error) {
  console.error(
    `agentup playwright-mcp-launch: install failed: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exit(1);
}

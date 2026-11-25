/**
 * Playwright / Browser Use 上游入口：
 * 先装到 `<userDataRoot>/runtime/playwright-mcp`，再把 stdio 交给 `@playwright/mcp/cli.js`。
 *
 * 由 stdio 配置以 `node playwright-mcp-launch.js <userDataRoot> ...mcpArgs` 拉起。
 * 禁止 npx / .cmd，避免 Windows 弹 cmd → 系统 node。
 */
import { spawn } from "node:child_process";

import {
  ensurePlaywrightMcpInstalled,
  playwrightCliPath,
} from "./playwright-platform.js";
import { shouldWindowsHideChild } from "../windows-hide.js";

const userDataRoot = process.argv[2]?.trim();
if (!userDataRoot) {
  console.error("agentup playwright-mcp-launch: missing userDataRoot");
  process.exit(1);
}

const mcpArgs = process.argv.slice(3);

try {
  await ensurePlaywrightMcpInstalled(userDataRoot);
} catch (error) {
  console.error(
    `agentup playwright-mcp-launch: install failed: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exit(1);
}

const cli = playwrightCliPath(userDataRoot);
const child = spawn(process.execPath, [cli, ...mcpArgs], {
  stdio: "inherit",
  windowsHide: shouldWindowsHideChild(),
  env: process.env,
});

child.on("error", (error) => {
  console.error(
    `agentup playwright-mcp-launch: spawn failed: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

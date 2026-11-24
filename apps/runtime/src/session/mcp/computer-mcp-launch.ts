/**
 * Computer Use MCP 入口：先装到 `<userDataRoot>/runtime/open-computer-use`，
 * 再把 stdio 交给 open-computer-use CLI 的 `mcp` 子命令。
 *
 * 由 `computerStdioConfig` 以 `node computer-mcp-launch.js <userDataRoot>` 拉起。
 */
import { spawn } from "node:child_process";

import {
  computerCliPath,
  ensureComputerUseInstalled,
} from "./computer-platform.js";

const userDataRoot = process.argv[2]?.trim();
if (!userDataRoot) {
  console.error("agentup computer-mcp-launch: missing userDataRoot");
  process.exit(1);
}

try {
  await ensureComputerUseInstalled(userDataRoot);
} catch (error) {
  console.error(
    `agentup computer-mcp-launch: install failed: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exit(1);
}

const cli = computerCliPath(userDataRoot);
const child = spawn(process.execPath, [cli, "mcp", ...process.argv.slice(3)], {
  stdio: "inherit",
  windowsHide: true,
  env: process.env,
});

child.on("error", (error) => {
  console.error(
    `agentup computer-mcp-launch: spawn failed: ${
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

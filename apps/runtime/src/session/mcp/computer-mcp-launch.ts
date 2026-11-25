/**
 * Computer Use MCP 入口：先装到 `<userDataRoot>/runtime/open-computer-use`，
 * 再把 stdio 交给**原生** `open-computer-use(.exe) mcp`。
 *
 * 故意不经上游 JS bin：`open-computer-use-cli.mjs` 的 `runChild` 写死
 * `windowsHide: false`，Windows 上会弹黑框（进程标题即为原生 exe）。
 *
 * 由 `computerStdioConfig` 以 `node computer-mcp-launch.js <userDataRoot>` 拉起。
 * 原生缺失时 invalidate + ensure 再试一次（与 playwright-mcp-launch 同形自愈）。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";

import {
  computerNativeExecutablePath,
  ensureComputerUseInstalled,
  invalidateComputerUseInstall,
} from "./computer-platform.js";

const userDataRoot = process.argv[2]?.trim();
if (!userDataRoot) {
  console.error("agentup computer-mcp-launch: missing userDataRoot");
  process.exit(1);
}

async function resolveNative(): Promise<string> {
  await ensureComputerUseInstalled(userDataRoot);
  const native = computerNativeExecutablePath(userDataRoot);
  if (native && fs.existsSync(native)) return native;
  throw new Error(`native binary missing (${native ?? "unsupported platform"})`);
}

try {
  let native: string;
  try {
    native = await resolveNative();
  } catch (first) {
    console.error(
      `agentup computer-mcp-launch: incomplete install (${
        first instanceof Error ? first.message : String(first)
      }); reinstalling once`,
    );
    invalidateComputerUseInstall(userDataRoot);
    native = await resolveNative();
  }

  const child = spawn(native, ["mcp", ...process.argv.slice(3)], {
    stdio: "inherit",
    // 原生 console subsystem：必须 hide。上游 JS launcher 写死 false 会弹黑框。
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
} catch (error) {
  console.error(
    `agentup computer-mcp-launch: install failed: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exit(1);
}

#!/usr/bin/env node
/**
 * AgentUp Browser Use MCP bridge 入口。
 *
 * - 转发 @playwright/mcp stdio（NDJSON）；click/type 等先 hover 再截图再动作
 * - 关窗重连：上游退出后宿主/standalone 保持，下次请求重拉
 * - 单例：设 AGENTUP_BROWSER_USER_DATA_ROOT 后多会话连同一宿主，避免 already in use
 *
 * 实现拆在同目录：`ndjson.mjs` / `upstream-hub.mjs` / `singleton.mjs`（ensure-assets 一并拷贝）。
 *
 * env:
 *   AGENTUP_BROWSER_UPSTREAM_COMMAND
 *   AGENTUP_BROWSER_UPSTREAM_ARGS_JSON
 *   AGENTUP_BROWSER_USER_DATA_ROOT
 *   AGENTUP_BROWSER_HOST=1
 */
import process from "node:process";
import { fileURLToPath } from "node:url";

import { runClient, runHost, runStandalone } from "./singleton.mjs";
import { createUpstreamHub } from "./upstream-hub.mjs";

const upstreamCommand = process.env.AGENTUP_BROWSER_UPSTREAM_COMMAND || process.execPath;
let upstreamArgs = [];
try {
  upstreamArgs = JSON.parse(process.env.AGENTUP_BROWSER_UPSTREAM_ARGS_JSON || "[]");
} catch {
  upstreamArgs = [];
}
if (!Array.isArray(upstreamArgs) || upstreamArgs.length === 0) {
  console.error("AGENTUP_BROWSER_UPSTREAM_ARGS_JSON missing");
  process.exit(1);
}

const userDataRoot = (process.env.AGENTUP_BROWSER_USER_DATA_ROOT || "").trim();
const isHost = process.env.AGENTUP_BROWSER_HOST === "1";
const selfPath = fileURLToPath(import.meta.url);

if (isHost) {
  if (!userDataRoot) {
    console.error("AGENTUP_BROWSER_HOST requires AGENTUP_BROWSER_USER_DATA_ROOT");
    process.exit(1);
  }
  const hub = createUpstreamHub({
    upstreamCommand,
    upstreamArgs,
    mode: "host",
  });
  runHost({ root: userDataRoot, hub });
} else if (userDataRoot) {
  runClient({
    root: userDataRoot,
    selfPath,
    upstreamCommand,
    upstreamArgs,
  }).catch((error) => {
    console.error("browser mcp client failed", error);
    process.exit(1);
  });
} else {
  const hub = createUpstreamHub({
    upstreamCommand,
    upstreamArgs,
    mode: "standalone",
  });
  runStandalone({ hub });
}

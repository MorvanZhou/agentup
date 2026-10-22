import fs from "node:fs";
import path from "node:path";

import type { LoadedMcpConfig, McpServerConfig, McpServerEntry } from "@earendil-works/pi-coding-agent";

/** 与医院 MCP 约定的请求头。运行包里的同名头会被这次出诊的用户覆盖。 */
export const VISIT_USER_HEADER = "X-AgentUp-User-Id";

export function readProjectMcp(cwd: string): LoadedMcpConfig {
  return readMcpFile(path.join(cwd, ".pi", "mcp.json"), "project");
}

/** 读取私人助理 MCP，与 ~/.pi/agent 无关。 */
export function readUserMcp(userRoot: string): LoadedMcpConfig {
  return readMcpFile(path.join(userRoot, "mcp.json"), "global");
}

/**
 * 合并用户级与运行包 MCP。同名时运行包覆盖用户级；HTTP 服务统一盖章用户身份。
 */
export function mergeVisitMcp(cwd: string, userRoot: string, userId: string): LoadedMcpConfig {
  const user = readUserMcp(userRoot);
  const project = readProjectMcp(cwd);
  const byName = new Map<string, McpServerEntry>();
  for (const server of user.servers) byName.set(server.name, server);
  for (const server of project.servers) byName.set(server.name, server);
  return stampVisitUser(
    {
      servers: [...byName.values()],
      errors: [...user.errors, ...project.errors],
      projectConfig: project.projectConfig,
    },
    userId,
  );
}

/** 第三方 Agent 只使用自己的运行包 MCP，不拼接私人助理 MCP。 */
export function projectVisitMcp(cwd: string, userId: string): LoadedMcpConfig {
  return stampVisitUser(readProjectMcp(cwd), userId);
}

export function stampVisitUser(config: LoadedMcpConfig, userId: string): LoadedMcpConfig {
  if (!userId || userId !== userId.trim() || /[/\\\u0000]/.test(userId)) {
    throw new Error("缺少用户身份");
  }
  return {
    ...config,
    servers: config.servers.map((server) => {
      if (!("url" in server.config) || typeof server.config.url !== "string") return server;
      return {
        ...server,
        config: {
          ...server.config,
          headers: { ...(server.config.headers ?? {}), [VISIT_USER_HEADER]: userId },
          exposure: "direct",
        },
      };
    }),
  };
}

function readMcpFile(file: string, scope: "project" | "global"): LoadedMcpConfig {
  if (!fs.existsSync(file)) return { servers: [], errors: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { servers: [], errors: [`${file} 不是合法 JSON`] };
  }
  const servers = parsed && typeof parsed === "object" ? (parsed as { mcpServers?: unknown }).mcpServers : undefined;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    return { servers: [], errors: [`${file} 缺少 mcpServers`] };
  }
  const entries: McpServerEntry[] = [];
  const errors: string[] = [];
  for (const [name, config] of Object.entries(servers)) {
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      errors.push(`${name} 的配置无效`);
      continue;
    }
    entries.push({ name, config: config as McpServerConfig, source: file, scope });
  }
  return {
    servers: entries,
    errors,
    ...(scope === "project" ? { projectConfig: file } : {}),
  };
}

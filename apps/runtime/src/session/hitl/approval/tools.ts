import { PLATFORM_MCP_NAMES } from "../../mcp/platform-mcp.js";

/** Host 自有 MCP（每轮临时 HTTP）；与 PLATFORM_MCP_NAMES 同属官方注入。 */
export const AGENTUP_MCP_NAME = "agentup";

/** 命令类工具：与 bash 同属命令审批（once / session / agent）。 */
export function isCommandTool(toolName: string): boolean {
  return toolName === "bash" || toolName === "powershell" || toolName === "bg_run";
}

export function isFilePathTool(toolName: string): boolean {
  return (
    toolName === "read" ||
    toolName === "write" ||
    toolName === "edit" ||
    toolName === "grep" ||
    toolName === "find" ||
    toolName === "ls"
  );
}

export function isProjectMountArgs(args: Record<string, unknown>): boolean {
  return args.project_mount === true;
}

export function isDelegationTool(toolName: string): boolean {
  // Pi 裸名与 SDK/MCP 全名同语义，都走委托审批（delegationAllow）
  return toolName === "delegate_to_agent" || toolName === "mcp__agentup__delegate_to_agent";
}

/** 仅实际 MCP 调用需审批；read/list 资源只读工具默认放行。 */
export function isMcpTool(toolName: string): boolean {
  return toolName.startsWith("mcp__");
}

/** `mcp__server__tool` → server 名；已是 server 键则返回自身。 */
export function mcpServerName(toolName: string): string | undefined {
  if (!toolName.startsWith("mcp__")) return undefined;
  const rest = toolName.slice("mcp__".length);
  if (!rest) return undefined;
  const sep = rest.indexOf("__");
  return sep <= 0 ? rest : rest.slice(0, sep);
}

/** `mcp__server__tool` → `mcp__server`；已是 server 键则返回自身。 */
export function mcpServerAllowKey(toolName: string): string | undefined {
  const name = mcpServerName(toolName);
  return name ? `mcp__${name}` : undefined;
}

/**
 * AgentUp 官方注入的 MCP（宿主 agentup + platformMcpServers）。
 * 与用户 mcp.json 第三方区分：官方工具面按内建同性质免审（委托除外）。
 */
export function isOfficialMcpTool(toolName: string): boolean {
  const name = mcpServerName(toolName);
  if (!name) return false;
  if (name === AGENTUP_MCP_NAME) return true;
  return (PLATFORM_MCP_NAMES as readonly string[]).includes(name);
}

/** 单专家 agent_id，或 tasks[].agent_id（扇出）。 */
export function targetAgentIds(args: Record<string, unknown>): string[] {
  const ids: string[] = [];
  if (Array.isArray(args.tasks)) {
    for (const item of args.tasks) {
      if (!item || typeof item !== "object") continue;
      const value = (item as Record<string, unknown>).agent_id;
      if (typeof value !== "string") continue;
      const trimmed = value.trim();
      if (trimmed) ids.push(trimmed);
    }
  }
  if (ids.length === 0) {
    const value = args.agent_id;
    if (typeof value === "string" && value.trim()) ids.push(value.trim());
  }
  return [...new Set(ids)];
}

export function requiresApproval(toolName: string): boolean {
  if (isCommandTool(toolName) || isDelegationTool(toolName)) return true;
  // 第三方 MCP 仍逐步审批；官方 MCP 与内建工具同性质免审
  if (isMcpTool(toolName) && !isOfficialMcpTool(toolName)) return true;
  return false;
}

export function visitKey(userId: string, agentId: string): string {
  return `${userId}/${agentId}`;
}

export function delegationKey(userId: string, toAgentId: string): string {
  return `${userId}/${toAgentId}`;
}

export function toolKey(userId: string, agentId: string, toolName: string): string {
  return `${userId}/${agentId}/${toolName}`;
}

/**
 * 外部 SDK 厂商工具的记忆键：`{templateId}/{toolName}`。
 * 避免换厂商后同名工具（Bash / Write）串权。MCP / 委托不走此键。
 */
export function sdkToolAllowKey(templateId: string, toolName: string): string {
  return `${templateId}/${toolName}`;
}

/** AgentUp 自有能力：不套厂商 templateId。 */
export function isAgentUpOwnedTool(toolName: string): boolean {
  return isMcpTool(toolName) || isDelegationTool(toolName);
}

/**
 * SDK `canUseTool` / `allowsTool` 用的持久化名：
 * MCP·委托原样；其余带 `templateId/` 前缀。
 */
export function externalToolAllowKey(templateId: string | undefined, toolName: string): string {
  if (!templateId || isAgentUpOwnedTool(toolName)) return toolName;
  return sdkToolAllowKey(templateId, toolName);
}

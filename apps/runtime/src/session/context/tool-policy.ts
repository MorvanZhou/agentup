import type { ExecutionMode } from "./mode.js";

/**
 * 逻辑工具名。`shell` 在解析时换成本机的 bash / powershell。
 * `tool_search` 仅在该会话确实加载了 MCP 时才放进白名单。
 */
export type PolicyToolName =
  | "read"
  | "grep"
  | "find"
  | "ls"
  | "write"
  | "edit"
  | "shell"
  | "get_local_time"
  | "web_search"
  | "web_fetch"
  | "ask_user"
  | "todo"
  | "bg_run"
  | "bg_status"
  | "bg_kill"
  | "shell_hang_decide"
  | "tool_search"
  | "agent_search"
  | "delegate_to_agent"
  | "check_delegation"
  | "cancel_delegation"
  | "steer_delegation"
  | "resolve_delegation_update"
  | "deliver_artifacts"
  | "complete_group_task";

const FILE_TOOLS = ["read", "grep", "find", "ls", "write", "edit", "shell"] as const satisfies readonly PolicyToolName[];

const COMMON_TOOLS = [
  "get_local_time",
  "web_search",
  "web_fetch",
  "ask_user",
  "todo",
] as const satisfies readonly PolicyToolName[];

const BACKGROUND_TOOLS = ["bg_run", "bg_status", "bg_kill", "shell_hang_decide"] as const satisfies readonly PolicyToolName[];

const ROOM_DELEGATION_TOOLS = [
  "delegate_to_agent",
  "check_delegation",
  "cancel_delegation",
  "steer_delegation",
  "resolve_delegation_update",
] as const satisfies readonly PolicyToolName[];

/** 每种场景一份白名单。解析时只查这张表，不再按场景写分支。 */
export const TOOL_POLICY: Record<ExecutionMode, readonly PolicyToolName[]> = {
  single: [...FILE_TOOLS, ...COMMON_TOOLS, ...BACKGROUND_TOOLS, "tool_search", "agent_search", ...ROOM_DELEGATION_TOOLS],
  "group-holder": [...FILE_TOOLS, ...COMMON_TOOLS, ...BACKGROUND_TOOLS, "tool_search", ...ROOM_DELEGATION_TOOLS],
  "single-delegation": [...FILE_TOOLS, ...COMMON_TOOLS, "shell_hang_decide", "tool_search", "deliver_artifacts"],
  "group-delegation": [...FILE_TOOLS, ...COMMON_TOOLS, "shell_hang_decide", "tool_search", "complete_group_task"],
};

export function resolveExecutionTools(
  mode: ExecutionMode,
  input: { shellTools: readonly string[]; mcp: boolean },
): string[] {
  const out: string[] = [];
  for (const name of TOOL_POLICY[mode]) {
    if (name === "shell") {
      out.push(...input.shellTools);
      continue;
    }
    if (name === "tool_search" && !input.mcp) continue;
    out.push(name);
  }
  return out;
}

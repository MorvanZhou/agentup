import path from "node:path";

import { PERSONAL_ASSISTANT_ID, personalAssistantVisit } from "../assistant/personal-assistant.js";
import { isLocalAgentId, localAgentVisit } from "../agents/local-agent.js";
import {
  clearCommandAllow,
  clearDelegationAllow,
  clearToolAllow,
  getCommandAllow,
  getDelegationAllow,
  readState,
  setCommandAllow,
  setDelegationAllow,
  setToolAllow,
  type CommandAllowScope,
} from "../user/state.js";
import { mergeVisitMcp, projectVisitMcp } from "../../session/workspace/mcp.js";
import { Runtime } from "../../package/sync.js";

export type ApprovalChoice = "once" | "session" | "agent";

export type ApprovalToolRow = {
  toolName: string;
  kind: "mcp_server" | "mcp_tool";
  label: string;
  scope: ApprovalChoice;
};

export type ApprovalDelegationTarget = {
  agentId: string;
  scope: CommandAllowScope;
};

export type AgentApprovals = {
  command: ApprovalChoice;
  tools: ApprovalToolRow[];
  delegation: {
    anyone: "once" | "agent";
    targets: ApprovalDelegationTarget[];
  };
};

export type AgentApprovalsPatch = {
  command?: ApprovalChoice;
  tools?: Array<{ toolName: string; scope: ApprovalChoice }>;
  delegation?: {
    anyone?: "once" | "agent";
    targets?: Array<{ agentId: string; scope: ApprovalChoice }>;
  };
};

/** 读取某 Agent 的审批配置（含 MCP 目录与已授权细项）。 */
export function readAgentApprovals(
  userDataRoot: string,
  userId: string,
  agentId: string,
): AgentApprovals {
  const commandScope = getCommandAllow(userDataRoot, userId, agentId);
  const state = readState(userDataRoot, userId);
  const toolMap = state.toolAllow[agentId] ?? {};
  const servers = listMcpServerNames(userDataRoot, userId, agentId);
  const tools: ApprovalToolRow[] = [];
  const coveredExact = new Set<string>();

  for (const server of servers) {
    const key = `mcp__${server}`;
    tools.push({
      toolName: key,
      kind: "mcp_server",
      label: server,
      scope: toChoice(toolMap[key]),
    });
    coveredExact.add(key);
  }

  // 对话里按具体工具放过的细项（未被 server 行覆盖展示的）
  for (const [toolName, scope] of Object.entries(toolMap)) {
    if (coveredExact.has(toolName)) continue;
    if (!toolName.startsWith("mcp__")) continue;
    const serverKey = mcpServerKeyFromTool(toolName);
    if (serverKey && servers.includes(serverKey.slice("mcp__".length)) && toolMap[serverKey]) {
      // server 已授权时细项仍可改，但默认折叠不重复列出；仅展示无 server 行或与 server 不同 scope 的细项
      if (toolMap[serverKey] === scope) continue;
    }
    tools.push({
      toolName,
      kind: "mcp_tool",
      label: toolName,
      scope: toChoice(scope),
    });
  }

  const anyoneScope = getDelegationAllow(userDataRoot, userId, agentId);
  const targets: ApprovalDelegationTarget[] = [];
  for (const [id, scope] of Object.entries(state.delegationAllow)) {
    if (id === agentId) continue;
    if (scope !== "session" && scope !== "agent") continue;
    // session 记在 toAgent；agent 级记在 from。其它 agent 的 agent 级不属本页。
    if (scope === "agent") continue;
    targets.push({ agentId: id, scope });
  }
  targets.sort((a, b) => a.agentId.localeCompare(b.agentId));

  return {
    command: toChoice(commandScope),
    tools,
    delegation: {
      anyone: anyoneScope === "agent" ? "agent" : "once",
      targets,
    },
  };
}

/** 写入审批配置；once 表示清除持久化授权。 */
export function writeAgentApprovals(
  userDataRoot: string,
  userId: string,
  agentId: string,
  patch: AgentApprovalsPatch,
): AgentApprovals {
  if (patch.command !== undefined) {
    if (patch.command === "once") clearCommandAllow(userDataRoot, userId, agentId);
    else setCommandAllow(userDataRoot, userId, agentId, patch.command);
  }

  for (const item of patch.tools ?? []) {
    const prefix = item.toolName.startsWith("mcp__") && !item.toolName.slice(5).includes("__");
    if (item.scope === "once") {
      clearToolAllow(userDataRoot, userId, agentId, item.toolName, { prefix });
    } else {
      setToolAllow(userDataRoot, userId, agentId, item.toolName, item.scope);
    }
  }

  if (patch.delegation?.anyone !== undefined) {
    if (patch.delegation.anyone === "once") {
      const current = getDelegationAllow(userDataRoot, userId, agentId);
      if (current === "agent") clearDelegationAllow(userDataRoot, userId, agentId);
    } else {
      setDelegationAllow(userDataRoot, userId, agentId, "agent");
    }
  }

  for (const item of patch.delegation?.targets ?? []) {
    if (item.agentId === agentId) continue;
    if (item.scope === "once") {
      clearDelegationAllow(userDataRoot, userId, item.agentId);
    } else if (item.scope === "session" || item.scope === "agent") {
      setDelegationAllow(userDataRoot, userId, item.agentId, item.scope);
    }
  }

  return readAgentApprovals(userDataRoot, userId, agentId);
}

function listMcpServerNames(userDataRoot: string, userId: string, agentId: string): string[] {
  try {
    if (agentId === PERSONAL_ASSISTANT_ID) {
      const visit = personalAssistantVisit(userDataRoot, userId);
      const cwd = path.join(visit.root, "cwd");
      const merged = mergeVisitMcp(cwd, visit.root, userId);
      return merged.servers.map((server) => server.name).sort();
    }
    if (isLocalAgentId(agentId)) {
      const visit = localAgentVisit(userDataRoot, userId, agentId);
      return projectVisitMcp(path.join(visit.root, "cwd"), userId).servers.map((s) => s.name).sort();
    }
    const disk = Runtime.openDiskVisit(userDataRoot, userId, agentId);
    if (disk) {
      return projectVisitMcp(path.join(disk.root, "cwd"), userId).servers.map((s) => s.name).sort();
    }
  } catch {
    // 目录缺失时退回空列表，仍可展示已授权细项
  }
  // 兜底：从已授权 toolAllow 推断 server 名
  const toolMap = readState(userDataRoot, userId).toolAllow[agentId] ?? {};
  const names = new Set<string>();
  for (const toolName of Object.keys(toolMap)) {
    const key = mcpServerKeyFromTool(toolName);
    if (key) names.add(key.slice("mcp__".length));
  }
  return [...names].sort();
}

function mcpServerKeyFromTool(toolName: string): string | undefined {
  if (!toolName.startsWith("mcp__")) return undefined;
  const rest = toolName.slice("mcp__".length);
  if (!rest) return undefined;
  const sep = rest.indexOf("__");
  if (sep <= 0) return `mcp__${rest}`;
  return `mcp__${rest.slice(0, sep)}`;
}

function toChoice(scope: CommandAllowScope | undefined): ApprovalChoice {
  if (scope === "session" || scope === "agent") return scope;
  return "once";
}

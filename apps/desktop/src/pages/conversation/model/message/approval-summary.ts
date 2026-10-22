import type { AgentUpApprovalData, ApprovalScope } from "../../../../shared/model/chat";
import { t, tf } from "../../../../shared/model/ui-locale";

export type ApprovalKind = "command" | "write" | "tool" | "project";

export type ApprovalScopeOption = {
  scope: ApprovalScope;
  label: string;
};

export type ApprovalSummary = {
  kind: ApprovalKind;
  title: string;
  description: string;
  target: string;
  command: boolean;
  scopes: ApprovalScopeOption[];
};

function commandScopes(): ApprovalScopeOption[] {
  return [
    { scope: "once", label: t("approvalScopeOnce") },
    { scope: "session", label: t("approvalScopeSession") },
    { scope: "agent", label: t("approvalScopeAgent") },
  ];
}

/** 会诊委托：once / session（本专家）/ agent（该助手可调任何人）。 */
function delegationScopes(): ApprovalScopeOption[] {
  return [
    { scope: "once", label: t("approvalScopeOnce") },
    { scope: "session", label: t("approvalScopeSession") },
    { scope: "agent", label: t("approvalScopeDelegationAgent") },
  ];
}

function basenamePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  const parts = trimmed.split(/[/\\]/).filter(Boolean);
  return parts.at(-1) ?? trimmed;
}

/** 展示用：把绝对/长路径收成文件名，命令参数与引号保留。 */
export function shortenDisplayTarget(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  // 整段就是路径时直接取文件名
  if (!/\s/.test(trimmed) && /[/\\]/.test(trimmed)) {
    return basenamePath(trimmed);
  }
  // 命令行：只缩短看起来像路径的 token，保留引号内参数
  return trimmed.replace(
    /("([^"\\]|\\.)*"|'([^'\\]|\\.)*'|[^\s"']+)/g,
    (token) => {
      if (token.startsWith('"') || token.startsWith("'")) return token;
      if (!/[/\\]/.test(token)) return token;
      return basenamePath(token);
    },
  );
}

function targetFromArgs(args: Record<string, unknown>): string {
  if (typeof args.path === "string" && args.path.trim()) {
    return shortenDisplayTarget(args.path.trim());
  }
  if (typeof args.url === "string" && args.url.trim()) {
    return args.url.trim();
  }
  if (typeof args.query === "string" && args.query.trim()) {
    return args.query.trim();
  }
  if (typeof args.command === "string" && args.command.trim()) {
    return shortenDisplayTarget(args.command.trim());
  }
  if (typeof args.cmd === "string" && args.cmd.trim()) {
    return shortenDisplayTarget(args.cmd.trim());
  }
  return "";
}

/** 把审批请求整理成面向非技术用户的摘要文案。 */
export function summarizeApproval(approval: AgentUpApprovalData): ApprovalSummary {
  const args =
    approval.args && typeof approval.args === "object"
      ? (approval.args as Record<string, unknown>)
      : {};
  const target = targetFromArgs(args);
  const toolName = approval.toolName.toLowerCase();
  const command =
    toolName === "bash" || toolName === "powershell" || toolName === "bg_run";

  if (command) {
    return {
      kind: "command",
      title: toolName === "bg_run" ? t("approvalBgRunTitle") : t("approvalCmdTitle"),
      description:
        toolName === "bg_run" ? t("approvalBgRunDesc") : t("approvalCmdDesc"),
      target: target || t("approvalCmdNoTarget"),
      command: true,
      scopes: commandScopes(),
    };
  }

  if (toolName === "delegate_to_agent") {
    const agentName =
      typeof args.agent_name === "string" && args.agent_name.trim()
        ? args.agent_name.trim()
        : "";
    const fanoutCount =
      typeof args.fanout_count === "number" && args.fanout_count > 1
        ? args.fanout_count
        : Array.isArray(args.tasks)
          ? args.tasks.length
          : 0;
    const brief =
      typeof args.brief === "string" && args.brief.trim() ? args.brief.trim() : "";
    const shortBrief = brief.length > 80 ? `${brief.slice(0, 79)}…` : brief;
    const fanoutTarget =
      fanoutCount > 1
        ? agentName
          ? tf("approvalDelegateFanoutTarget", { names: agentName, count: fanoutCount })
          : tf("approvalDelegateFanoutCount", { count: fanoutCount })
        : "";
    return {
      kind: "tool",
      title:
        fanoutCount > 1
          ? tf("approvalDelegateTitleFanout", { count: fanoutCount })
          : agentName
            ? tf("approvalDelegateTitleNamed", { name: agentName })
            : t("approvalDelegateTitle"),
      description: t("approvalDelegateDesc"),
      target: fanoutTarget || shortBrief || t("approvalDelegateNoBrief"),
      command: false,
      scopes: delegationScopes(),
    };
  }

  // 项目目录挂载：文件工具越界时由 runtime 注入 project_mount。
  if (args.project_mount === true) {
    const mountPath =
      typeof args.mount_path === "string" && args.mount_path.trim()
        ? args.mount_path.trim()
        : "";
    return {
      kind: "project",
      title: t("approvalProjectTitle"),
      description: t("approvalProjectDesc"),
      target: mountPath || target || t("approvalProjectNoTarget"),
      command: false,
      scopes: commandScopes(),
    };
  }

  // MCP 须先于 write/edit 启发式：工具名常含 write（如 mcp__x__write）。
  if (isMcpApprovalTool(toolName)) {
    return {
      kind: "tool",
      title: t("approvalToolTitle"),
      description: t("approvalMcpDesc"),
      target: target || approval.toolName,
      command: false,
      scopes: commandScopes(),
    };
  }

  if (toolName.includes("write") || toolName.includes("edit")) {
    return {
      kind: "write",
      title: t("approvalWriteTitle"),
      description: t("approvalWriteDesc"),
      target: target || t("approvalWriteNoTarget"),
      command: false,
      scopes: [],
    };
  }

  if (toolName === "web_fetch") {
    return {
      kind: "tool",
      title: t("approvalFetchTitle"),
      description: t("approvalFetchDesc"),
      target: target || t("approvalFetchNoTarget"),
      command: false,
      scopes: [],
    };
  }

  if (toolName === "web_search") {
    return {
      kind: "tool",
      title: t("approvalSearchTitle"),
      description: t("approvalSearchDesc"),
      target: target || t("approvalSearchNoTarget"),
      command: false,
      scopes: [],
    };
  }

  return {
    kind: "tool",
    title: t("approvalToolTitle"),
    description: t("approvalToolDesc"),
    target: target || approval.toolName,
    command: false,
    scopes: [],
  };
}

function isMcpApprovalTool(toolName: string): boolean {
  return toolName.startsWith("mcp__");
}

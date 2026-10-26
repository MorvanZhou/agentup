import type {
  AgentCard,
  AgentSourcePreview,
  PublishedAgent,
  SyncedVisit,
} from "../../model/runtime/runtime";

import { DesktopApiError } from "./error";
import type { RuntimeHttp } from "./http";
import { agentListQuery, readAgent } from "./readers";

export async function agents(
  http: RuntimeHttp,
  token: string,
  options?: { userId?: string; q?: string; recruited?: boolean },
): Promise<AgentCard[]> {
  const payload = await http.request(`/agents${agentListQuery(options)}`, token);
  if (!Array.isArray(payload.agents)) throw new DesktopApiError("Agent 列表无效");
  return payload.agents.map(readAgent);
}

export async function localAgents(
  http: RuntimeHttp,
  token: string,
  userId: string,
  options?: { q?: string },
): Promise<AgentCard[]> {
  const payload = await http.request(
    `/agents/local${agentListQuery({ userId, q: options?.q })}`,
    token,
  );
  if (!Array.isArray(payload.agents)) throw new DesktopApiError("本机 Agent 列表无效");
  return payload.agents.map(readAgent);
}

export async function createLocalAgent(
  http: RuntimeHttp,
  token: string,
  userId: string,
  input: {
    name: string;
    role: string;
    background: string;
    rules?: string;
    avatarDataUrl?: string;
    skillPaths?: string[];
    mcpServers?: Record<string, unknown>;
  },
): Promise<AgentCard> {
  const payload = await http.request("/agents/local", token, {
    user_id: userId,
    name: input.name,
    role: input.role,
    background: input.background,
    ...(input.rules?.trim() ? { rules: input.rules.trim() } : {}),
    ...(input.avatarDataUrl ? { avatar_data_url: input.avatarDataUrl } : {}),
    ...(input.skillPaths?.length ? { skill_paths: input.skillPaths } : {}),
    ...(input.mcpServers && Object.keys(input.mcpServers).length
      ? { mcp_servers: input.mcpServers }
      : {}),
  });
  return readAgent(payload);
}

export async function getLocalAgent(
  http: RuntimeHttp,
  token: string,
  userId: string,
  agentId: string,
): Promise<AgentCard> {
  const payload = await http.request(
    `/agents/local/${encodeURIComponent(agentId)}?user_id=${encodeURIComponent(userId)}`,
    token,
  );
  return readAgent(payload);
}

export async function updateLocalAgent(
  http: RuntimeHttp,
  token: string,
  userId: string,
  agentId: string,
  input: {
    name: string;
    role: string;
    background: string;
    rules?: string;
    avatarDataUrl?: string;
    skillPaths?: string[];
    removeSkills?: string[];
    /** 传入（含空对象）表示覆盖 mcp.json；undefined 表示不改 */
    mcpServers?: Record<string, unknown>;
  },
): Promise<AgentCard> {
  const payload = await http.request(
    `/agents/local/${encodeURIComponent(agentId)}`,
    token,
    {
      user_id: userId,
      name: input.name,
      role: input.role,
      background: input.background,
      ...(input.rules !== undefined ? { rules: input.rules } : {}),
      ...(input.avatarDataUrl ? { avatar_data_url: input.avatarDataUrl } : {}),
      ...(input.skillPaths?.length ? { skill_paths: input.skillPaths } : {}),
      ...(input.removeSkills?.length ? { remove_skills: input.removeSkills } : {}),
      ...(input.mcpServers !== undefined ? { mcp_servers: input.mcpServers } : {}),
    },
    "PUT",
  );
  return readAgent(payload);
}

export async function bindLocalPublishedAgent(
  http: RuntimeHttp,
  token: string,
  userId: string,
  agentId: string,
  publishedAgentId: string,
): Promise<AgentCard> {
  const payload = await http.request(
    `/agents/local/${encodeURIComponent(agentId)}/published`,
    token,
    { user_id: userId, published_agent_id: publishedAgentId },
    "PUT",
  );
  return readAgent(payload);
}

export async function exportLocalAgentSkill(
  http: RuntimeHttp,
  token: string,
  userId: string,
  agentId: string,
  skillName: string,
  destination: string,
): Promise<{ path: string }> {
  const payload = await http.request(
    `/agents/local/${encodeURIComponent(agentId)}/skills/${encodeURIComponent(skillName)}/export`,
    token,
    { user_id: userId, destination },
    "POST",
  );
  if (!payload || typeof payload !== "object" || typeof (payload as { path?: unknown }).path !== "string") {
    throw new DesktopApiError("导出 Skill 响应无效");
  }
  return { path: (payload as { path: string }).path };
}

export async function deleteLocalAgent(
  http: RuntimeHttp,
  token: string,
  userId: string,
  agentId: string,
): Promise<void> {
  await http.request(
    `/agents/local/${encodeURIComponent(agentId)}?user_id=${encodeURIComponent(userId)}`,
    token,
    undefined,
    "DELETE",
  );
}

/** 游客可读市场列表；无需账号 token。 */
export async function publicAgents(
  http: RuntimeHttp,
  options?: { q?: string },
): Promise<AgentCard[]> {
  const payload = await http.request(`/agents/public${agentListQuery(options)}`);
  if (!Array.isArray(payload.agents)) throw new DesktopApiError("Agent 列表无效");
  return payload.agents.map(readAgent);
}

export async function ownedAgents(
  http: RuntimeHttp,
  token: string,
  options?: { userId?: string; q?: string },
): Promise<AgentCard[]> {
  const payload = await http.request(`/agents/owned${agentListQuery(options)}`, token);
  if (!Array.isArray(payload.agents)) throw new DesktopApiError("Agent 列表无效");
  return payload.agents.map(readAgent);
}

export async function setRemark(
  http: RuntimeHttp,
  token: string,
  agentId: string,
  remark: string,
): Promise<string> {
  const payload = await http.request(
    `/agents/${encodeURIComponent(agentId)}/remark`,
    token,
    { remark },
    "PUT",
  );
  return typeof payload.remark === "string" ? payload.remark.trim().replace(/\s+/g, " ").slice(0, 40) : "";
}

export async function recruit(http: RuntimeHttp, token: string, agentId: string): Promise<void> {
  await http.request(`/agents/${encodeURIComponent(agentId)}/recruit`, token, {});
}

export async function dismiss(
  http: RuntimeHttp,
  token: string,
  agentId: string,
  userId: string,
): Promise<void> {
  await http.request(`/agents/${encodeURIComponent(agentId)}/dismiss`, token, { user_id: userId });
}

export async function deleteOwnedAgent(
  http: RuntimeHttp,
  token: string,
  agentId: string,
  userId: string,
): Promise<void> {
  const params = new URLSearchParams({ user_id: userId });
  await http.request(
    `/agents/${encodeURIComponent(agentId)}?${params}`,
    token,
    undefined,
    "DELETE",
  );
}

export async function publish(
  http: RuntimeHttp,
  token: string,
  agentDir: string,
  name: string,
  role: string,
  background: string,
  agentId?: string,
  rules = "",
): Promise<PublishedAgent> {
  const payload = await http.request("/agents/publish", token, {
    agent_dir: agentDir,
    name,
    role,
    background,
    rules,
    ...(agentId ? { agent_id: agentId } : {}),
  });
  return readPublished(payload);
}

/** 市场发布表单：临时组包，不创建 loc-*。 */
export async function publishFromEditor(
  http: RuntimeHttp,
  token: string,
  input: {
    name: string;
    role: string;
    background: string;
    rules?: string;
    agentId?: string;
    skillPaths?: string[];
    removeSkills?: string[];
    mcpServers?: Record<string, unknown>;
    avatarDataUrl?: string;
  },
): Promise<PublishedAgent> {
  const payload = await http.request("/agents/publish-editor", token, {
    name: input.name,
    role: input.role,
    background: input.background,
    rules: input.rules ?? "",
    ...(input.agentId ? { agent_id: input.agentId } : {}),
    ...(input.skillPaths?.length ? { skill_paths: input.skillPaths } : {}),
    ...(input.removeSkills?.length ? { remove_skills: input.removeSkills } : {}),
    ...(input.mcpServers !== undefined ? { mcp_servers: input.mcpServers } : {}),
    ...(input.avatarDataUrl ? { avatar_data_url: input.avatarDataUrl } : {}),
  });
  return readPublished(payload);
}

/** 更新页预览：名片 + skills/MCP，不 hydrate loc-*。 */
export async function previewPublishEditor(
  http: RuntimeHttp,
  token: string,
  publishedAgentId: string,
): Promise<{
  name: string;
  role: string;
  background: string;
  rules: string;
  skills: string[];
  mcpServers: Record<string, unknown>;
  avatarUrl?: string;
}> {
  const payload = await http.request("/agents/publish-editor/preview", token, {
    published_agent_id: publishedAgentId,
  });
  if (
    typeof payload.name !== "string" ||
    typeof payload.role !== "string" ||
    typeof payload.background !== "string"
  ) {
    throw new DesktopApiError("发布预览无效");
  }
  const skills = Array.isArray(payload.skills)
    ? payload.skills.filter((item): item is string => typeof item === "string")
    : [];
  const mcpServers =
    payload.mcp_servers && typeof payload.mcp_servers === "object" && !Array.isArray(payload.mcp_servers)
      ? (payload.mcp_servers as Record<string, unknown>)
      : {};
  return {
    name: payload.name,
    role: payload.role,
    background: payload.background,
    rules: typeof payload.rules === "string" ? payload.rules : "",
    skills,
    mcpServers,
    ...(typeof payload.avatar_url === "string" && payload.avatar_url
      ? { avatarUrl: payload.avatar_url }
      : {}),
  };
}

function readPublished(payload: Record<string, unknown>): PublishedAgent {
  if (
    typeof payload.agent_id !== "string" ||
    typeof payload.name !== "string" ||
    typeof payload.background !== "string" ||
    typeof payload.version !== "number" ||
    typeof payload.digest !== "string"
  ) {
    throw new DesktopApiError("发布响应无效");
  }
  return {
    agentId: payload.agent_id,
    name: payload.name,
    role: typeof payload.role === "string" ? payload.role : "",
    background: payload.background,
    version: payload.version,
    digest: payload.digest,
  };
}

/** 更新名片层（含规则 / 可选头像），不换运行包。 */
export async function updateCard(
  http: RuntimeHttp,
  token: string,
  agentId: string,
  input: {
    name: string;
    role: string;
    background: string;
    rules?: string;
    avatarDataUrl?: string;
    /** 有头像变更时传入，用于立刻覆盖本机缓存 */
    userId?: string;
  },
): Promise<AgentCard> {
  const payload = await http.request(
    `/agents/${encodeURIComponent(agentId)}/card`,
    token,
    {
      name: input.name,
      role: input.role,
      background: input.background,
      rules: input.rules ?? "",
      ...(input.avatarDataUrl ? { avatar_data_url: input.avatarDataUrl } : {}),
      ...(input.userId ? { user_id: input.userId } : {}),
    },
    "PUT",
  );
  return readAgent(payload);
}

export async function importPublishedLocal(
  http: RuntimeHttp,
  token: string,
  userId: string,
  publishedAgentId: string,
): Promise<AgentCard> {
  const payload = await http.request("/agents/local/from-published", token, {
    user_id: userId,
    published_agent_id: publishedAgentId,
  });
  return readAgent(payload);
}

export async function exportPublishedSkill(
  http: RuntimeHttp,
  token: string,
  agentId: string,
  skillName: string,
  destination: string,
): Promise<{ path: string }> {
  const payload = await http.request(
    `/agents/published/${encodeURIComponent(agentId)}/skills/${encodeURIComponent(skillName)}/export`,
    token,
    { destination },
    "POST",
  );
  if (!payload || typeof payload !== "object" || typeof (payload as { path?: unknown }).path !== "string") {
    throw new DesktopApiError("导出 Skill 响应无效");
  }
  return { path: (payload as { path: string }).path };
}

export async function inspectAgent(
  http: RuntimeHttp,
  token: string,
  agentDir: string,
): Promise<AgentSourcePreview> {
  const payload = await http.request("/agents/inspect", token, { agent_dir: agentDir });
  if (typeof payload.file_count !== "number") {
    throw new DesktopApiError("运行包预览无效");
  }
  const avatarPreview =
    typeof payload.avatar_preview === "string" && payload.avatar_preview.trim()
      ? payload.avatar_preview
      : undefined;
  return {
    fileCount: payload.file_count,
    ...(avatarPreview ? { avatarPreview } : {}),
  };
}

export async function visitDirectory(
  http: RuntimeHttp,
  token: string,
  agentId: string,
  userId: string,
): Promise<string> {
  const payload = await http.request(
    `/agents/${encodeURIComponent(agentId)}/directory`,
    token,
    { user_id: userId },
  );
  if (typeof payload.path !== "string" || !payload.path) throw new DesktopApiError("本机目录无效");
  return payload.path;
}

export async function sync(
  http: RuntimeHttp,
  token: string,
  agentId: string,
  userId: string,
): Promise<SyncedVisit> {
  const payload = await http.request(
    `/agents/${encodeURIComponent(agentId)}/sync`,
    token,
    { user_id: userId },
  );
  if (
    typeof payload.user_id !== "string" ||
    typeof payload.agent_id !== "string" ||
    typeof payload.package_version !== "number" ||
    typeof payload.package_digest !== "string"
  ) {
    throw new DesktopApiError("同步响应无效");
  }
  return {
    userId: payload.user_id,
    agentId: payload.agent_id,
    packageVersion: payload.package_version,
    packageDigest: payload.package_digest,
  };
}

export type ApprovalChoice = "once" | "session" | "agent";

export type AgentApprovals = {
  command: ApprovalChoice;
  tools: Array<{
    toolName: string;
    kind: "mcp_server" | "mcp_tool";
    label: string;
    scope: ApprovalChoice;
  }>;
  delegation: {
    anyone: "once" | "agent";
    targets: Array<{ agentId: string; scope: "session" | "agent" }>;
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

export async function agentApprovals(
  http: RuntimeHttp,
  token: string,
  agentId: string,
  userId: string,
): Promise<AgentApprovals> {
  const payload = await http.request(
    `/agents/${encodeURIComponent(agentId)}/approvals?user_id=${encodeURIComponent(userId)}`,
    token,
  );
  return readAgentApprovals(payload);
}

export async function saveAgentApprovals(
  http: RuntimeHttp,
  token: string,
  agentId: string,
  userId: string,
  patch: AgentApprovalsPatch,
): Promise<AgentApprovals> {
  const payload = await http.request(
    `/agents/${encodeURIComponent(agentId)}/approvals`,
    token,
    {
      user_id: userId,
      ...(patch.command !== undefined ? { command: patch.command } : {}),
      ...(patch.tools
        ? {
            tools: patch.tools.map((item) => ({
              tool_name: item.toolName,
              scope: item.scope,
            })),
          }
        : {}),
      ...(patch.delegation
        ? {
            delegation: {
              ...(patch.delegation.anyone !== undefined
                ? { anyone: patch.delegation.anyone }
                : {}),
              ...(patch.delegation.targets
                ? {
                    targets: patch.delegation.targets.map((item) => ({
                      agent_id: item.agentId,
                      scope: item.scope,
                    })),
                  }
                : {}),
            },
          }
        : {}),
    },
    "PUT",
  );
  return readAgentApprovals(payload);
}

function readAgentApprovals(payload: Record<string, unknown>): AgentApprovals {
  if (payload.command !== "once" && payload.command !== "session" && payload.command !== "agent") {
    throw new DesktopApiError("审批配置无效");
  }
  if (!Array.isArray(payload.tools)) throw new DesktopApiError("审批配置无效");
  const tools: AgentApprovals["tools"] = [];
  for (const [index, item] of payload.tools.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new DesktopApiError(`审批工具[${index}]无效`);
    }
    const row = item as Record<string, unknown>;
    if (
      typeof row.tool_name !== "string" ||
      (row.kind !== "mcp_server" && row.kind !== "mcp_tool") ||
      typeof row.label !== "string" ||
      (row.scope !== "once" && row.scope !== "session" && row.scope !== "agent")
    ) {
      throw new DesktopApiError(`审批工具[${index}]无效`);
    }
    tools.push({
      toolName: row.tool_name,
      kind: row.kind,
      label: row.label,
      scope: row.scope,
    });
  }
  const delegationRaw = payload.delegation;
  if (!delegationRaw || typeof delegationRaw !== "object" || Array.isArray(delegationRaw)) {
    throw new DesktopApiError("审批配置无效");
  }
  const delegation = delegationRaw as Record<string, unknown>;
  if (delegation.anyone !== "once" && delegation.anyone !== "agent") {
    throw new DesktopApiError("审批配置无效");
  }
  if (!Array.isArray(delegation.targets)) throw new DesktopApiError("审批配置无效");
  const targets: AgentApprovals["delegation"]["targets"] = [];
  for (const [index, item] of delegation.targets.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new DesktopApiError(`会诊目标[${index}]无效`);
    }
    const row = item as Record<string, unknown>;
    if (
      typeof row.agent_id !== "string" ||
      (row.scope !== "session" && row.scope !== "agent")
    ) {
      throw new DesktopApiError(`会诊目标[${index}]无效`);
    }
    targets.push({ agentId: row.agent_id, scope: row.scope });
  }
  return {
    command: payload.command,
    tools,
    delegation: { anyone: delegation.anyone, targets },
  };
}

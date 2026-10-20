import type {
  AgentCard,
  AgentSourcePreview,
  PublishedAgent,
  SyncedVisit,
} from "../../model/runtime";

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
  options?: { q?: string },
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

export async function publish(
  http: RuntimeHttp,
  token: string,
  agentDir: string,
  name: string,
  role: string,
  summary: string,
  agentId?: string,
): Promise<PublishedAgent> {
  const payload = await http.request("/agents/publish", token, {
    agent_dir: agentDir,
    name,
    role,
    summary,
    ...(agentId ? { agent_id: agentId } : {}),
  });
  if (
    typeof payload.agent_id !== "string" ||
    typeof payload.name !== "string" ||
    typeof payload.summary !== "string" ||
    typeof payload.version !== "number" ||
    typeof payload.digest !== "string"
  ) {
    throw new DesktopApiError("发布响应无效");
  }
  return {
    agentId: payload.agent_id,
    name: payload.name,
    role: typeof payload.role === "string" ? payload.role : "",
    summary: payload.summary,
    version: payload.version,
    digest: payload.digest,
  };
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

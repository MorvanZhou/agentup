/** 控制面团队套装：列表 / 发布 / 招募（建群在本机路由）。 */

import { BackendClientError } from "./errors.js";
import { requestJson } from "./http.js";
import type { AgentListQuery, TeamCard, TeamMember, TeamRecruitResult, TeamUpsertInput } from "./types.js";

export async function listTeams(
  backendUrl: string,
  token: string,
  query: AgentListQuery = {},
  fetchImpl: typeof fetch = fetch,
): Promise<TeamCard[]> {
  const payload = await requestJson(
    fetchImpl,
    backendUrl,
    "GET",
    `/v1/teams${teamListQuery(query)}`,
    undefined,
    token,
  );
  return parseTeamList(payload);
}

export async function listPublicTeams(
  backendUrl: string,
  query: AgentListQuery = {},
  fetchImpl: typeof fetch = fetch,
): Promise<TeamCard[]> {
  const payload = await requestJson(
    fetchImpl,
    backendUrl,
    "GET",
    `/v1/teams/public${teamListQuery({ q: query.q })}`,
  );
  return parseTeamList(payload);
}

export async function listOwnedTeams(
  backendUrl: string,
  token: string,
  query: AgentListQuery = {},
  fetchImpl: typeof fetch = fetch,
): Promise<TeamCard[]> {
  const payload = await requestJson(
    fetchImpl,
    backendUrl,
    "GET",
    `/v1/teams/owned${teamListQuery({ q: query.q })}`,
    undefined,
    token,
  );
  return parseTeamList(payload);
}

export async function getTeam(
  backendUrl: string,
  token: string,
  teamId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TeamCard> {
  const payload = await requestJson(
    fetchImpl,
    backendUrl,
    "GET",
    `/v1/teams/${encodeURIComponent(teamId)}`,
    undefined,
    token,
  );
  return teamCard(payload);
}

export async function createTeam(
  backendUrl: string,
  token: string,
  input: TeamUpsertInput,
  fetchImpl: typeof fetch = fetch,
): Promise<TeamCard> {
  const payload = await requestJson(
    fetchImpl,
    backendUrl,
    "POST",
    "/v1/teams",
    upsertBody(input),
    token,
  );
  return teamCard(payload);
}

export async function updateTeam(
  backendUrl: string,
  token: string,
  teamId: string,
  input: TeamUpsertInput,
  fetchImpl: typeof fetch = fetch,
): Promise<TeamCard> {
  const payload = await requestJson(
    fetchImpl,
    backendUrl,
    "PUT",
    `/v1/teams/${encodeURIComponent(teamId)}`,
    upsertBody(input),
    token,
  );
  return teamCard(payload);
}

export async function deleteTeam(
  backendUrl: string,
  token: string,
  teamId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await requestJson(
    fetchImpl,
    backendUrl,
    "DELETE",
    `/v1/teams/${encodeURIComponent(teamId)}`,
    undefined,
    token,
  );
}

export async function recruitTeam(
  backendUrl: string,
  token: string,
  teamId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TeamRecruitResult> {
  const payload = await requestJson(
    fetchImpl,
    backendUrl,
    "POST",
    `/v1/teams/${encodeURIComponent(teamId)}/recruit`,
    undefined,
    token,
  );
  return teamRecruit(payload);
}

function upsertBody(input: TeamUpsertInput): Record<string, unknown> {
  return {
    name: input.name,
    background: input.background,
    member_ids: input.memberIds,
    default_holder_agent_id: input.defaultHolderAgentId,
  };
}

function teamListQuery(query: AgentListQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.recruited === true) params.set("recruited", "true");
  const text = params.toString();
  return text ? `?${text}` : "";
}

function parseTeamList(payload: Record<string, unknown>): TeamCard[] {
  if (!Array.isArray(payload.teams)) throw new BackendClientError("团队列表无效", 200);
  return payload.teams.map(teamCard);
}

export function teamCard(value: unknown): TeamCard {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BackendClientError("团队无效", 200);
  }
  const payload = value as Record<string, unknown>;
  if (
    typeof payload.team_id !== "string" ||
    typeof payload.name !== "string" ||
    typeof payload.background !== "string" ||
    typeof payload.default_holder_agent_id !== "string" ||
    !Array.isArray(payload.members)
  ) {
    throw new BackendClientError("团队无效", 200);
  }
  const avatarUrl =
    typeof payload.avatar_url === "string" && payload.avatar_url.trim()
      ? payload.avatar_url
      : undefined;
  const recruitCount =
    typeof payload.recruit_count === "number" &&
    Number.isInteger(payload.recruit_count) &&
    payload.recruit_count >= 0
      ? payload.recruit_count
      : 0;
  return {
    teamId: payload.team_id,
    name: payload.name,
    background: payload.background,
    defaultHolderAgentId: payload.default_holder_agent_id,
    members: payload.members.map(teamMember),
    recruited: payload.recruited === true,
    hasAvatar: payload.has_avatar === true,
    recruitCount,
    createdAt: typeof payload.created_at === "string" ? payload.created_at : "",
    updatedAt: typeof payload.updated_at === "string" ? payload.updated_at : "",
    ...(avatarUrl ? { avatarUrl } : {}),
  };
}

function teamMember(value: unknown): TeamMember {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BackendClientError("团队成员无效", 200);
  }
  const payload = value as Record<string, unknown>;
  if (typeof payload.agent_id !== "string" || typeof payload.name !== "string") {
    throw new BackendClientError("团队成员无效", 200);
  }
  const avatarUrl =
    typeof payload.avatar_url === "string" && payload.avatar_url.trim()
      ? payload.avatar_url
      : undefined;
  return {
    agentId: payload.agent_id,
    name: payload.name,
    role: typeof payload.role === "string" ? payload.role : "",
    sortOrder: typeof payload.sort_order === "number" ? payload.sort_order : 0,
    hasAvatar: payload.has_avatar === true,
    ...(avatarUrl ? { avatarUrl } : {}),
  };
}

function teamRecruit(payload: Record<string, unknown>): TeamRecruitResult {
  if (
    typeof payload.team_id !== "string" ||
    typeof payload.name !== "string" ||
    typeof payload.default_holder_agent_id !== "string" ||
    !Array.isArray(payload.members)
  ) {
    throw new BackendClientError("团队招募响应无效", 200);
  }
  return {
    teamId: payload.team_id,
    name: payload.name,
    defaultHolderAgentId: payload.default_holder_agent_id,
    members: payload.members.map(teamMember),
  };
}

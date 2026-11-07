import type { TeamCard, TeamMemberCard } from "../../model/runtime/runtime";
import type { GroupRoom } from "./groups";
import { parseGroupsPayload } from "./groups";

import { DesktopApiError } from "./error";
import type { RuntimeHttp } from "./http";
import { agentListQuery } from "./readers";

export type TeamUpsertInput = {
  name: string;
  background: string;
  memberIds: string[];
  defaultHolderAgentId: string;
};

export type TeamRecruitResult = {
  teamId: string;
  name: string;
  defaultHolderAgentId: string;
  members: TeamMemberCard[];
  group: GroupRoom;
};

export async function publicTeams(
  http: RuntimeHttp,
  options?: { q?: string },
): Promise<TeamCard[]> {
  const payload = await http.request(`/teams/public${agentListQuery({ q: options?.q })}`);
  return readTeamList(payload);
}

export async function teams(
  http: RuntimeHttp,
  token: string,
  options?: { q?: string; recruited?: boolean },
): Promise<TeamCard[]> {
  const payload = await http.request(`/teams${agentListQuery(options)}`, token);
  return readTeamList(payload);
}

export async function ownedTeams(
  http: RuntimeHttp,
  token: string,
  options?: { q?: string },
): Promise<TeamCard[]> {
  const payload = await http.request(`/teams/owned${agentListQuery({ q: options?.q })}`, token);
  return readTeamList(payload);
}

export async function getTeam(http: RuntimeHttp, token: string, teamId: string): Promise<TeamCard> {
  const payload = await http.request(`/teams/${encodeURIComponent(teamId)}`, token);
  return readTeam(payload);
}

export async function createTeam(
  http: RuntimeHttp,
  token: string,
  input: TeamUpsertInput,
): Promise<TeamCard> {
  const payload = await http.request("/teams", token, upsertBody(input));
  return readTeam(payload);
}

export async function updateTeam(
  http: RuntimeHttp,
  token: string,
  teamId: string,
  input: TeamUpsertInput,
): Promise<TeamCard> {
  const payload = await http.request(
    `/teams/${encodeURIComponent(teamId)}`,
    token,
    upsertBody(input),
    "PUT",
  );
  return readTeam(payload);
}

export async function deleteTeam(http: RuntimeHttp, token: string, teamId: string): Promise<void> {
  await http.request(`/teams/${encodeURIComponent(teamId)}`, token, undefined, "DELETE");
}

export async function recruitTeam(
  http: RuntimeHttp,
  token: string,
  userId: string,
  teamId: string,
): Promise<TeamRecruitResult> {
  const payload = await http.request(`/teams/${encodeURIComponent(teamId)}/recruit`, token, {
    user_id: userId,
  });
  if (typeof payload.team_id !== "string" || typeof payload.name !== "string") {
    throw new DesktopApiError("团队招募响应无效");
  }
  const rooms = parseGroupsPayload([payload.group]);
  const group = rooms[0];
  if (!group) throw new DesktopApiError("团队招募响应无效");
  const membersRaw = Array.isArray(payload.members) ? payload.members : [];
  return {
    teamId: payload.team_id,
    name: payload.name,
    defaultHolderAgentId:
      typeof payload.default_holder_agent_id === "string" ? payload.default_holder_agent_id : "",
    members: membersRaw.map(readMember),
    group,
  };
}

function upsertBody(input: TeamUpsertInput): Record<string, unknown> {
  return {
    name: input.name,
    background: input.background,
    member_ids: input.memberIds,
    default_holder_agent_id: input.defaultHolderAgentId,
  };
}

function readTeamList(payload: Record<string, unknown>): TeamCard[] {
  if (!Array.isArray(payload.teams)) throw new DesktopApiError("团队列表无效");
  return payload.teams.map(readTeam);
}

function readTeam(item: unknown): TeamCard {
  if (typeof item !== "object" || item === null) throw new DesktopApiError("团队无效");
  const team = item as Record<string, unknown>;
  if (
    typeof team.team_id !== "string" ||
    typeof team.name !== "string" ||
    typeof team.background !== "string" ||
    typeof team.default_holder_agent_id !== "string" ||
    !Array.isArray(team.members)
  ) {
    throw new DesktopApiError("团队无效");
  }
  const avatarUrl =
    typeof team.avatar_url === "string" && team.avatar_url.trim() ? team.avatar_url : undefined;
  return {
    teamId: team.team_id,
    name: team.name,
    background: team.background,
    defaultHolderAgentId: team.default_holder_agent_id,
    members: team.members.map(readMember),
    recruited: team.recruited === true,
    hasAvatar: team.has_avatar === true,
    recruitCount:
      typeof team.recruit_count === "number" && Number.isInteger(team.recruit_count)
        ? team.recruit_count
        : 0,
    createdAt: typeof team.created_at === "string" ? team.created_at : "",
    updatedAt: typeof team.updated_at === "string" ? team.updated_at : "",
    ...(avatarUrl ? { avatarUrl } : {}),
  };
}

function readMember(item: unknown): TeamMemberCard {
  if (typeof item !== "object" || item === null) throw new DesktopApiError("团队成员无效");
  const member = item as Record<string, unknown>;
  if (typeof member.agent_id !== "string" || typeof member.name !== "string") {
    throw new DesktopApiError("团队成员无效");
  }
  const avatarUrl =
    typeof member.avatar_url === "string" && member.avatar_url.trim()
      ? member.avatar_url
      : undefined;
  return {
    agentId: member.agent_id,
    name: member.name,
    role: typeof member.role === "string" ? member.role : "",
    sortOrder: typeof member.sort_order === "number" ? member.sort_order : 0,
    hasAvatar: member.has_avatar === true,
    ...(avatarUrl ? { avatarUrl } : {}),
  };
}

/** 市场团队：列表/发布代理控制面；招募时本机 sync 全员并建群。 */

import type { Hono } from "hono";

import {
  createTeam,
  deleteTeam,
  getTeam,
  listOwnedTeams,
  listPublicTeams,
  listTeams,
  recruitTeam,
  updateTeam,
  type TeamCard,
  type TeamMember,
  type TeamUpsertInput,
} from "../../control/client.js";
import { BackendClientError } from "../../control/errors.js";
import { GroupError } from "../../session/group/index.js";
import { pageItems, TRANSCRIPT_PAGE_SIZE } from "../../session/transcript-page.js";
import type { GroupRoom } from "../../session/group/types.js";
import { ensureCachedAvatar } from "../agents/cached-avatar.js";
import { pushGroupMeta } from "../group-cloud.js";
import {
  bearer,
  json,
  LocalError,
  readJson,
  requireAgentId,
  requirePathUserId,
  text,
  uiLocaleFromRequest,
  type LocalAppDeps,
  type LocalAppEnv,
} from "../http.js";
import { resolveVisit } from "./agents.js";

export function registerTeamsRoutes(app: Hono<LocalAppEnv>, deps: LocalAppDeps): void {
  const { config } = deps;

  app.get("/teams/public", async (c) => {
    const q = c.req.query("q") ?? undefined;
    const userId = c.req.query("user_id") ?? "";
    const teams = await listPublicTeams(config.backendUrl, { q });
    const hydrated = await hydrateTeamCards(deps, userId, teams);
    return json(c, 200, { teams: hydrated.map(serializeTeamCard) });
  });

  app.get("/teams", async (c) => {
    const q = c.req.query("q") ?? undefined;
    const recruited = c.req.query("recruited") === "true" ? true : undefined;
    const userId = c.req.query("user_id") ?? "";
    const token = bearer(c);
    const teams = await listTeams(config.backendUrl, token, { q, recruited });
    const hydrated = await hydrateTeamCards(deps, userId, teams);
    return json(c, 200, { teams: hydrated.map(serializeTeamCard) });
  });

  app.get("/teams/owned", async (c) => {
    const q = c.req.query("q") ?? undefined;
    const userId = c.req.query("user_id") ?? "";
    const teams = await listOwnedTeams(config.backendUrl, bearer(c), { q });
    const hydrated = await hydrateTeamCards(deps, userId, teams);
    return json(c, 200, { teams: hydrated.map(serializeTeamCard) });
  });

  app.get("/teams/:teamId", async (c) => {
    const teamId = requireAgentId(c.req.param("teamId"));
    const userId = c.req.query("user_id") ?? "";
    const card = await getTeam(config.backendUrl, bearer(c), teamId);
    const hydrated = await hydrateTeamCard(deps, userId, card);
    return json(c, 200, serializeTeamCard(hydrated));
  });

  app.post("/teams", async (c) => {
    const body = await readJson(c);
    const input = parseUpsert(body);
    const userId = typeof body.user_id === "string" ? body.user_id : "";
    const card = await createTeam(config.backendUrl, bearer(c), input);
    const hydrated = await hydrateTeamCard(deps, userId, card);
    return json(c, 200, serializeTeamCard(hydrated));
  });

  app.put("/teams/:teamId", async (c) => {
    const teamId = requireAgentId(c.req.param("teamId"));
    const body = await readJson(c);
    const userId = typeof body.user_id === "string" ? body.user_id : "";
    const card = await updateTeam(config.backendUrl, bearer(c), teamId, parseUpsert(body));
    const hydrated = await hydrateTeamCard(deps, userId, card);
    return json(c, 200, serializeTeamCard(hydrated));
  });

  app.delete("/teams/:teamId", async (c) => {
    const teamId = requireAgentId(c.req.param("teamId"));
    await deleteTeam(config.backendUrl, bearer(c), teamId);
    return json(c, 200, { status: "ok" });
  });

  /**
   * 一键成群：控制面招募全员 → 逐人 sync → 全成功再建本机群并 upsert 云端元数据。
   * 任一 sync 失败：不建群；已 sync 的 visit 保留以便重试。
   */
  app.post("/teams/:teamId/recruit", async (c) => {
    const teamId = requireAgentId(c.req.param("teamId"));
    const token = bearer(c);
    const body = await readJson(c);
    const userId = requirePathUserId(text(body, "user_id"));
    const locale = uiLocaleFromRequest(c);

    let recruited;
    try {
      recruited = await recruitTeam(config.backendUrl, token, teamId);
    } catch (error) {
      rethrowCloud(error);
    }

    const failed: { agent_id: string; error: string }[] = [];
    for (const member of recruited.members) {
      try {
        await resolveVisit(
          config.userDataRoot,
          config.backendUrl,
          token,
          userId,
          member.agentId,
          locale,
        );
      } catch (error) {
        failed.push({
          agent_id: member.agentId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (failed.length > 0) {
      return json(c, 502, {
        error: "部分成员同步失败，未建群",
        code: "team_sync_partial",
        team_id: recruited.teamId,
        failed,
      });
    }

    try {
      const room = deps.groups.create({
        userId,
        title: recruited.name,
        members: recruited.members.map((member) => ({
          agentId: member.agentId,
          name: member.name,
        })),
        defaultHolderId: recruited.defaultHolderAgentId,
        sourceTeamId: recruited.teamId,
      });
      try {
        await pushGroupMeta(config.backendUrl, token, room);
      } catch (error) {
        deps.groups.remove(userId, room.id);
        rethrowCloud(error);
      }
      return json(c, 200, {
        team_id: recruited.teamId,
        name: recruited.name,
        default_holder_agent_id: recruited.defaultHolderAgentId,
        members: recruited.members.map((member) => ({
          agent_id: member.agentId,
          name: member.name,
          role: member.role,
          sort_order: member.sortOrder,
        })),
        group: pagedRoom(room),
      });
    } catch (error) {
      if (error instanceof GroupError) throw new LocalError(error.message, 400);
      rethrowCloud(error);
    }
  });
}

function parseUpsert(body: Record<string, unknown>): TeamUpsertInput {
  const memberIdsRaw = body.member_ids ?? body.memberIds;
  if (!Array.isArray(memberIdsRaw) || memberIdsRaw.some((item) => typeof item !== "string")) {
    throw new LocalError("成员无效", 400);
  }
  const defaultHolder =
    typeof body.default_holder_agent_id === "string"
      ? body.default_holder_agent_id
      : typeof body.defaultHolderAgentId === "string"
        ? body.defaultHolderAgentId
        : "";
  return {
    name: text(body, "name"),
    background: text(body, "background"),
    memberIds: memberIdsRaw as string[],
    defaultHolderAgentId: defaultHolder,
  };
}

/**
 * 成员头像落到本机 data URL（与 /agents 已招募路径同策略）。
 * 「已加群」以本机是否仍有该 sourceTeamId 为准，避免删群后控制面台账卡住。
 * 无 user_id 时跳过，仍回传远端 URL / 控制面 recruited。
 */
async function hydrateTeamCards(
  deps: LocalAppDeps,
  userId: string,
  teams: TeamCard[],
): Promise<TeamCard[]> {
  if (!userId.trim()) return teams;
  const localTeamIds = localSourceTeamIds(deps, userId);
  return Promise.all(teams.map((team) => hydrateTeamCard(deps, userId, team, localTeamIds)));
}

async function hydrateTeamCard(
  deps: LocalAppDeps,
  userId: string,
  card: TeamCard,
  localTeamIds?: Set<string>,
): Promise<TeamCard> {
  if (!userId.trim()) return card;
  const ids = localTeamIds ?? localSourceTeamIds(deps, userId);
  const members = await Promise.all(
    card.members.map((member) =>
      hydrateTeamMember(deps.config.userDataRoot, userId, member),
    ),
  );
  return { ...card, members, recruited: ids.has(card.teamId) };
}

function localSourceTeamIds(deps: LocalAppDeps, userId: string): Set<string> {
  const ids = new Set<string>();
  for (const room of deps.groups.list(userId)) {
    const raw = typeof room.sourceTeamId === "string" ? room.sourceTeamId.trim() : "";
    if (raw) ids.add(raw);
  }
  return ids;
}

async function hydrateTeamMember(
  userDataRoot: string,
  userId: string,
  member: TeamMember,
): Promise<TeamMember> {
  if (!member.hasAvatar || !member.avatarUrl) return member;
  const cached = await ensureCachedAvatar(
    userDataRoot,
    userId,
    member.agentId,
    member.avatarUrl,
  );
  if (!cached) return member;
  return { ...member, hasAvatar: true, avatarUrl: cached };
}

function serializeTeamCard(card: TeamCard): Record<string, unknown> {
  return {
    team_id: card.teamId,
    name: card.name,
    background: card.background,
    default_holder_agent_id: card.defaultHolderAgentId,
    members: card.members.map((member) => ({
      agent_id: member.agentId,
      name: member.name,
      role: member.role,
      sort_order: member.sortOrder,
      has_avatar: member.hasAvatar,
      ...(member.avatarUrl ? { avatar_url: member.avatarUrl } : {}),
    })),
    recruited: card.recruited,
    has_avatar: card.hasAvatar,
    ...(card.avatarUrl ? { avatar_url: card.avatarUrl } : {}),
    recruit_count: card.recruitCount,
    created_at: card.createdAt,
    updated_at: card.updatedAt,
  };
}

function pagedRoom(room: GroupRoom): GroupRoom & { linesHasMore: boolean } {
  const page = pageItems(room.lines, { limit: TRANSCRIPT_PAGE_SIZE });
  return { ...room, lines: page.items, linesHasMore: page.hasMore };
}

function rethrowCloud(error: unknown): never {
  if (error instanceof BackendClientError) {
    throw new LocalError(error.message, error.status >= 400 && error.status < 600 ? error.status : 502);
  }
  throw error;
}

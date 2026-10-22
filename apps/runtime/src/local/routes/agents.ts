import fs from "node:fs";
import path from "node:path";

import type { Hono } from "hono";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";

import {
  HttpPackageSource,
  listAgents,
  listOwnedAgents,
  listPublicAgents,
  publishAgent,
  recruitAgent,
  setAgentRemark,
  unrecruitAgent,
  updateAgentCard,
} from "../../control/client.js";
import type { AgentCard } from "../../control/types.js";
import { loadAgentSource, preparePublishSource } from "../../package/source.js";
import { BackendClientError } from "../../control/client.js";
import { Runtime, type Visit } from "../../package/sync.js";
import { ConfigError } from "../../config/load.js";
import { requireEnabledModelRef } from "../../config/provider.js";
import { parsePromptAttachments, removeStagedAttachment, stageAttachment } from "../../session/workspace/attachments.js";
import { clearContext, clearHistory, readHistory } from "../../session/history/history.js";
import { setVisitSessionModel } from "../../session/model/session-model.js";
import { listVisitSkills } from "../../session/skills/skills.js";
import { ensureCachedAvatar, readCachedAvatarDataUrl } from "../agents/cached-avatar.js";
import { listDiskSyncedAgents } from "../agents/disk-synced.js";
import { isLocalAgentId, localAgentVisit } from "../agents/local-agent.js";
import { readLocalPackageVersions } from "../agents/versions.js";
import {
  bearer,
  json,
  LocalError,
  optionalText,
  readJson,
  requireAgentId,
  requirePathUserId,
  requireUserId,
  text,
  uiLocaleFromRequest,
  type LocalAppDeps,
  type LocalAppEnv,
} from "../http.js";
import { promptRewind, promptText, streamPrompt } from "../prompt.js";
import { serializeAgentCard, sessionModelBody } from "../serialize.js";
import { clearAgentChatUi, forgetAgent } from "../user/state.js";

function visitKind(agentId: string): Visit["kind"] {
  return isLocalAgentId(agentId) ? "local" : "recruited";
}

/**
 * 解析对话用 visit：本机私有不经控制面；市场 Agent 优先 sync，
 * 控制面不可达时回落本机已投影目录（本地 App 离线可聊）。
 */
async function resolveVisit(
  userDataRoot: string,
  backendUrl: string,
  token: string,
  userId: string,
  agentId: string,
): Promise<Visit> {
  if (isLocalAgentId(agentId)) {
    return localAgentVisit(userDataRoot, userId, agentId);
  }
  try {
    return await new Runtime(new HttpPackageSource(backendUrl, token), userDataRoot).sync(
      userId,
      agentId,
    );
  } catch (error) {
    // 控制面任意失败（断网 / 5xx / 鉴权）且本机已有投影 → 离线可聊；未招募仍抛 NotRecruited
    const disk = Runtime.openDiskVisit(userDataRoot, userId, agentId);
    if (disk && error instanceof BackendClientError) return disk;
    throw error;
  }
}

export function registerAgentsRoutes(app: Hono<LocalAppEnv>, deps: LocalAppDeps): void {
  const { config, chats, approvals, delegation, readModel } = deps;

  app.get("/agents/public", async (c) => {
    const q = c.req.query("q") ?? undefined;
    const agents = await listPublicAgents(config.backendUrl, { q });
    return json(c, 200, { agents: agents.map((agent) => serializeAgentCard(agent, 0)) });
  });

  app.get("/agents", async (c) => {
    const q = c.req.query("q") ?? undefined;
    const recruited = c.req.query("recruited") === "true" ? true : undefined;
    const userId = c.req.query("user_id") ?? "";
    const token = bearer(c);
    let agents: AgentCard[];
    let fromDisk = false;
    try {
      agents = await listAgents(config.backendUrl, token, { q, recruited });
    } catch (error) {
      // 控制面不可达：用本机已投影的招募 Agent，避免侧栏被桌面 refresh 清空
      if (!userId) throw error;
      fromDisk = true;
      const needle = q?.trim().toLowerCase() ?? "";
      agents = listDiskSyncedAgents(config.userDataRoot, userId)
        .filter((agent) => {
          // 磁盘投影均为已招募；未带 recruited=true 时也只回这些，市场浏览离线为空属预期
          if (!needle) return true;
          return `${agent.name}\n${agent.role}\n${agent.background}`.toLowerCase().includes(needle);
        })
        .map(
          (agent): AgentCard => ({
            agentId: agent.agentId,
            name: agent.name,
            role: agent.role,
            background: agent.background,
            rules: "",
            latestVersion: agent.packageVersion,
            latestDigest: agent.packageDigest,
            recruited: true,
            hasAvatar: false,
            remark: agent.remark,
            recruitCount: 0,
            createdAt: "",
            updatedAt: "",
          }),
        );
    }
    const localVersions = userId ? readLocalPackageVersions(config.userDataRoot, userId) : {};
    const withAvatars = userId
      ? await Promise.all(
          agents.map(async (agent) => {
            if (fromDisk) {
              const cached = readCachedAvatarDataUrl(config.userDataRoot, userId, agent.agentId);
              return cached ? { ...agent, hasAvatar: true, avatarUrl: cached } : agent;
            }
            // 已招募 / 本机已投影：把头像落到 visit，离线侧栏可继续用
            const shouldPersist = agent.recruited || Boolean(localVersions[agent.agentId]);
            if (shouldPersist && agent.hasAvatar && agent.avatarUrl) {
              const cached = await ensureCachedAvatar(
                config.userDataRoot,
                userId,
                agent.agentId,
                agent.avatarUrl,
              );
              if (cached) return { ...agent, hasAvatar: true, avatarUrl: cached };
            }
            const cached = readCachedAvatarDataUrl(config.userDataRoot, userId, agent.agentId);
            if (cached) return { ...agent, hasAvatar: true, avatarUrl: cached };
            return agent;
          }),
        )
      : agents;
    return json(c, 200, {
      agents: withAvatars.map((agent) =>
        serializeAgentCard(agent, localVersions[agent.agentId] ?? 0),
      ),
    });
  });

  app.get("/agents/owned", async (c) => {
    const q = c.req.query("q") ?? undefined;
    const agents = await listOwnedAgents(config.backendUrl, bearer(c), { q });
    return json(c, 200, {
      agents: agents.map((agent) => ({
        agent_id: agent.agentId,
        name: agent.name,
        role: agent.role,
        background: agent.background,
        latest_version: agent.latestVersion,
        latest_digest: agent.latestDigest,
        recruited: agent.recruited,
        has_avatar: agent.hasAvatar,
        avatar_url: agent.avatarUrl ?? null,
        remark: agent.remark,
        recruit_count: agent.recruitCount,
        created_at: agent.createdAt,
        updated_at: agent.updatedAt,
      })),
    });
  });

  app.post("/agents/inspect", async (c) => {
    bearer(c);
    const source = loadAgentSource(text(await readJson(c), "agent_dir"));
    return json(c, 200, {
      file_count: Object.keys(source.files).length,
      ...(source.avatar && source.avatarMime
        ? {
            avatar_preview: `data:${source.avatarMime};base64,${Buffer.from(source.avatar).toString("base64")}`,
          }
        : {}),
    });
  });

  app.post("/agents/publish", async (c) => {
    const body = await readJson(c);
    const locale = uiLocaleFromRequest(c);
    const name = text(body, "name");
    const role = text(body, "role");
    const background = optionalText(body, "background") ?? text(body, "summary");
    const rules = optionalText(body, "rules") ?? "";
    const published = await publishAgent(
      config.backendUrl,
      bearer(c),
      preparePublishSource(text(body, "agent_dir"), { name, role, background }, locale),
      name,
      role,
      background,
      optionalText(body, "agent_id"),
      rules,
    );
    return json(c, 200, {
      agent_id: published.agentId,
      name: published.name,
      role: published.role,
      background: published.background,
      version: published.version,
      digest: published.digest,
    });
  });

  /** 仅更新名片层（含规则），不换运行包。 */
  app.put("/agents/:agentId/card", async (c) => {
    const agentId = requireAgentId(c.req.param("agentId"));
    const body = await readJson(c);
    const avatarDataUrl = optionalText(body, "avatar_data_url");
    let avatar: Uint8Array | undefined;
    if (avatarDataUrl) {
      const match = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=\s]+)$/.exec(avatarDataUrl);
      if (!match) throw new LocalError("头像无效", 400);
      avatar = Uint8Array.from(Buffer.from(match[1]!.replace(/\s/g, ""), "base64"));
    }
    const card = await updateAgentCard(config.backendUrl, bearer(c), agentId, {
      name: text(body, "name"),
      role: text(body, "role"),
      background: optionalText(body, "background") ?? text(body, "summary"),
      rules: typeof body.rules === "string" ? body.rules : "",
      ...(avatar ? { avatar } : {}),
    });
    return json(c, 200, serializeAgentCard(card, 0));
  });

  /** 停止当前 turn，并等到 busy 解开（桌面点停止后应先调此接口再重发）。 */
  app.post("/agents/:agentId/abort", async (c) => {
    bearer(c);
    const agentId = requireAgentId(c.req.param("agentId"));
    const body = await readJson(c);
    const userId = requirePathUserId(text(body, "user_id"));
    await chats.abort(userId, agentId, visitKind(agentId));
    return json(c, 200, { aborted: true });
  });

  app.post("/agents/:agentId/context", async (c) => {
    bearer(c);
    const agentId = requireAgentId(c.req.param("agentId"));
    const body = await readJson(c);
    const userId = requirePathUserId(text(body, "user_id"));
    const kind = visitKind(agentId);
    await chats.abort(userId, agentId, kind);
    clearContext(config.userDataRoot, userId, agentId);
    chats.release(userId, agentId, kind);
    approvals.clearSessionAllow(userId, agentId);
    return json(c, 200, { cleared: true });
  });

  app.get("/agents/:agentId/skills", (c) => {
    bearer(c);
    const agentId = requireAgentId(c.req.param("agentId"));
    const userId = requireUserId(c.req.query("user_id") ?? null);
    const visitRoot = path.join(config.userDataRoot, "users", userId, "agents", agentId);
    const visit: Visit = {
      kind: visitKind(agentId),
      userId,
      agentId,
      root: visitRoot,
      packageVersion: 0,
      packageDigest: "",
      tools: [],
      modelCapabilities: [],
      projectTrust: "granted",
    };
    return json(c, 200, { skills: listVisitSkills(visit) });
  });

  app.get("/agents/:agentId/history", async (c) => {
    bearer(c);
    const agentId = requireAgentId(c.req.param("agentId"));
    const userId = requirePathUserId(c.req.query("user_id") ?? "");
    return json(c, 200, { messages: await readHistory(config.userDataRoot, userId, agentId) });
  });

  app.get("/agents/:agentId/session/model", (c) => {
    bearer(c);
    const agentId = requireAgentId(c.req.param("agentId"));
    const userId = requirePathUserId(c.req.query("user_id") ?? "");
    const locale = uiLocaleFromRequest(c);
    try {
      const visitRoot = path.join(config.userDataRoot, "users", userId, "agents", agentId);
      return json(
        c,
        200,
        sessionModelBody(
          config.userDataRoot,
          path.join(visitRoot, "cwd"),
          path.join(visitRoot, "sessions"),
          locale,
        ),
      );
    } catch (error) {
      if (error instanceof ConfigError) throw new LocalError(error.message, 400);
      throw error;
    }
  });

  app.put("/agents/:agentId/session/model", async (c) => {
    bearer(c);
    const agentId = requireAgentId(c.req.param("agentId"));
    const body = await readJson(c);
    const userId = requirePathUserId(text(body, "user_id"));
    const locale = uiLocaleFromRequest(c);
    try {
      const ref = requireEnabledModelRef(config.userDataRoot, {
        templateId: text(body, "template_id"),
        modelId: text(body, "model_id"),
      });
      const visitRoot = path.join(config.userDataRoot, "users", userId, "agents", agentId);
      const cwd = path.join(visitRoot, "cwd");
      const sessionDir = path.join(visitRoot, "sessions");
      setVisitSessionModel(config.userDataRoot, cwd, sessionDir, ref);
      chats.invalidate(userId, agentId, visitKind(agentId));
      return json(c, 200, sessionModelBody(config.userDataRoot, cwd, sessionDir, locale));
    } catch (error) {
      if (error instanceof ConfigError) throw new LocalError(error.message, 400);
      throw error;
    }
  });

  app.delete("/agents/:agentId/history", async (c) => {
    bearer(c);
    const agentId = requireAgentId(c.req.param("agentId"));
    const userId = requirePathUserId(c.req.query("user_id") ?? "");
    const kind = visitKind(agentId);
    await chats.abort(userId, agentId, kind);
    clearHistory(config.userDataRoot, userId, agentId);
    chats.release(userId, agentId, kind);
    approvals.clearSessionAllow(userId, agentId);
    clearAgentChatUi(config.userDataRoot, userId, agentId);
    return json(c, 200, { cleared: true });
  });

  app.put("/agents/:agentId/remark", async (c) => {
    const agentId = requireAgentId(c.req.param("agentId"));
    const body = await readJson(c);
    if (typeof body.remark !== "string") throw new LocalError("备注名无效", 400);
    const recruit = await setAgentRemark(config.backendUrl, bearer(c), agentId, body.remark);
    return json(c, 200, {
      user_id: recruit.userId,
      agent_id: recruit.agentId,
      name: recruit.name,
      latest_version: recruit.latestVersion,
      latest_digest: recruit.latestDigest,
      remark: recruit.remark,
    });
  });

  app.post("/agents/:agentId/attachments", async (c) => {
    bearer(c);
    const agentId = requireAgentId(c.req.param("agentId"));
    const body = await readJson(c);
    const userId = requireUserId(text(body, "user_id"));
    const [attachment] = parsePromptAttachments({ attachments: [body] });
    if (!attachment) throw new LocalError("请求无效", 400);
    const cwd = path.join(config.userDataRoot, "users", userId, "agents", agentId, "cwd");
    fs.mkdirSync(cwd, { recursive: true });
    const staged = stageAttachment(cwd, attachment);
    return json(c, 200, {
      id: staged.id,
      path: staged.path,
      ref: staged.ref,
      name: staged.name,
      media_type: staged.mediaType,
    });
  });

  app.delete("/agents/:agentId/attachments", (c) => {
    bearer(c);
    const agentId = requireAgentId(c.req.param("agentId"));
    const userId = requireUserId(c.req.query("user_id") ?? null);
    const filePath = c.req.query("path") ?? "";
    const cwd = path.join(config.userDataRoot, "users", userId, "agents", agentId, "cwd");
    if (!fs.existsSync(cwd)) {
      return json(c, 200, { deleted: true });
    }
    removeStagedAttachment(cwd, filePath);
    return json(c, 200, { deleted: true });
  });

  app.post("/agents/:agentId/recruit", async (c) => {
    const agentId = requireAgentId(c.req.param("agentId"));
    const recruit = await recruitAgent(config.backendUrl, bearer(c), agentId);
    return json(c, 200, {
      user_id: recruit.userId,
      agent_id: recruit.agentId,
      name: recruit.name,
      latest_version: recruit.latestVersion,
      latest_digest: recruit.latestDigest,
      remark: recruit.remark,
    });
  });

  app.post("/agents/:agentId/dismiss", async (c) => {
    const agentId = requireAgentId(c.req.param("agentId"));
    const token = bearer(c);
    const body = await readJson(c);
    const userId = requirePathUserId(text(body, "user_id"));
    if (isLocalAgentId(agentId)) {
      throw new LocalError("本机 Agent 请使用删除，而非解雇", 400);
    }
    chats.release(userId, agentId);
    await unrecruitAgent(config.backendUrl, token, agentId);
    removeVisitRoot(config.userDataRoot, userId, agentId);
    forgetAgent(config.userDataRoot, userId, agentId);
    return json(c, 200, { status: "ok" });
  });

  app.post("/agents/:agentId/prompt", async (c) => {
    const agentId = requireAgentId(c.req.param("agentId"));
    const token = bearer(c);
    const body = await readJson(c);
    const userId = requirePathUserId(text(body, "user_id"));
    const locale = uiLocaleFromRequest(c);
    const visit = await resolveVisit(config.userDataRoot, config.backendUrl, token, userId, agentId);
    delegation.bindAuth(userId, token);
    try {
      await streamPrompt(
        chats,
        readModel,
        visit,
        promptText(body),
        c.env.incoming,
        c.env.outgoing,
        promptRewind(body),
        parsePromptAttachments(body),
        config.userDataRoot,
        locale,
      );
    } finally {
      delegation.unbindAuth(userId);
    }
    return RESPONSE_ALREADY_SENT;
  });

  app.post("/agents/:agentId/directory", async (c) => {
    const agentId = requireAgentId(c.req.param("agentId"));
    const token = bearer(c);
    const body = await readJson(c);
    const userId = requirePathUserId(text(body, "user_id"));
    const visit = await resolveVisit(config.userDataRoot, config.backendUrl, token, userId, agentId);
    return json(c, 200, { path: visit.root });
  });

  app.post("/agents/:agentId/sync", async (c) => {
    const agentId = requireAgentId(c.req.param("agentId"));
    const token = bearer(c);
    const body = await readJson(c);
    const userId = requirePathUserId(text(body, "user_id"));
    const visit = await resolveVisit(config.userDataRoot, config.backendUrl, token, userId, agentId);
    // 运行包不含头像；同步后尽量把 statics 头像落到本机
    if (!isLocalAgentId(agentId)) {
      try {
        const cards = await listAgents(config.backendUrl, token, { recruited: true });
        const card = cards.find((item) => item.agentId === agentId);
        if (card?.hasAvatar && card.avatarUrl) {
          await ensureCachedAvatar(config.userDataRoot, userId, agentId, card.avatarUrl);
        }
      } catch {
        /* 头像缓存失败不阻断 sync */
      }
    }
    return json(c, 200, {
      user_id: visit.userId,
      agent_id: visit.agentId,
      package_version: visit.packageVersion,
      package_digest: visit.packageDigest,
    });
  });
}

/** 删除约定 visit 根目录；路径必须落在 users/<user_id>/agents/<agent_id>/。 */
function removeVisitRoot(userDataRoot: string, userId: string, agentId: string): void {
  const agentsRoot = path.resolve(userDataRoot, "users", userId, "agents");
  const visitRoot = path.resolve(agentsRoot, agentId);
  if (!visitRoot.startsWith(`${agentsRoot}${path.sep}`)) {
    throw new LocalError("请求无效", 400);
  }
  if (fs.existsSync(visitRoot)) fs.rmSync(visitRoot, { recursive: true, force: true });
}

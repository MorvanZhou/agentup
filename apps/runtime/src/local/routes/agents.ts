import fs from "node:fs";
import path from "node:path";

import type { Hono } from "hono";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";

import {
  deleteOwnedAgent,
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
import { previewOwnedPublishEditor, publishFromForm } from "../../package/publish-form.js";
import { loadAgentSource, preparePublishSource } from "../../package/source.js";
import { BackendClientError } from "../../control/client.js";
import { Runtime, type Visit } from "../../package/sync.js";
import { ConfigError } from "../../config/load.js";
import { requireEnabledModelRef } from "../../config/provider.js";
import { parsePromptAttachments, removeStagedAttachment, stageAttachment } from "../../session/workspace/attachments.js";
import { parseTranscriptPageQuery } from "../../session/transcript-page.js";
import { clearContext, clearHistory, readHistory, readHistoryPage } from "../../session/history/history.js";
import { setVisitSessionModel } from "../../session/model/session-model.js";
import { listVisitSkills } from "../../session/skills/skills.js";
import {
  ensureCachedAvatar,
  readCachedAvatarDataUrl,
  writeCachedAvatarDataUrl,
} from "../agents/cached-avatar.js";
import { listDiskSyncedAgents } from "../agents/disk-synced.js";
import { isLocalAgentId, localAgentVisit } from "../agents/local-agent.js";
import { readLocalPackageVersions } from "../agents/versions.js";
import {
  AGENT_ID,
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
import {
  readAgentApprovals,
  writeAgentApprovals,
  type AgentApprovals,
  type AgentApprovalsPatch,
  type ApprovalChoice,
} from "../approvals/visit-approvals.js";
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
            // 已招募 / 本机已投影：把头像落到 visit；remote URL（含 ?v=）变了会重拉
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
            // 有远程 URL 时勿用未校验版本的旧缓存盖掉（市场浏览走 ?v= 即可）
            if (agent.hasAvatar && agent.avatarUrl) return agent;
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
    const userId = c.req.query("user_id") ?? "";
    const agents = await listOwnedAgents(config.backendUrl, bearer(c), { q });
    // 与已招募列表一致：落到本机 data URL，避免「我发布的」仍吃浏览器对无 ?v= 远程图的缓存
    const withAvatars = userId
      ? await Promise.all(
          agents.map(async (agent) => {
            if (agent.hasAvatar && agent.avatarUrl) {
              const cached = await ensureCachedAvatar(
                config.userDataRoot,
                userId,
                agent.agentId,
                agent.avatarUrl,
              );
              if (cached) return { ...agent, hasAvatar: true, avatarUrl: cached };
            }
            return agent;
          }),
        )
      : agents;
    return json(c, 200, {
      agents: withAvatars.map((agent) => ({
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

  /** 更新页预览：名片 + 包内 skills/MCP，不创建 loc-*。 */
  app.post("/agents/publish-editor/preview", async (c) => {
    const body = await readJson(c);
    const preview = await previewOwnedPublishEditor(
      config.backendUrl,
      bearer(c),
      text(body, "published_agent_id"),
    );
    return json(c, 200, {
      agent_id: preview.agentId,
      name: preview.name,
      role: preview.role,
      background: preview.background,
      rules: preview.rules,
      skills: preview.skills,
      mcp_servers: preview.mcpServers,
      avatar_url: preview.avatarUrl ?? null,
    });
  });

  /**
   * 市场发布表单：临时组包上传，不落盘 loc-*。
   * 本机 Agent 一键发布仍用下方 /agents/publish + agent_dir。
   */
  app.post("/agents/publish-editor", async (c) => {
    const body = await readJson(c);
    const locale = uiLocaleFromRequest(c);
    const skillPaths = readStringList(body.skill_paths, "skill_paths");
    const removeSkills = readStringList(body.remove_skills, "remove_skills");
    const mcpServers = readOptionalMcp(body);
    const agentId = optionalText(body, "agent_id");
    const avatarDataUrl = optionalText(body, "avatar_data_url");
    const published = await publishFromForm(
      config.backendUrl,
      bearer(c),
      {
        name: text(body, "name"),
        role: text(body, "role"),
        background: optionalText(body, "background") ?? text(body, "summary"),
        rules: optionalText(body, "rules") ?? "",
        ...(agentId ? { agentId } : {}),
        ...(skillPaths.length ? { skillPaths } : {}),
        ...(removeSkills.length ? { removeSkills } : {}),
        ...(mcpServers !== undefined ? { mcpServers } : {}),
        ...(avatarDataUrl ? { avatarDataUrl } : {}),
      },
      locale,
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
    const userId = optionalText(body, "user_id");
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
    // 立刻覆盖本机缓存，避免列表仍展示旧 data URL
    if (avatarDataUrl && userId) {
      writeCachedAvatarDataUrl(
        config.userDataRoot,
        userId,
        agentId,
        avatarDataUrl,
        card.avatarUrl,
      );
    }
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

  app.get("/agents/:agentId/approvals", (c) => {
    bearer(c);
    const agentId = requireAgentId(c.req.param("agentId"));
    const userId = requireUserId(c.req.query("user_id") ?? null);
    return json(c, 200, serializeApprovals(readAgentApprovals(config.userDataRoot, userId, agentId)));
  });

  app.put("/agents/:agentId/approvals", async (c) => {
    bearer(c);
    const agentId = requireAgentId(c.req.param("agentId"));
    const body = await readJson(c);
    const userId = requirePathUserId(text(body, "user_id"));
    const patch = parseApprovalsPatch(body);
    return json(
      c,
      200,
      serializeApprovals(writeAgentApprovals(config.userDataRoot, userId, agentId, patch)),
    );
  });

  app.get("/agents/:agentId/history", async (c) => {
    bearer(c);
    const agentId = requireAgentId(c.req.param("agentId"));
    const userId = requirePathUserId(c.req.query("user_id") ?? "");
    const query = parseTranscriptPageQuery(c.req.query("limit"), c.req.query("before"));
    if (!query) throw new LocalError("请求无效", 400);
    if (query.full) {
      return json(c, 200, { messages: await readHistory(config.userDataRoot, userId, agentId) });
    }
    const page = await readHistoryPage(config.userDataRoot, userId, agentId, {
      limit: query.limit,
      beforeId: query.beforeId,
    });
    return json(c, 200, { messages: page.messages, hasMore: page.hasMore });
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

  app.delete("/agents/:agentId", async (c) => {
    const agentId = requireAgentId(c.req.param("agentId"));
    const token = bearer(c);
    const userId = requirePathUserId(c.req.query("user_id") ?? "");
    if (isLocalAgentId(agentId)) {
      throw new LocalError("本机 Agent 请使用本地删除接口", 400);
    }
    await deleteOwnedAgent(config.backendUrl, token, agentId);
    chats.release(userId, agentId);
    removeVisitRoot(config.userDataRoot, userId, agentId);
    forgetAgent(config.userDataRoot, userId, agentId);
    return json(c, 200, { status: "ok" });
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

function serializeApprovals(value: AgentApprovals) {
  return {
    command: value.command,
    tools: value.tools.map((tool) => ({
      tool_name: tool.toolName,
      kind: tool.kind,
      label: tool.label,
      scope: tool.scope,
    })),
    delegation: {
      anyone: value.delegation.anyone,
      targets: value.delegation.targets.map((item) => ({
        agent_id: item.agentId,
        scope: item.scope,
      })),
    },
  };
}

function parseApprovalsPatch(body: Record<string, unknown>): AgentApprovalsPatch {
  const patch: AgentApprovalsPatch = {};
  if (body.command !== undefined) {
    patch.command = requireApprovalChoice(body.command, "command");
  }
  if (body.tools !== undefined) {
    if (!Array.isArray(body.tools)) throw new LocalError("tools 无效", 400);
    patch.tools = body.tools.map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new LocalError(`tools[${index}] 无效`, 400);
      }
      const row = item as Record<string, unknown>;
      const toolName = row.tool_name;
      if (typeof toolName !== "string" || !toolName.trim()) {
        throw new LocalError(`tools[${index}].tool_name 无效`, 400);
      }
      return {
        toolName: toolName.trim(),
        scope: requireApprovalChoice(row.scope, `tools[${index}].scope`),
      };
    });
  }
  if (body.delegation !== undefined) {
    if (!body.delegation || typeof body.delegation !== "object" || Array.isArray(body.delegation)) {
      throw new LocalError("delegation 无效", 400);
    }
    const delegation = body.delegation as Record<string, unknown>;
    patch.delegation = {};
    if (delegation.anyone !== undefined) {
      const anyone = requireApprovalChoice(delegation.anyone, "delegation.anyone");
      if (anyone === "session") throw new LocalError("delegation.anyone 无效", 400);
      patch.delegation.anyone = anyone;
    }
    if (delegation.targets !== undefined) {
      if (!Array.isArray(delegation.targets)) throw new LocalError("delegation.targets 无效", 400);
      patch.delegation.targets = delegation.targets.map((item, index) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          throw new LocalError(`delegation.targets[${index}] 无效`, 400);
        }
        const row = item as Record<string, unknown>;
        const agentId = row.agent_id;
        if (typeof agentId !== "string" || !AGENT_ID.test(agentId)) {
          throw new LocalError(`delegation.targets[${index}].agent_id 无效`, 400);
        }
        return {
          agentId,
          scope: requireApprovalChoice(row.scope, `delegation.targets[${index}].scope`),
        };
      });
    }
  }
  return patch;
}

function requireApprovalChoice(value: unknown, field: string): ApprovalChoice {
  if (value !== "once" && value !== "session" && value !== "agent") {
    throw new LocalError(`${field} 无效`, 400);
  }
  return value;
}

function readStringList(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new LocalError(`${field} 无效`, 400);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

function readOptionalMcp(body: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!Object.prototype.hasOwnProperty.call(body, "mcp_servers")) return undefined;
  const value = body.mcp_servers;
  if (value === null || value === "") return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new LocalError("mcp_servers 无效", 400);
  }
  return value as Record<string, unknown>;
}

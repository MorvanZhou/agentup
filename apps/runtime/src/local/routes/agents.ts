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
} from "../../control/client.js";
import { loadAgentSource } from "../../package/source.js";
import { Runtime, type Visit } from "../../package/sync.js";
import { ConfigError } from "../../config/load.js";
import { requireEnabledModelRef } from "../../config/provider.js";
import { parsePromptAttachments, removeStagedAttachment, stageAttachment } from "../../session/attachments.js";
import { clearContext, clearHistory, readHistory } from "../../session/history.js";
import { setVisitSessionModel } from "../../session/session-model.js";
import { listVisitSkills } from "../../session/skills.js";
import { readLocalPackageVersions } from "../local-versions.js";
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
import { clearAgentChatUi, forgetAgent } from "../state.js";

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
    const agents = await listAgents(config.backendUrl, bearer(c), { q, recruited });
    const userId = c.req.query("user_id") ?? "";
    const localVersions = userId ? readLocalPackageVersions(config.userDataRoot, userId) : {};
    return json(c, 200, {
      agents: agents.map((agent) => serializeAgentCard(agent, localVersions[agent.agentId] ?? 0)),
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
        summary: agent.summary,
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
    const published = await publishAgent(
      config.backendUrl,
      bearer(c),
      loadAgentSource(text(body, "agent_dir")),
      text(body, "name"),
      text(body, "role"),
      text(body, "summary"),
      optionalText(body, "agent_id"),
    );
    return json(c, 200, {
      agent_id: published.agentId,
      name: published.name,
      role: published.role,
      summary: published.summary,
      version: published.version,
      digest: published.digest,
    });
  });

  app.post("/agents/:agentId/context", async (c) => {
    bearer(c);
    const agentId = requireAgentId(c.req.param("agentId"));
    const body = await readJson(c);
    const userId = requirePathUserId(text(body, "user_id"));
    await chats.abort(userId, agentId);
    clearContext(config.userDataRoot, userId, agentId);
    chats.release(userId, agentId);
    approvals.clearSessionAllow(userId, agentId);
    return json(c, 200, { cleared: true });
  });

  app.get("/agents/:agentId/skills", (c) => {
    bearer(c);
    const agentId = requireAgentId(c.req.param("agentId"));
    const userId = requireUserId(c.req.query("user_id") ?? null);
    const visitRoot = path.join(config.userDataRoot, "users", userId, "agents", agentId);
    const visit: Visit = {
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
      chats.invalidate(userId, agentId);
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
    await chats.abort(userId, agentId);
    clearHistory(config.userDataRoot, userId, agentId);
    chats.release(userId, agentId);
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
    const visit = await new Runtime(new HttpPackageSource(config.backendUrl, token), config.userDataRoot).sync(
      userId,
      agentId,
    );
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
    const visit = await new Runtime(new HttpPackageSource(config.backendUrl, token), config.userDataRoot).sync(
      userId,
      agentId,
    );
    return json(c, 200, { path: visit.root });
  });

  app.post("/agents/:agentId/sync", async (c) => {
    const agentId = requireAgentId(c.req.param("agentId"));
    const token = bearer(c);
    const body = await readJson(c);
    const userId = requirePathUserId(text(body, "user_id"));
    const visit = await new Runtime(new HttpPackageSource(config.backendUrl, token), config.userDataRoot).sync(
      userId,
      agentId,
    );
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

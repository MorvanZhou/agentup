import fs from "node:fs";
import path from "node:path";

import type { Hono } from "hono";

import {
  downloadAgentSkill,
  HttpPackageSource,
  listOwnedAgents,
} from "../../control/client.js";
import {
  bindLocalPublishedAgent,
  createLocalAgent,
  deleteLocalAgent,
  exportLocalAgentSkill,
  importPublishedAsLocalDraft,
  LocalAgentError,
  listLocalAgents,
  readLocalAgentCard,
  writeLocalAgentCard,
  type LocalAgentCard,
} from "../local-agent.js";
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
import { clearAgentChatUi, forgetAgent } from "../state.js";

function serializeLocalCard(card: LocalAgentCard) {
  return {
    kind: "local" as const,
    agent_id: card.agentId,
    name: card.name,
    role: card.role,
    background: card.background,
    rules: card.rules,
    skills: card.skills,
    mcp_servers: card.mcpServers,
    published_agent_id: card.publishedAgentId ?? null,
    latest_version: 1,
    latest_digest: card.packageDigest,
    local_version: 1,
    recruited: true,
    has_avatar: Boolean(card.avatarUrl),
    avatar_url: card.avatarUrl ?? null,
    remark: "",
    recruit_count: 0,
    created_at: card.createdAt,
    updated_at: card.updatedAt,
  };
}

function readSkillPaths(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new LocalError("skill_paths 无效", 400);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

function readMcpServers(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new LocalError("mcp_servers 无效", 400);
  }
  return value as Record<string, unknown>;
}

function readBackground(body: Record<string, unknown>): string {
  if (Object.prototype.hasOwnProperty.call(body, "background")) return text(body, "background");
  // 一版兼容窗口：旧客户端仍可发送 summary。
  return text(body, "summary");
}

function readOptionalRules(body: Record<string, unknown>): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(body, "rules")) return undefined;
  const value = body.rules;
  if (typeof value !== "string") throw new LocalError("rules 无效", 400);
  return value;
}

/** 与 skill_paths 相同校验；用于编辑时卸载已装技能。 */
function readSkillNames(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new LocalError("remove_skills 无效", 400);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

/** 本机私有 Agent：与公开同构的 cwd/.pi，可一键发布。 */
export function registerLocalAgentsRoutes(app: Hono<LocalAppEnv>, deps: LocalAppDeps): void {
  const { config, chats, approvals } = deps;

  app.get("/agents/local", (c) => {
    bearer(c);
    const userId = requireUserId(c.req.query("user_id") ?? null);
    const q = (c.req.query("q") ?? "").trim().toLowerCase();
    let agents = listLocalAgents(config.userDataRoot, userId).map(serializeLocalCard);
    if (q) {
      agents = agents.filter(
        (agent) =>
          agent.name.toLowerCase().includes(q) ||
          agent.role.toLowerCase().includes(q) ||
          agent.background.toLowerCase().includes(q) ||
          agent.agent_id.toLowerCase().includes(q),
      );
    }
    return json(c, 200, { agents });
  });

  app.post("/agents/local", async (c) => {
    bearer(c);
    const body = await readJson(c);
    const locale = uiLocaleFromRequest(c);
    const userId = requirePathUserId(text(body, "user_id"));
    const avatarDataUrl = optionalText(body, "avatar_data_url") || undefined;
    const rules = readOptionalRules(body);
    const skillPaths = readSkillPaths(body.skill_paths);
    const mcpServers = readMcpServers(body.mcp_servers);
    try {
      const card = await createLocalAgent(
        config.userDataRoot,
        userId,
        {
          name: text(body, "name"),
          role: text(body, "role"),
          background: readBackground(body),
          ...(rules !== undefined ? { rules } : {}),
          ...(avatarDataUrl ? { avatarDataUrl } : {}),
          ...(skillPaths.length ? { skillPaths } : {}),
          ...(mcpServers ? { mcpServers } : {}),
        },
        locale,
      );
      return json(c, 200, serializeLocalCard(card));
    } catch (error) {
      if (error instanceof LocalAgentError) throw new LocalError(error.message, 400);
      throw error;
    }
  });

  /** 无本机草稿时：从已发布包 hydrate 为绑定草稿。须在 :agentId 路由之前注册。 */
  app.post("/agents/local/from-published", async (c) => {
    bearer(c);
    const body = await readJson(c);
    const locale = uiLocaleFromRequest(c);
    const userId = requirePathUserId(text(body, "user_id"));
    const publishedAgentId = text(body, "published_agent_id");
    const token = bearer(c);
    try {
      const owned = await listOwnedAgents(config.backendUrl, token);
      const card = owned.find((item) => item.agentId === publishedAgentId);
      if (!card) throw new LocalError("找不到要更新的 Agent", 404);
      const release = await new HttpPackageSource(config.backendUrl, token).getPackage(publishedAgentId);
      let avatarDataUrl: string | undefined;
      if (card.avatarUrl) {
        try {
          const response = await fetch(card.avatarUrl);
          if (response.ok) {
            const bytes = Buffer.from(await response.arrayBuffer());
            const mime = response.headers.get("content-type")?.split(";")[0]?.trim() || "image/webp";
            avatarDataUrl = `data:${mime};base64,${bytes.toString("base64")}`;
          }
        } catch {
          // 头像拉取失败不阻断 hydrate
        }
      }
      const local = await importPublishedAsLocalDraft(
        config.userDataRoot,
        userId,
        {
          publishedAgentId,
          name: card.name,
          role: card.role,
          background: card.background,
          rules: card.rules || Buffer.from(release.files["AGENTS.md"] ?? []).toString("utf8"),
          ...(avatarDataUrl ? { avatarDataUrl } : {}),
          packageFiles: release.files,
        },
        locale,
      );
      return json(c, 200, serializeLocalCard(local));
    } catch (error) {
      if (error instanceof LocalAgentError) throw new LocalError(error.message, 400);
      throw error;
    }
  });

  app.get("/agents/local/:agentId", (c) => {
    bearer(c);
    const agentId = requireAgentId(c.req.param("agentId"));
    const userId = requireUserId(c.req.query("user_id") ?? null);
    try {
      return json(c, 200, serializeLocalCard(readLocalAgentCard(config.userDataRoot, userId, agentId)));
    } catch (error) {
      if (error instanceof LocalAgentError) throw new LocalError(error.message, 404);
      throw error;
    }
  });

  app.put("/agents/local/:agentId", async (c) => {
    bearer(c);
    const agentId = requireAgentId(c.req.param("agentId"));
    const body = await readJson(c);
    const locale = uiLocaleFromRequest(c);
    const userId = requirePathUserId(text(body, "user_id"));
    const avatarDataUrl =
      typeof body.avatar_data_url === "string" && body.avatar_data_url.trim()
        ? body.avatar_data_url.trim()
        : undefined;
    const rules = readOptionalRules(body);
    const skillPaths = readSkillPaths(body.skill_paths);
    const removeSkills = readSkillNames(body.remove_skills);
    const mcpServers = Object.prototype.hasOwnProperty.call(body, "mcp_servers")
      ? readMcpServers(body.mcp_servers) ?? {}
      : undefined;
    try {
      const card = await writeLocalAgentCard(
        config.userDataRoot,
        userId,
        agentId,
        {
          name: text(body, "name"),
          role: text(body, "role"),
          background: readBackground(body),
          ...(rules !== undefined ? { rules } : {}),
          ...(avatarDataUrl ? { avatarDataUrl } : {}),
          ...(skillPaths.length ? { skillPaths } : {}),
          ...(removeSkills.length ? { removeSkills } : {}),
          ...(mcpServers !== undefined ? { mcpServers } : {}),
        },
        locale,
      );
      chats.invalidate(userId, agentId, "local");
      return json(c, 200, serializeLocalCard(card));
    } catch (error) {
      if (error instanceof LocalAgentError) throw new LocalError(error.message, 400);
      throw error;
    }
  });

  app.post("/agents/local/:agentId/skills/:skillName/export", async (c) => {
    bearer(c);
    const agentId = requireAgentId(c.req.param("agentId"));
    const skillName = c.req.param("skillName");
    const body = await readJson(c);
    const locale = uiLocaleFromRequest(c);
    const userId = requirePathUserId(text(body, "user_id"));
    const destination = text(body, "destination");
    try {
      return json(c, 200, exportLocalAgentSkill(config.userDataRoot, userId, agentId, skillName, destination, locale));
    } catch (error) {
      if (error instanceof LocalAgentError) throw new LocalError(error.message, 400);
      throw error;
    }
  });

  /** 从控制面下载已发布 skill zip 到本机路径。 */
  app.post("/agents/published/:agentId/skills/:skillName/export", async (c) => {
    bearer(c);
    const agentId = requireAgentId(c.req.param("agentId"));
    const skillName = c.req.param("skillName");
    const body = await readJson(c);
    const destination = text(body, "destination");
    if (!destination.toLowerCase().endsWith(".zip") || !path.isAbsolute(destination)) {
      throw new LocalError("导出路径须为绝对路径 .zip", 400);
    }
    const zip = await downloadAgentSkill(config.backendUrl, bearer(c), agentId, skillName);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, Buffer.from(zip));
    return json(c, 200, { path: destination });
  });

  app.put("/agents/local/:agentId/published", async (c) => {
    bearer(c);
    const agentId = requireAgentId(c.req.param("agentId"));
    const body = await readJson(c);
    const userId = requirePathUserId(text(body, "user_id"));
    const publishedAgentId = text(body, "published_agent_id");
    try {
      const card = bindLocalPublishedAgent(config.userDataRoot, userId, agentId, publishedAgentId);
      return json(c, 200, serializeLocalCard(card));
    } catch (error) {
      if (error instanceof LocalAgentError) throw new LocalError(error.message, 400);
      throw error;
    }
  });

  app.delete("/agents/local/:agentId", async (c) => {
    bearer(c);
    const agentId = requireAgentId(c.req.param("agentId"));
    const userId = requireUserId(c.req.query("user_id") ?? null);
    try {
      await chats.abort(userId, agentId, "local");
      chats.release(userId, agentId, "local");
      approvals.clearSessionAllow(userId, agentId);
      deleteLocalAgent(config.userDataRoot, userId, agentId);
      forgetAgent(config.userDataRoot, userId, agentId);
      clearAgentChatUi(config.userDataRoot, userId, agentId);
      return json(c, 200, { deleted: true });
    } catch (error) {
      if (error instanceof LocalAgentError) throw new LocalError(error.message, 404);
      throw error;
    }
  });
}

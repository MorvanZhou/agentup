import fs from "node:fs";
import path from "node:path";

import type { Hono } from "hono";

import {
  addProjectRoot,
  ProjectRootsError,
  readProjectRoots,
  removeProjectRoot,
} from "../../session/workspace/project-roots.js";
import { ensureLocalAgent, isLocalAgentId } from "../agents/local-agent.js";
import { ensurePersonalAssistant } from "../assistant/personal-assistant.js";
import {
  bearer,
  json,
  LocalError,
  readJson,
  requireAgentId,
  requireUserId,
  type LocalAppDeps,
  type LocalAppEnv,
} from "../http.js";

export function registerProjectRootsRoutes(app: Hono<LocalAppEnv>, deps: LocalAppDeps): void {
  const { config } = deps;

  app.get("/personal-assistant/project-roots", (c) => {
    bearer(c);
    const userId = requireUserId(c.req.query("user_id") ?? "");
    const visitRoot = ensurePersonalAssistant(config.userDataRoot, userId);
    return json(c, 200, { roots: readProjectRoots(visitRoot, "personal") });
  });

  app.post("/personal-assistant/project-roots", async (c) => {
    bearer(c);
    const body = await readJson(c);
    const userId = requireUserId(typeof body.user_id === "string" ? body.user_id : "");
    const rawPath = typeof body.path === "string" ? body.path : "";
    try {
      const visitRoot = ensurePersonalAssistant(config.userDataRoot, userId);
      const roots = addProjectRoot(config.userDataRoot, visitRoot, "personal", rawPath);
      return json(c, 200, { roots });
    } catch (error) {
      throw mapError(error);
    }
  });

  app.delete("/personal-assistant/project-roots", (c) => {
    bearer(c);
    const userId = requireUserId(c.req.query("user_id") ?? "");
    const rawPath = c.req.query("path") ?? "";
    try {
      const visitRoot = ensurePersonalAssistant(config.userDataRoot, userId);
      const roots = removeProjectRoot(visitRoot, "personal", rawPath);
      return json(c, 200, { roots });
    } catch (error) {
      throw mapError(error);
    }
  });

  app.get("/agents/:agentId/project-roots", (c) => {
    bearer(c);
    const userId = requireUserId(c.req.query("user_id") ?? "");
    const agentId = requireAgentId(c.req.param("agentId"));
    try {
      const visitRoot = resolveAgentVisitRoot(config.userDataRoot, userId, agentId);
      return json(c, 200, { roots: readProjectRoots(visitRoot, "agent") });
    } catch (error) {
      throw mapError(error);
    }
  });

  app.post("/agents/:agentId/project-roots", async (c) => {
    bearer(c);
    const agentId = requireAgentId(c.req.param("agentId"));
    const body = await readJson(c);
    const userId = requireUserId(typeof body.user_id === "string" ? body.user_id : "");
    const rawPath = typeof body.path === "string" ? body.path : "";
    try {
      const visitRoot = resolveAgentVisitRoot(config.userDataRoot, userId, agentId);
      const roots = addProjectRoot(config.userDataRoot, visitRoot, "agent", rawPath);
      return json(c, 200, { roots });
    } catch (error) {
      throw mapError(error);
    }
  });

  app.delete("/agents/:agentId/project-roots", (c) => {
    bearer(c);
    const userId = requireUserId(c.req.query("user_id") ?? "");
    const agentId = requireAgentId(c.req.param("agentId"));
    const rawPath = c.req.query("path") ?? "";
    try {
      const visitRoot = resolveAgentVisitRoot(config.userDataRoot, userId, agentId);
      const roots = removeProjectRoot(visitRoot, "agent", rawPath);
      return json(c, 200, { roots });
    } catch (error) {
      throw mapError(error);
    }
  });
}

function resolveAgentVisitRoot(userDataRoot: string, userId: string, agentId: string): string {
  if (isLocalAgentId(agentId)) {
    return ensureLocalAgent(userDataRoot, userId, agentId);
  }
  const visitRoot = path.resolve(userDataRoot, "users", userId, "agents", agentId);
  const instancePath = path.join(visitRoot, "instance.json");
  if (!fs.existsSync(instancePath)) throw new ProjectRootsError("Agent 未同步到本机", 404);
  return visitRoot;
}

function mapError(error: unknown): Error {
  if (error instanceof ProjectRootsError) {
    return new LocalError(error.message, error.status);
  }
  if (error instanceof LocalError) return error;
  return error instanceof Error ? error : new LocalError("请求无效", 400);
}

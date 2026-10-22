import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { ConfigError } from "../config/load.js";
import { BackendClientError } from "../control/client.js";
import { AgentSourceError } from "../package/source.js";
import { NotRecruited, PackageMismatch } from "../package/sync.js";
import { AttachmentError } from "../session/workspace/attachments.js";
import { SessionRefused } from "../session/plan.js";
import { ChatBusy } from "../session/turn.js";
import {
  json,
  LocalError,
  loopbackOrigin,
  type LocalAppDeps,
  type LocalAppEnv,
} from "./http.js";
import { LocalAgentError } from "./agents/local-agent.js";
import { PersonalAssistantError } from "./assistant/personal-assistant.js";
import { registerLocalRoutes } from "./routes/index.js";
import { UserResourceError } from "./assistant/user-resources.js";
import { WorkspaceError } from "./workspace.js";

export type { LocalAppDeps, LocalAppEnv } from "./http.js";
export { LocalError } from "./http.js";

/** 收敛到 Hono `c.json` 可用的 contentful 状态码。 */
function httpStatus(status: number, fallback: ContentfulStatusCode): ContentfulStatusCode {
  if (!Number.isInteger(status) || status < 200 || status > 599) return fallback;
  if (status === 204 || status === 205 || status === 304) return fallback;
  return status as ContentfulStatusCode;
}

/** 组装本机 Hono 应用：CORS / 错误映射 / 业务路由。 */
export function createLocalApp(deps: LocalAppDeps): Hono<LocalAppEnv> {
  const app = new Hono<LocalAppEnv>();

  app.use("*", async (c, next) => {
    const origin = c.req.header("origin");
    const outgoing = c.env.outgoing;
    if (origin === "null" || (typeof origin === "string" && loopbackOrigin(origin))) {
      outgoing.setHeader("access-control-allow-origin", origin);
      outgoing.setHeader("vary", "origin");
      c.header("access-control-allow-origin", origin);
      c.header("vary", "origin");
    }
    if (c.req.method === "OPTIONS") {
      outgoing.setHeader("access-control-allow-headers", "authorization, content-type");
      outgoing.setHeader("access-control-allow-methods", "GET, POST, PUT, DELETE, OPTIONS");
      c.header("access-control-allow-headers", "authorization, content-type");
      c.header("access-control-allow-methods", "GET, POST, PUT, DELETE, OPTIONS");
      return c.body(null, 204);
    }
    await next();
  });

  app.onError((error, c) => {
    if (error instanceof BackendClientError) {
      const status = httpStatus(error.status, 502);
      return json(c, status, {
        error: error.message,
        ...(error.details.length ? { details: error.details } : {}),
      });
    }
    if (error instanceof NotRecruited) {
      return json(c, 403, { error: "尚未招募" });
    }
    if (error instanceof ChatBusy) {
      return json(c, 409, { error: error.message });
    }
    if (error instanceof ConfigError) {
      return json(c, 503, { error: error.message });
    }
    if (error instanceof AgentSourceError) {
      return json(c, 400, {
        error: error.message,
        ...(error.details.length ? { details: error.details } : {}),
      });
    }
    if (error instanceof UserResourceError) {
      return json(c, 400, {
        error: error.message,
        ...(error.details.length ? { details: error.details } : {}),
      });
    }
    if (error instanceof PersonalAssistantError || error instanceof LocalAgentError) {
      return json(c, 400, { error: error.message });
    }
    if (error instanceof WorkspaceError) {
      return json(c, httpStatus(error.status, 400), { error: error.message });
    }
    if (error instanceof AttachmentError) {
      return json(c, httpStatus(error.status, 400), { error: error.message });
    }
    if (error instanceof SessionRefused || error instanceof PackageMismatch || error instanceof LocalError) {
      const status = error instanceof LocalError ? httpStatus(error.status, 400) : 409;
      return json(c, status, { error: error.message });
    }
    console.error("[runtime]", error);
    const detail = error instanceof Error && error.message.trim() ? error.message.trim() : "本机 runtime 失败";
    return json(c, 500, { error: detail });
  });

  app.notFound((c) => json(c, 404, { error: "没有这个接口" }));

  registerLocalRoutes(app, deps);
  return app;
}

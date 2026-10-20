import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { bearer, json, readJson, type LocalAppDeps, type LocalAppEnv } from "../http.js";
import { isWorkspacePath, serveWorkspace } from "../workspace.js";

export function registerWorkspaceRoutes(app: Hono<LocalAppEnv>, deps: LocalAppDeps): void {
  const { config } = deps;
  const workspaceMethods = ["GET", "POST", "PUT", "DELETE"];
  const handleWorkspace = async (c: Context<LocalAppEnv>) => {
    const pathname = new URL(c.req.url).pathname;
    if (!isWorkspacePath(pathname)) return c.notFound();
    bearer(c);
    const body = c.req.method === "POST" || c.req.method === "PUT" ? await readJson(c) : {};
    const result = serveWorkspace(
      config.userDataRoot,
      c.req.method,
      pathname,
      new URL(c.req.url).searchParams,
      body,
    );
    return json(c, result.status as ContentfulStatusCode, result.payload);
  };
  app.on(workspaceMethods, "/personal-assistant/workspace", handleWorkspace);
  app.on(workspaceMethods, "/personal-assistant/workspace/:action{file|rename|absolute}", handleWorkspace);
  app.on(workspaceMethods, "/agents/:agentId/workspace", handleWorkspace);
  app.on(workspaceMethods, "/agents/:agentId/workspace/:action{file|rename|absolute}", handleWorkspace);
}

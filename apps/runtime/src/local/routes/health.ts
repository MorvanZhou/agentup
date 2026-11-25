import type { Hono } from "hono";

import { json, type LocalAppDeps, type LocalAppEnv } from "../http.js";

/** Desktop 开发态用 backendUrl 确认是本进程 runtime，而非占端口的旧 AgentUp。 */
export function registerHealthRoutes(app: Hono<LocalAppEnv>, deps: LocalAppDeps): void {
  app.get("/health", (c) =>
    json(c, 200, {
      ok: true,
      backendUrl: deps.config.backendUrl.replace(/\/$/, ""),
    }),
  );
}

import type { Hono } from "hono";

import { json, type LocalAppEnv } from "../http.js";

export function registerHealthRoutes(app: Hono<LocalAppEnv>): void {
  app.get("/health", (c) => json(c, 200, { ok: true }));
}

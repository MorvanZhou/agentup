import type { Hono } from "hono";

import { bearer, json, LocalError, readJson, text, type LocalAppDeps, type LocalAppEnv } from "../http.js";
import { serializeState } from "../serialize.js";
import { readState, StateError, writeUiState } from "../state.js";

export function registerStateRoutes(app: Hono<LocalAppEnv>, deps: LocalAppDeps): void {
  const { config } = deps;

  app.get("/state", (c) => {
    bearer(c);
    const userId = c.req.query("user_id") ?? "";
    if (!userId) throw new LocalError("请求无效", 400);
    try {
      return json(c, 200, serializeState(readState(config.userDataRoot, userId)));
    } catch (error) {
      if (error instanceof StateError) throw new LocalError(error.message, 400);
      throw error;
    }
  });

  app.post("/state", async (c) => {
    bearer(c);
    const body = await readJson(c);
    const userId = text(body, "user_id");
    try {
      const unread = body.unread;
      const previews = body.previews;
      const lastActiveAt = body.last_active_at;
      if (!unread || typeof unread !== "object" || Array.isArray(unread)) throw new StateError("本机状态无效");
      if (!previews || typeof previews !== "object" || Array.isArray(previews)) {
        throw new StateError("本机状态无效");
      }
      if (!lastActiveAt || typeof lastActiveAt !== "object" || Array.isArray(lastActiveAt)) {
        throw new StateError("本机状态无效");
      }
      return json(
        c,
        200,
        serializeState(
          writeUiState(
            config.userDataRoot,
            userId,
            unread as Record<string, number>,
            previews as Record<string, string>,
            lastActiveAt as Record<string, number>,
          ),
        ),
      );
    } catch (error) {
      if (error instanceof StateError) throw new LocalError(error.message, 400);
      throw error;
    }
  });
}

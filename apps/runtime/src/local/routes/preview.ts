import type { Hono } from "hono";

import { PERSONAL_ASSISTANT_ID } from "../assistant/personal-assistant.js";
import {
  agentWorkspaceCwd,
  personalWorkspaceCwd,
  WorkspaceError,
} from "../workspace.js";
import {
  bearer,
  json,
  LocalError,
  readJson,
  requireUserId,
  text,
  type LocalAppDeps,
  type LocalAppEnv,
} from "../http.js";
import { groupWorkspaceRoot } from "../../session/group/workspace.js";
import { PreviewError, type PreviewScope } from "../../session/preview/service.js";

export function registerPreviewRoutes(app: Hono<LocalAppEnv>, deps: LocalAppDeps): void {
  const { config, preview } = deps;

  app.get("/agents/:agentId/preview/recipes", (c) => {
    bearer(c);
    const userId = requireUserId(c.req.query("user_id") ?? null);
    const agentId = c.req.param("agentId") ?? "";
    const cwd =
      agentId === PERSONAL_ASSISTANT_ID
        ? personalWorkspaceCwd(config.userDataRoot, userId)
        : agentWorkspaceCwd(config.userDataRoot, userId, agentId);
    return json(c, 200, { recipes: preview.listRecipes(cwd) });
  });

  app.get("/personal-assistant/preview/recipes", (c) => {
    bearer(c);
    const userId = requireUserId(c.req.query("user_id") ?? null);
    const cwd = personalWorkspaceCwd(config.userDataRoot, userId);
    return json(c, 200, { recipes: preview.listRecipes(cwd) });
  });

  app.get("/groups/:groupId/preview/recipes", (c) => {
    bearer(c);
    const userId = requireUserId(c.req.query("user_id") ?? null);
    const groupId = c.req.param("groupId") ?? "";
    const root = groupWorkspaceRoot(config.userDataRoot, userId, groupId);
    return json(c, 200, { recipes: preview.listRecipes(root) });
  });

  app.post("/agents/:agentId/preview/recipes/:recipeId/start", async (c) => {
    bearer(c);
    const body = await readJson(c);
    const userId = requireUserId(text(body, "user_id"));
    const agentId = c.req.param("agentId") ?? "";
    const recipeId = c.req.param("recipeId") ?? "";
    const cwd =
      agentId === PERSONAL_ASSISTANT_ID
        ? personalWorkspaceCwd(config.userDataRoot, userId)
        : agentWorkspaceCwd(config.userDataRoot, userId, agentId);
    const scope: PreviewScope =
      agentId === PERSONAL_ASSISTANT_ID ? { kind: "personal" } : { kind: "agent", agentId };
    try {
      const result = await preview.start({
        userId,
        agentId: agentId === PERSONAL_ASSISTANT_ID ? PERSONAL_ASSISTANT_ID : agentId,
        workspaceRoot: cwd,
        recipeId,
        scope,
        force: body.force === true,
      });
      return json(c, 200, result);
    } catch (error) {
      throw mapPreviewError(error);
    }
  });

  app.post("/personal-assistant/preview/recipes/:recipeId/start", async (c) => {
    bearer(c);
    const body = await readJson(c);
    const userId = requireUserId(text(body, "user_id"));
    const recipeId = c.req.param("recipeId") ?? "";
    const cwd = personalWorkspaceCwd(config.userDataRoot, userId);
    try {
      const result = await preview.start({
        userId,
        agentId: PERSONAL_ASSISTANT_ID,
        workspaceRoot: cwd,
        recipeId,
        scope: { kind: "personal" },
        force: body.force === true,
      });
      return json(c, 200, result);
    } catch (error) {
      throw mapPreviewError(error);
    }
  });

  app.post("/groups/:groupId/preview/recipes/:recipeId/start", async (c) => {
    bearer(c);
    const body = await readJson(c);
    const userId = requireUserId(text(body, "user_id"));
    const groupId = c.req.param("groupId") ?? "";
    const recipeId = c.req.param("recipeId") ?? "";
    const agentId = resolveGroupPreviewAgentId(deps, userId, groupId, body);
    if (!agentId) throw new LocalError("请求无效", 400);
    const root = groupWorkspaceRoot(config.userDataRoot, userId, groupId);
    try {
      const result = await preview.start({
        userId,
        agentId,
        workspaceRoot: root,
        recipeId,
        scope: { kind: "group", groupId },
        groupId,
        force: body.force === true,
      });
      return json(c, 200, result);
    } catch (error) {
      throw mapPreviewError(error);
    }
  });

  app.post("/agents/:agentId/preview/recipes/:recipeId/stop", async (c) => {
    bearer(c);
    const body = await readJson(c);
    const userId = requireUserId(text(body, "user_id"));
    const agentId = c.req.param("agentId") ?? "";
    const recipeId = c.req.param("recipeId") ?? "";
    const cwd =
      agentId === PERSONAL_ASSISTANT_ID
        ? personalWorkspaceCwd(config.userDataRoot, userId)
        : agentWorkspaceCwd(config.userDataRoot, userId, agentId);
    const scope: PreviewScope =
      agentId === PERSONAL_ASSISTANT_ID ? { kind: "personal" } : { kind: "agent", agentId };
    try {
      // 人侧关预览：静默，不旁路 wake Agent
      const recipe = preview.stop({ userId, workspaceRoot: cwd, recipeId, scope });
      return json(c, 200, { recipe });
    } catch (error) {
      throw mapPreviewError(error);
    }
  });

  app.post("/personal-assistant/preview/recipes/:recipeId/stop", async (c) => {
    bearer(c);
    const body = await readJson(c);
    const userId = requireUserId(text(body, "user_id"));
    const recipeId = c.req.param("recipeId") ?? "";
    const cwd = personalWorkspaceCwd(config.userDataRoot, userId);
    try {
      const recipe = preview.stop({
        userId,
        workspaceRoot: cwd,
        recipeId,
        scope: { kind: "personal" },
      });
      return json(c, 200, { recipe });
    } catch (error) {
      throw mapPreviewError(error);
    }
  });

  app.post("/groups/:groupId/preview/recipes/:recipeId/stop", async (c) => {
    bearer(c);
    const body = await readJson(c);
    const userId = requireUserId(text(body, "user_id"));
    const groupId = c.req.param("groupId") ?? "";
    const recipeId = c.req.param("recipeId") ?? "";
    const root = groupWorkspaceRoot(config.userDataRoot, userId, groupId);
    try {
      const recipe = preview.stop({
        userId,
        workspaceRoot: root,
        recipeId,
        scope: { kind: "group", groupId },
      });
      return json(c, 200, { recipe });
    } catch (error) {
      throw mapPreviewError(error);
    }
  });

  // —— 顶栏常驻 pin / 叉掉 dismiss（删 workspace.json 配方）——

  app.post("/agents/:agentId/preview/recipes/:recipeId/header-pin", async (c) => {
    bearer(c);
    const body = await readJson(c);
    const userId = requireUserId(text(body, "user_id"));
    const agentId = c.req.param("agentId") ?? "";
    const recipeId = c.req.param("recipeId") ?? "";
    const pinned = body.pinned === true;
    const cwd =
      agentId === PERSONAL_ASSISTANT_ID
        ? personalWorkspaceCwd(config.userDataRoot, userId)
        : agentWorkspaceCwd(config.userDataRoot, userId, agentId);
    try {
      const recipe = preview.setHeaderPinned({ workspaceRoot: cwd, recipeId, pinned });
      return json(c, 200, { recipe });
    } catch (error) {
      throw mapPreviewError(error);
    }
  });

  app.post("/personal-assistant/preview/recipes/:recipeId/header-pin", async (c) => {
    bearer(c);
    const body = await readJson(c);
    const userId = requireUserId(text(body, "user_id"));
    const recipeId = c.req.param("recipeId") ?? "";
    const pinned = body.pinned === true;
    const cwd = personalWorkspaceCwd(config.userDataRoot, userId);
    try {
      const recipe = preview.setHeaderPinned({ workspaceRoot: cwd, recipeId, pinned });
      return json(c, 200, { recipe });
    } catch (error) {
      throw mapPreviewError(error);
    }
  });

  app.post("/groups/:groupId/preview/recipes/:recipeId/header-pin", async (c) => {
    bearer(c);
    const body = await readJson(c);
    const userId = requireUserId(text(body, "user_id"));
    const groupId = c.req.param("groupId") ?? "";
    const recipeId = c.req.param("recipeId") ?? "";
    const pinned = body.pinned === true;
    const root = groupWorkspaceRoot(config.userDataRoot, userId, groupId);
    try {
      const recipe = preview.setHeaderPinned({ workspaceRoot: root, recipeId, pinned });
      return json(c, 200, { recipe });
    } catch (error) {
      throw mapPreviewError(error);
    }
  });

  app.post("/agents/:agentId/preview/recipes/:recipeId/dismiss", async (c) => {
    bearer(c);
    const body = await readJson(c);
    const userId = requireUserId(text(body, "user_id"));
    const agentId = c.req.param("agentId") ?? "";
    const recipeId = c.req.param("recipeId") ?? "";
    const cwd =
      agentId === PERSONAL_ASSISTANT_ID
        ? personalWorkspaceCwd(config.userDataRoot, userId)
        : agentWorkspaceCwd(config.userDataRoot, userId, agentId);
    const scope: PreviewScope =
      agentId === PERSONAL_ASSISTANT_ID ? { kind: "personal" } : { kind: "agent", agentId };
    try {
      const recipe = preview.dismiss({ userId, workspaceRoot: cwd, recipeId, scope });
      return json(c, 200, { recipe });
    } catch (error) {
      throw mapPreviewError(error);
    }
  });

  app.post("/personal-assistant/preview/recipes/:recipeId/dismiss", async (c) => {
    bearer(c);
    const body = await readJson(c);
    const userId = requireUserId(text(body, "user_id"));
    const recipeId = c.req.param("recipeId") ?? "";
    const cwd = personalWorkspaceCwd(config.userDataRoot, userId);
    try {
      const recipe = preview.dismiss({
        userId,
        workspaceRoot: cwd,
        recipeId,
        scope: { kind: "personal" },
      });
      return json(c, 200, { recipe });
    } catch (error) {
      throw mapPreviewError(error);
    }
  });

  app.post("/groups/:groupId/preview/recipes/:recipeId/dismiss", async (c) => {
    bearer(c);
    const body = await readJson(c);
    const userId = requireUserId(text(body, "user_id"));
    const groupId = c.req.param("groupId") ?? "";
    const recipeId = c.req.param("recipeId") ?? "";
    const root = groupWorkspaceRoot(config.userDataRoot, userId, groupId);
    try {
      const recipe = preview.dismiss({
        userId,
        workspaceRoot: root,
        recipeId,
        scope: { kind: "group", groupId },
      });
      return json(c, 200, { recipe });
    } catch (error) {
      throw mapPreviewError(error);
    }
  });
}

/** 群预览 job 记在哪个成员名下：body.agent_id → 当前执掌 → 默认执掌 → 名单首位。 */
function resolveGroupPreviewAgentId(
  deps: LocalAppDeps,
  userId: string,
  groupId: string,
  body: unknown,
): string {
  const raw =
    body && typeof body === "object" ? (body as { agent_id?: unknown }).agent_id : undefined;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  try {
    const room = deps.groups.get(userId, groupId);
    if (typeof room.holderId === "string" && room.holderId.trim()) return room.holderId.trim();
    if (typeof room.defaultHolderId === "string" && room.defaultHolderId.trim()) {
      return room.defaultHolderId.trim();
    }
    const first = room.members?.[0]?.agentId;
    return typeof first === "string" ? first.trim() : "";
  } catch {
    return "";
  }
}

function mapPreviewError(error: unknown): LocalError | WorkspaceError {
  if (error instanceof PreviewError) return new LocalError(error.message, error.status);
  if (error instanceof WorkspaceError) return error;
  if (error instanceof LocalError) return error;
  const message = error instanceof Error && error.message ? error.message : "预览操作失败";
  return new LocalError(message, 400);
}

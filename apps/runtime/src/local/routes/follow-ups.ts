import type { Hono } from "hono";

import { PERSONAL_ASSISTANT_ID } from "../assistant/personal-assistant.js";
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
import { serializeFollowUp } from "../prompt.js";
import { FollowUpQueueFull } from "../../session/turn/follow-up-queue.js";

/**
 * followUp 队列：本地 Agent App（SDK）接入下，回合进行中用户新发消息的落点。
 * 桌面用它渲染「已排队 N 条」并支持删除 / 编辑 / 插队（.cursor/skills/agentup-sdk-adapter/references/follow-up.md）。
 * agent_id 省略或为私人助理 id 时，操作私人助理的队列。
 */
export function registerFollowUpRoutes(app: Hono<LocalAppEnv>, deps: LocalAppDeps): void {
  const { chats } = deps;

  const refOf = (userId: string, agentId: string | undefined) => ({
    userId,
    agentId: agentId && agentId.trim() && agentId !== PERSONAL_ASSISTANT_ID ? agentId : PERSONAL_ASSISTANT_ID,
    kind: agentId && agentId.trim() && agentId !== PERSONAL_ASSISTANT_ID ? ("recruited" as const) : ("personal" as const),
  });

  app.get("/follow-ups", (c) => {
    bearer(c);
    const userId = requireUserId(c.req.query("user_id") ?? "");
    const rawAgent = c.req.query("agent_id") ?? "";
    const agentId = rawAgent ? requireAgentId(rawAgent) : undefined;
    const ref = refOf(userId, agentId);
    const queue = chats.listFollowUps(ref);
    return json(c, 200, { queue: queue.map(serializeFollowUp) });
  });

  app.post("/follow-ups", async (c) => {
    bearer(c);
    const body = await readJson(c);
    const userId = requireUserId(typeof body.user_id === "string" ? body.user_id : "");
    const agentId =
      typeof body.agent_id === "string" && body.agent_id.trim() ? requireAgentId(body.agent_id) : undefined;
    const text = typeof body.text === "string" ? body.text : "";
    if (!text.trim()) throw new LocalError("消息为空", 400);
    const ref = refOf(userId, agentId);
    try {
      const queued = chats.enqueueFollowUp(ref, text);
      return json(c, 202, { queued: serializeFollowUp(queued), queue: chats.listFollowUps(ref).map(serializeFollowUp) });
    } catch (error) {
      throw mapError(error);
    }
  });

  app.patch("/follow-ups/:id", async (c) => {
    bearer(c);
    const body = await readJson(c);
    const userId = requireUserId(typeof body.user_id === "string" ? body.user_id : "");
    const agentId =
      typeof body.agent_id === "string" && body.agent_id.trim() ? requireAgentId(body.agent_id) : undefined;
    const text = typeof body.text === "string" ? body.text : "";
    const ref = refOf(userId, agentId);
    try {
      const updated = chats.updateFollowUp(ref, c.req.param("id"), text);
      if (!updated) throw new LocalError("队列中没有这条", 404);
      return json(c, 200, { queued: serializeFollowUp(updated), queue: chats.listFollowUps(ref).map(serializeFollowUp) });
    } catch (error) {
      throw mapError(error);
    }
  });

  app.post("/follow-ups/:id/promote", (c) => {
    bearer(c);
    const userId = requireUserId(c.req.query("user_id") ?? "");
    const rawAgent = c.req.query("agent_id") ?? "";
    const agentId = rawAgent ? requireAgentId(rawAgent) : undefined;
    const ref = refOf(userId, agentId);
    if (!chats.promoteFollowUp(ref, c.req.param("id"))) throw new LocalError("队列中没有这条", 404);
    return json(c, 200, { queue: chats.listFollowUps(ref).map(serializeFollowUp) });
  });

  app.delete("/follow-ups/:id", (c) => {
    bearer(c);
    const userId = requireUserId(c.req.query("user_id") ?? "");
    const rawAgent = c.req.query("agent_id") ?? "";
    const agentId = rawAgent ? requireAgentId(rawAgent) : undefined;
    const ref = refOf(userId, agentId);
    if (!chats.removeFollowUp(ref, c.req.param("id"))) throw new LocalError("队列中没有这条", 404);
    return json(c, 200, { queue: chats.listFollowUps(ref).map(serializeFollowUp) });
  });

  app.delete("/follow-ups", (c) => {
    bearer(c);
    const userId = requireUserId(c.req.query("user_id") ?? "");
    const rawAgent = c.req.query("agent_id") ?? "";
    const agentId = rawAgent ? requireAgentId(rawAgent) : undefined;
    const ref = refOf(userId, agentId);
    return json(c, 200, { cleared: chats.clearFollowUps(ref) });
  });

  app.post("/follow-ups/resume", async (c) => {
    bearer(c);
    const body = await readJson(c);
    const userId = requireUserId(typeof body.user_id === "string" ? body.user_id : "");
    const agentId =
      typeof body.agent_id === "string" && body.agent_id.trim()
        ? requireAgentId(body.agent_id)
        : undefined;
    const resumed = chats.resumeFollowUps(refOf(userId, agentId));
    if (!resumed) throw new LocalError("队列无法继续", 409);
    return json(c, 202, { resumed: true });
  });
}

function mapError(error: unknown): LocalError {
  if (error instanceof FollowUpQueueFull) return new LocalError("队列已满", 409);
  if (error instanceof LocalError) return error;
  const message = error instanceof Error && error.message ? error.message : "排队失败";
  return new LocalError(message, 409);
}

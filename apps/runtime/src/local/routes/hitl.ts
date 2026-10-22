import type { Hono } from "hono";

import { surfaceHitlAgentId } from "../../session/hitl/surface.js";
import { parseAskUserAnswer } from "../../session/tools/index.js";
import { bearer, json, LocalError, readJson, type LocalAppDeps, type LocalAppEnv } from "../http.js";

export function registerHitlRoutes(app: Hono<LocalAppEnv>, deps: LocalAppDeps): void {
  const { approvals, askUser, chats, delegation } = deps;

  /** 侧栏 / Dock：busy + 仍可闭合的 HITL（含重启后孤儿）。 */
  app.get("/attention", (c) => {
    bearer(c);
    const userId = c.req.query("user_id") ?? "";
    if (!userId) throw new LocalError("请求无效", 400);
    approvals.restoreUser(userId);
    askUser.restoreUser(userId);
    const busyAgentIds = chats.busyAgentIds(userId);
    const surfaceAgent = (item: { agentId: string; origin?: "visit" | "delegation" }) =>
      surfaceHitlAgentId(item.agentId, {
        nestingParentId: delegation.findNestingParent(userId, item.agentId),
        busyAgentIds,
        origin: item.origin,
      });
    return json(c, 200, {
      busy_agent_ids: busyAgentIds,
      approvals: approvals.listPending(userId).map((item) => ({
        id: item.id,
        agent_id: surfaceAgent(item),
        tool_call_id: item.toolCallId,
        tool_name: item.toolName,
        args: item.args,
      })),
      ask_users: askUser.listPending(userId).map((item) => ({
        id: item.id,
        agent_id: surfaceAgent(item),
        tool_call_id: item.toolCallId,
        questions: item.questions,
      })),
    });
  });

  app.post("/approvals/:id", async (c) => {
    bearer(c);
    const body = await readJson(c);
    if (typeof body.allow !== "boolean") throw new LocalError("请求无效", 400);
    const scope = body.scope === undefined ? "once" : body.scope;
    if (scope !== "once" && scope !== "session" && scope !== "agent") {
      throw new LocalError("请求无效", 400);
    }
    if (!body.allow && scope !== "once") throw new LocalError("请求无效", 400);
    if (!approvals.decide(c.req.param("id"), body.allow, scope)) {
      throw new LocalError("审批请求已失效", 404);
    }
    return json(c, 200, { decided: true });
  });

  app.post("/ask-user/:id", async (c) => {
    bearer(c);
    const body = await readJson(c);
    const answer = parseAskUserAnswer(body);
    if (!answer) throw new LocalError("请求无效", 400);
    if (!askUser.answer(c.req.param("id"), answer)) {
      throw new LocalError("提问请求已失效", 404);
    }
    return json(c, 200, { answered: true });
  });
}

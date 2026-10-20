import type { Hono } from "hono";

import { parseAskUserAnswer } from "../../session/tools/index.js";
import { bearer, json, LocalError, readJson, type LocalAppDeps, type LocalAppEnv } from "../http.js";

export function registerHitlRoutes(app: Hono<LocalAppEnv>, deps: LocalAppDeps): void {
  const { approvals, askUser } = deps;

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

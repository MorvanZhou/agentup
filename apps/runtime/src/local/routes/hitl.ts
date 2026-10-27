import type { Context } from "hono";
import type { Hono } from "hono";
import { stream } from "hono/streaming";
import { createUIMessageStream, pipeUIMessageStreamToResponse, type UIMessageChunk } from "ai";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";

import { delegationHitlAttribution, surfaceHitlAgentId } from "../../session/hitl/surface.js";
import { parseAskUserAnswer } from "../../session/tools/index.js";
import {
  bearer,
  json,
  LocalError,
  readJson,
  requireUserId,
  sendNodeJson,
  type LocalAppDeps,
  type LocalAppEnv,
} from "../http.js";

/** 简易 SSE：send(event, data)；返回清理函数。 */
function streamSse(
  c: Context<LocalAppEnv>,
  setup: (
    send: (event: string, data: Record<string, unknown>) => void,
    closed: () => boolean,
  ) => () => void,
) {
  return stream(c, async (out) => {
    let closed = false;
    const send = (event: string, data: Record<string, unknown>) => {
      if (closed) return;
      void out.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    c.header("Content-Type", "text/event-stream; charset=utf-8");
    c.header("Cache-Control", "no-cache, no-transform");
    c.header("Connection", "keep-alive");
    const cleanup = setup(send, () => closed);
    try {
      // 保持连接；客户端断开时 hono stream 结束。
      await new Promise<void>((resolve) => {
        const timer = setInterval(() => {
          if (closed) {
            clearInterval(timer);
            resolve();
            return;
          }
          void out.write(`: ping\n\n`);
        }, 15000);
        out.onAbort(() => {
          closed = true;
          clearInterval(timer);
          resolve();
        });
      });
    } finally {
      closed = true;
      cleanup();
    }
  });
}

export function registerHitlRoutes(app: Hono<LocalAppEnv>, deps: LocalAppDeps): void {
  const { approvals, askUser, shellHang, chats, delegation } = deps;

  /** 侧栏 / Dock：busy + 仍可闭合的 HITL（含重启后孤儿）。 */
  app.get("/attention", (c) => {
    bearer(c);
    const userId = c.req.query("user_id") ?? "";
    if (!userId) throw new LocalError("请求无效", 400);
    approvals.restoreUser(userId);
    askUser.restoreUser(userId);
    const busyTurns = chats.busyTurns(userId);
    const busyAgentIds = busyTurns.map((item) => item.agentId);
    const nestingParent = (item: {
      agentId: string;
      origin?: "visit" | "delegation";
      parentAgentId?: string;
    }) =>
      item.parentAgentId?.trim() ||
      (item.origin === "delegation"
        ? delegation.findNestingParent(userId, item.agentId)
        : undefined);
    const surfaceAgent = (item: {
      agentId: string;
      origin?: "visit" | "delegation";
      parentAgentId?: string;
    }) =>
      surfaceHitlAgentId(item.agentId, {
        nestingParentId: nestingParent(item),
        busyAgentIds,
        origin: item.origin,
      });
    const hitlAttribution = (item: { origin?: "visit" | "delegation"; taskId?: string }) => {
      if (item.origin !== "delegation" || !item.taskId) return {};
      const task =
        "getTask" in delegation && typeof delegation.getTask === "function"
          ? delegation.getTask(item.taskId)
          : undefined;
      return delegationHitlAttribution(task);
    };
    return json(c, 200, {
      busy_agent_ids: busyAgentIds,
      busy_turns: busyTurns.map((item) => ({
        agent_id: item.agentId,
        phase: item.phase,
        sources: item.sources.map((source) => ({
          name: source.name,
          status: source.status,
          agent_id: source.agentId,
          kind: source.kind,
        })),
      })),
      // 委托 HITL 的 agent_id 是跟进方；asked_by_name / task_label 标明是谁的哪件任务。
      approvals: approvals.listPending(userId).map((item) => {
        const label = hitlAttribution(item);
        return {
          id: item.id,
          agent_id: surfaceAgent(item),
          origin_agent_id: item.agentId,
          parent_agent_id: nestingParent(item) ?? null,
          tool_call_id: item.toolCallId,
          tool_name: item.toolName,
          args: item.args,
          ...(label.askedByName ? { asked_by_name: label.askedByName } : {}),
          ...(label.taskLabel ? { task_label: label.taskLabel } : {}),
        };
      }),
      ask_users: askUser.listPending(userId).map((item) => {
        const label = hitlAttribution(item);
        return {
          id: item.id,
          agent_id: surfaceAgent(item),
          origin_agent_id: item.agentId,
          parent_agent_id: nestingParent(item) ?? null,
          tool_call_id: item.toolCallId,
          questions: item.questions,
          ...(label.askedByName ? { asked_by_name: label.askedByName } : {}),
          ...(label.taskLabel ? { task_label: label.taskLabel } : {}),
        };
      }),
      shell_hangs: shellHang.listPending(userId).map((item) => {
        const label = hitlAttribution(item);
        return {
          id: item.id,
          agent_id: surfaceAgent(item),
          origin_agent_id: item.agentId,
          parent_agent_id: nestingParent(item) ?? null,
          tool_call_id: item.toolCallId,
          tool_name: item.toolName,
          command: item.command,
          elapsed_ms: item.elapsedMs,
          ...(label.askedByName ? { asked_by_name: label.askedByName } : {}),
          ...(label.taskLabel ? { task_label: label.taskLabel } : {}),
        };
      }),
    });
  });

  /**
   * 编排回合进度 SSE：dirty / done → 编排条状态（不再靠它整段 remount 历史）。
   */
  app.get("/turn-progress", (c) => {
    bearer(c);
    const userId = c.req.query("user_id") ?? "";
    if (!userId) throw new LocalError("请求无效", 400);
    const agentFilter = c.req.query("agent_id")?.trim() || "";
    return streamSse(c, (send, closed) => {
      const unsubscribe = chats.subscribeTurnProgress(userId, (event) => {
        if (closed()) return;
        if (agentFilter && event.agentId !== agentFilter) return;
        if (event.type === "dirty") {
          send("dirty", {
            agent_id: event.agentId,
            phase: event.phase,
          });
          return;
        }
        send("done", { agent_id: event.agentId });
      });
      // 快照：已在 busy 则立刻打一枪 dirty，避免错过开场。
      for (const turn of chats.busyTurns(userId)) {
        if (agentFilter && turn.agentId !== agentFilter) continue;
        send("dirty", { agent_id: turn.agentId, phase: turn.phase });
      }
      return () => {
        unsubscribe();
      };
    });
  });

  /**
   * wake 等旁路 turn 的 UIMessage SSE（与 /prompt 同形）。
   * 桌面订阅后边写边出；晚订阅回放缓冲。
   */
  app.get("/turn-stream", async (c) => {
    bearer(c);
    const userId = requireUserId(c.req.query("user_id") ?? null);
    const agentId = c.req.query("agent_id")?.trim() ?? "";
    if (!agentId) throw new LocalError("请求无效", 400);
    const req = c.env.incoming;
    const res = c.env.outgoing;
    const cancel = new AbortController();
    const onClientGone = () => {
      if (res.writableFinished) return;
      cancel.abort();
    };
    req.socket?.once("close", onClientGone);
    res.once("close", onClientGone);
    try {
      // 刚进入 wake 时槽位可能尚未 begin：短等。
      const deadline = Date.now() + 3_000;
      while (
        !chats.hasTurnStream(userId, agentId) &&
        Date.now() < deadline &&
        !cancel.signal.aborted
      ) {
        const wakeBusy = chats
          .busyTurns(userId)
          .some((item) => item.agentId === agentId && item.phase === "wake");
        if (!wakeBusy) break;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      const stream = createUIMessageStream({
        execute: async ({ writer }) => {
          if (!chats.hasTurnStream(userId, agentId)) return;
          await new Promise<void>((resolve, reject) => {
            const { unsubscribe, closed } = chats.subscribeTurnStream(
              userId,
              agentId,
              (chunk: UIMessageChunk) => {
                try {
                  writer.write(chunk);
                } catch (error) {
                  unsubscribe();
                  reject(error);
                }
              },
            );
            if (closed) {
              resolve();
              return;
            }
            const onAbort = () => {
              unsubscribe();
              reject(cancel.signal.reason ?? new Error("aborted"));
            };
            if (cancel.signal.aborted) {
              onAbort();
              return;
            }
            cancel.signal.addEventListener("abort", onAbort, { once: true });
            const timer = setInterval(() => {
              if (!chats.isTurnStreamOpen(userId, agentId)) {
                clearInterval(timer);
                cancel.signal.removeEventListener("abort", onAbort);
                unsubscribe();
                resolve();
              }
            }, 50);
          });
        },
      });
      await pipeUIMessageStreamToResponse({ response: res, stream });
    } catch (error) {
      if (res.headersSent) {
        res.end();
        return RESPONSE_ALREADY_SENT;
      }
      const message = error instanceof Error && error.message ? error.message : "回合流失败";
      sendNodeJson(res, 500, { error: message });
    } finally {
      req.socket?.off("close", onClientGone);
      res.off("close", onClientGone);
    }
    return RESPONSE_ALREADY_SENT;
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

  /** 阻塞 shell 空闲挂起：kill=杀进程；wait=再等；bg=留下继续跑。 */
  app.post("/shell-hangs/:id", async (c) => {
    bearer(c);
    const body = await readJson(c);
    const action = body.action;
    if (action !== "kill" && action !== "wait" && action !== "bg") {
      throw new LocalError("请求无效", 400);
    }
    if (!shellHang.decide(c.req.param("id"), action)) {
      throw new LocalError("超时询问已失效", 404);
    }
    return json(c, 200, { decided: true });
  });
}

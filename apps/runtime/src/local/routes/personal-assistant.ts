import { createUIMessageStream, pipeUIMessageStreamToResponse, type UIMessageChunk } from "ai";
import type { Hono } from "hono";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";

import path from "node:path";

import { ConfigError } from "../../config/load.js";
import { requireEnabledModelRef } from "../../config/provider.js";
import { parsePromptAttachments, removeStagedAttachment, stageAttachment } from "../../session/attachments.js";
import { clearPersonalContext, clearPersonalHistory, readPersonalHistory } from "../../session/history.js";
import { setVisitSessionModel } from "../../session/session-model.js";
import { listVisitSkills } from "../../session/skills.js";
import {
  bearer,
  json,
  LocalError,
  readJson,
  requireUserId,
  sendNodeJson,
  text,
  uiLocaleFromRequest,
  type LocalAppDeps,
  type LocalAppEnv,
} from "../http.js";
import { t } from "../../i18n/index.js";
import {
  PERSONAL_ASSISTANT_ID,
  personalAssistantVisit,
  readPersonalAssistantProfile,
  writePersonalAssistantProfile,
} from "../personal-assistant.js";
import { promptRewind, promptText, streamPrompt } from "../prompt.js";
import { sessionModelBody } from "../serialize.js";
import { clearAgentChatUi } from "../state.js";
import { personalWorkspaceCwd } from "../workspace.js";

export function registerPersonalAssistantRoutes(app: Hono<LocalAppEnv>, deps: LocalAppDeps): void {
  const { config, chats, approvals, delegation, readModel } = deps;

  app.get("/personal-assistant/profile", (c) => {
    bearer(c);
    const userId = requireUserId(c.req.query("user_id") ?? null);
    const locale = uiLocaleFromRequest(c);
    const profile = readPersonalAssistantProfile(config.userDataRoot, userId, locale);
    return json(c, 200, {
      name: profile.name,
      instructions: profile.instructions,
      avatar_url: profile.avatarUrl ?? null,
    });
  });

  app.put("/personal-assistant/profile", async (c) => {
    bearer(c);
    const body = await readJson(c);
    const userId = requireUserId(text(body, "user_id"));
    const locale = uiLocaleFromRequest(c);
    if (body.avatar_data_url === null) {
      throw new LocalError(t("pa.err.avatarRemoveUnsupported", locale), 400);
    }
    const avatarDataUrl = typeof body.avatar_data_url === "string" ? body.avatar_data_url : undefined;
    const profile = writePersonalAssistantProfile(
      config.userDataRoot,
      userId,
      {
        name: text(body, "name"),
        instructions: text(body, "instructions"),
        ...(avatarDataUrl !== undefined ? { avatarDataUrl } : {}),
      },
      locale,
    );
    chats.invalidatePersonalAssistant(userId);
    return json(c, 200, {
      name: profile.name,
      instructions: profile.instructions,
      avatar_url: profile.avatarUrl ?? null,
    });
  });

  app.get("/personal-assistant/skills", (c) => {
    bearer(c);
    const userId = requireUserId(c.req.query("user_id") ?? null);
    const visit = personalAssistantVisit(config.userDataRoot, userId);
    return json(c, 200, { skills: listVisitSkills(visit, config.userDataRoot) });
  });

  app.get("/personal-assistant/history", async (c) => {
    bearer(c);
    const userId = requireUserId(c.req.query("user_id") ?? null);
    return json(c, 200, { messages: await readPersonalHistory(config.userDataRoot, userId) });
  });

  app.get("/personal-assistant/session/model", (c) => {
    bearer(c);
    const userId = requireUserId(c.req.query("user_id") ?? null);
    const locale = uiLocaleFromRequest(c);
    const visit = personalAssistantVisit(config.userDataRoot, userId);
    try {
      return json(
        c,
        200,
        sessionModelBody(
          config.userDataRoot,
          path.join(visit.root, "cwd"),
          path.join(visit.root, "sessions"),
          locale,
        ),
      );
    } catch (error) {
      if (error instanceof ConfigError) throw new LocalError(error.message, 400);
      throw error;
    }
  });

  app.put("/personal-assistant/session/model", async (c) => {
    bearer(c);
    const body = await readJson(c);
    const userId = requireUserId(text(body, "user_id"));
    const locale = uiLocaleFromRequest(c);
    try {
      const ref = requireEnabledModelRef(config.userDataRoot, {
        templateId: text(body, "template_id"),
        modelId: text(body, "model_id"),
      });
      const visit = personalAssistantVisit(config.userDataRoot, userId);
      const cwd = path.join(visit.root, "cwd");
      const sessionDir = path.join(visit.root, "sessions");
      setVisitSessionModel(config.userDataRoot, cwd, sessionDir, ref);
      chats.invalidatePersonalAssistant(userId);
      return json(c, 200, sessionModelBody(config.userDataRoot, cwd, sessionDir, locale));
    } catch (error) {
      if (error instanceof ConfigError) throw new LocalError(error.message, 400);
      throw error;
    }
  });

  app.delete("/personal-assistant/history", async (c) => {
    bearer(c);
    const userId = requireUserId(c.req.query("user_id") ?? null);
    await chats.abort(userId, PERSONAL_ASSISTANT_ID, "personal");
    clearPersonalHistory(config.userDataRoot, userId);
    chats.release(userId, PERSONAL_ASSISTANT_ID, "personal");
    approvals.clearSessionAllow(userId, PERSONAL_ASSISTANT_ID);
    clearAgentChatUi(config.userDataRoot, userId, PERSONAL_ASSISTANT_ID);
    return json(c, 200, { cleared: true });
  });

  app.post("/personal-assistant/context", async (c) => {
    bearer(c);
    const body = await readJson(c);
    const userId = requireUserId(text(body, "user_id"));
    await chats.abort(userId, PERSONAL_ASSISTANT_ID, "personal");
    clearPersonalContext(config.userDataRoot, userId);
    chats.release(userId, PERSONAL_ASSISTANT_ID, "personal");
    approvals.clearSessionAllow(userId, PERSONAL_ASSISTANT_ID);
    return json(c, 200, { cleared: true });
  });

  app.post("/personal-assistant/attachments", async (c) => {
    bearer(c);
    const body = await readJson(c);
    const userId = requireUserId(text(body, "user_id"));
    const [attachment] = parsePromptAttachments({ attachments: [body] });
    if (!attachment) throw new LocalError("请求无效", 400);
    const staged = stageAttachment(personalWorkspaceCwd(config.userDataRoot, userId), attachment);
    return json(c, 200, {
      id: staged.id,
      path: staged.path,
      ref: staged.ref,
      name: staged.name,
      media_type: staged.mediaType,
    });
  });

  app.delete("/personal-assistant/attachments", (c) => {
    bearer(c);
    const userId = requireUserId(c.req.query("user_id") ?? null);
    const filePath = c.req.query("path") ?? "";
    removeStagedAttachment(personalWorkspaceCwd(config.userDataRoot, userId), filePath);
    return json(c, 200, { deleted: true });
  });

  app.post("/personal-assistant/prompt", async (c) => {
    const token = bearer(c);
    const body = await readJson(c);
    const userId = requireUserId(text(body, "user_id"));
    delegation.bindAuth(userId, token);
    try {
      await streamPrompt(
        chats,
        readModel,
        personalAssistantVisit(config.userDataRoot, userId),
        promptText(body),
        c.env.incoming,
        c.env.outgoing,
        promptRewind(body),
        parsePromptAttachments(body),
        config.userDataRoot,
      );
    } finally {
      delegation.unbindAuth(userId);
    }
    return RESPONSE_ALREADY_SENT;
  });

  app.get("/personal-assistant/delegations", (c) => {
    bearer(c);
    const userId = requireUserId(c.req.query("user_id") ?? null);
    const unseenOnly = c.req.query("unseen") === "1" || c.req.query("unseen") === "true";
    const statusParam = c.req.query("status");
    const status =
      statusParam === "pending_auth" ||
      statusParam === "running" ||
      statusParam === "completed" ||
      statusParam === "failed" ||
      statusParam === "cancelled"
        ? statusParam
        : undefined;
    const tasks = delegation.listTasks(userId, { unseenOnly, status });
    for (const task of tasks) {
      if (!task.wait && !task.notified && (task.status === "completed" || task.status === "failed")) {
        delegation.notifyParent(task);
      }
    }
    return json(c, 200, {
      tasks: tasks.map((task) => ({
        id: task.id,
        from_agent_id: task.fromAgentId,
        to_agent_id: task.toAgentId,
        to_agent_name: task.toAgentName,
        brief: task.brief,
        status: task.status,
        wait: task.wait,
        result_summary: task.resultSummary ?? null,
        error: task.error ?? null,
        seen: task.seen,
        notified: task.notified,
        created_at: task.createdAt,
        updated_at: task.updatedAt,
      })),
    });
  });

  app.post("/personal-assistant/delegations/:taskId/ack", async (c) => {
    bearer(c);
    const taskId = c.req.param("taskId");
    const body = await readJson(c);
    const userId = requireUserId(text(body, "user_id"));
    const task = delegation.getTask(taskId);
    if (!task || task.userId !== userId) throw new LocalError("委托任务不存在", 404);
    if (!task.notified && (task.status === "completed" || task.status === "failed")) {
      delegation.notifyParent(task);
    }
    const updated = delegation.acknowledge(taskId);
    return json(c, 200, {
      id: updated?.id,
      seen: updated?.seen === true,
      notified: updated?.notified === true,
    });
  });

  app.get("/personal-assistant/delegations/:taskId/history", async (c) => {
    bearer(c);
    const taskId = c.req.param("taskId");
    const userId = requireUserId(c.req.query("user_id") ?? null);
    const task = delegation.getTask(taskId);
    if (!task || task.userId !== userId) throw new LocalError("委托任务不存在", 404);
    const messages = await delegation.readTaskHistory(taskId, userId);
    return json(c, 200, {
      task: {
        id: task.id,
        status: task.status,
        to_agent_id: task.toAgentId,
        to_agent_name: task.toAgentName,
        brief: task.brief,
        result_summary: task.resultSummary ?? null,
        error: task.error ?? null,
      },
      messages,
    });
  });

  app.get("/personal-assistant/delegations/:taskId/stream", async (c) => {
    bearer(c);
    const taskId = c.req.param("taskId");
    const userId = requireUserId(c.req.query("user_id") ?? null);
    const task = delegation.getTask(taskId);
    if (!task || task.userId !== userId) throw new LocalError("委托任务不存在", 404);
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
      const stream = createUIMessageStream({
        execute: async ({ writer }) => {
          const hub = delegation.progress;
          if (
            (task.status === "completed" || task.status === "failed" || task.status === "cancelled") &&
            !hub.isOpen(taskId) &&
            !hub.hasBuffer(taskId)
          ) {
            return;
          }
          await new Promise<void>((resolve, reject) => {
            const { unsubscribe, closed } = hub.subscribe(taskId, (chunk: UIMessageChunk) => {
              try {
                writer.write(chunk);
              } catch (error) {
                unsubscribe();
                reject(error);
              }
            });
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
              if (!hub.isOpen(taskId)) {
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
      const message = error instanceof Error && error.message ? error.message : "委托流失败";
      sendNodeJson(res, 500, { error: message });
    } finally {
      req.socket?.off("close", onClientGone);
      res.off("close", onClientGone);
    }
    return RESPONSE_ALREADY_SENT;
  });
}

import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
import type { Hono } from "hono";
import { createUIMessageStream, pipeUIMessageStreamToResponse, type UIMessageChunk } from "ai";

import { BackendClientError } from "../../control/errors.js";
import { DelegationError } from "../../session/delegation/index.js";
import { GroupError, type GroupMember } from "../../session/group/index.js";
import { clearGroupWorkspace, ensureGroupWorkspace } from "../../session/group/workspace.js";
import { pageItems, parseTranscriptPageQuery, TRANSCRIPT_PAGE_SIZE } from "../../session/transcript-page.js";
import type { GroupRoom } from "../../session/group/types.js";
import { MAX_ATTACHMENT_BODY_BYTES, parsePromptAttachments, removeStagedAttachment, stageAttachment, stageAttachmentFromPath } from "../../session/workspace/attachments.js";
import {
  backfillMissingGroups,
  pushGroupDelete,
  pushGroupMeta,
  pushGroupTitle,
} from "../group-cloud.js";
import {
  bearer,
  json,
  LocalError,
  optionalText,
  readJson,
  requireUserId,
  sendNodeJson,
  text,
  type LocalAppDeps,
  type LocalAppEnv,
} from "../http.js";

export function registerGroupRoutes(app: Hono<LocalAppEnv>, deps: LocalAppDeps): void {
  app.get("/groups", async (c) => {
    const token = bearer(c);
    const userId = requireUserId(c.req.query("user_id") ?? "");
    const rooms = deps.groupTurns.list(userId);
    // 已有本机群补传到控制面（游客 401 跳过）
    await backfillMissingGroups(deps.config.backendUrl, token, rooms);
    return json(c, 200, {
      groups: rooms.map((room) => {
        const page = deps.groupTurns.linePage(userId, room.id, { limit: TRANSCRIPT_PAGE_SIZE });
        return { ...room, lines: page.lines, linesHasMore: page.hasMore };
      }),
    });
  });

  app.post("/groups", async (c) => {
    const token = bearer(c);
    const body = await readJson(c);
    const userId = text(body, "user_id");
    const title = typeof body.title === "string" ? body.title : "";
    const members = parseMembers(body.members);
    try {
      const room = deps.groups.create({ userId, title, members });
      try {
        await pushGroupMeta(deps.config.backendUrl, token, room);
      } catch (error) {
        deps.groups.remove(userId, room.id);
        rethrowCloud(error);
      }
      return json(c, 200, { group: pagedRoom(room) });
    } catch (error) {
      rethrow(error);
    }
  });

  app.get("/groups/:groupId", (c) => {
    bearer(c);
    const userId = requireUserId(c.req.query("user_id") ?? "");
    const groupId = c.req.param("groupId");
    try {
      return json(c, 200, {
        group: deps.groupTurns.view(userId, groupId),
        liveTurnId: deps.groupTurns.liveTurnId(userId, groupId),
      });
    } catch (error) {
      rethrow(error);
    }
  });

  /** 改群名：先算权威 title 写控制面，成功后再改本机索引。 */
  app.put("/groups/:groupId", async (c) => {
    const token = bearer(c);
    const body = await readJson(c);
    const userId = text(body, "user_id");
    const groupId = c.req.param("groupId");
    if (typeof body.title !== "string") throw new LocalError("群名称无效", 400);
    try {
      const current = deps.groups.store.peek(userId, groupId);
      const resolved =
        body.title.trim() || current.members.map((member) => member.name).join("、");
      try {
        await pushGroupTitle(deps.config.backendUrl, token, {
          id: groupId,
          title: resolved,
          members: current.members,
        });
      } catch (error) {
        rethrowCloud(error);
      }
      const room = deps.groups.rename(userId, groupId, body.title);
      return json(c, 200, { group: pagedRoom(room) });
    } catch (error) {
      rethrow(error);
    }
  });

  app.get("/groups/:groupId/turn-stream", async (c) => {
    bearer(c);
    const userId = requireUserId(c.req.query("user_id") ?? "");
    const groupId = c.req.param("groupId");
    const req = c.env.incoming;
    const res = c.env.outgoing;
    try {
      deps.groupTurns.view(userId, groupId);
    } catch (error) {
      rethrow(error);
    }
    const cancel = new AbortController();
    const onClientGone = () => {
      if (res.writableFinished) return;
      cancel.abort();
    };
    req.socket?.once("close", onClientGone);
    res.once("close", onClientGone);
    try {
      const open = deps.groupTurns.isTurnOpen(userId, groupId);
      res.setHeader("x-group-turn-open", open ? "1" : "0");
      res.setHeader("access-control-expose-headers", "x-group-turn-open");
      const stream = createUIMessageStream({
        execute: async ({ writer }) => {
          await deps.groupTurns.follow(
            userId,
            groupId,
            (chunk: UIMessageChunk) => writer.write(chunk),
            cancel.signal,
          );
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

  app.get("/groups/:groupId/lines", (c) => {
    bearer(c);
    const userId = requireUserId(c.req.query("user_id") ?? "");
    const groupId = c.req.param("groupId");
    const query = parseTranscriptPageQuery(c.req.query("limit"), c.req.query("before"));
    if (!query) throw new LocalError("请求无效", 400);
    const limit = query.full ? TRANSCRIPT_PAGE_SIZE : query.limit;
    const beforeId = query.full ? undefined : query.beforeId;
    try {
      const page = deps.groupTurns.linePage(userId, groupId, { limit, beforeId });
      return json(c, 200, { lines: page.lines, hasMore: page.hasMore });
    } catch (error) {
      rethrow(error);
    }
  });

  app.post("/groups/:groupId/messages", async (c) => {
    bearer(c);
    const body = await readJson(c);
    const userId = text(body, "user_id");
    const groupId = c.req.param("groupId");
    try {
      const room = deps.groupTurns.post(userId, groupId, text(body, "text"));
      return json(c, 200, { room: pagedRoom(room), liveTurnId: deps.groupTurns.liveTurnId(userId, groupId) });
    } catch (error) {
      rethrow(error);
    }
  });

  app.post("/groups/:groupId/messages/:messageId", async (c) => {
    bearer(c);
    const body = await readJson(c);
    const userId = text(body, "user_id");
    const groupId = c.req.param("groupId");
    const messageId = c.req.param("messageId");
    try {
      const room = await deps.groupTurns.edit(userId, groupId, messageId, text(body, "text"));
      return json(c, 200, { room: pagedRoom(room), liveTurnId: deps.groupTurns.liveTurnId(userId, groupId) });
    } catch (error) {
      rethrow(error);
    }
  });

  app.post("/groups/:groupId/tasks", async (c) => {
    bearer(c);
    const body = await readJson(c);
    const userId = text(body, "user_id");
    try {
      const group = await deps.groups.assign(
        userId,
        c.req.param("groupId"),
        text(body, "to_agent_id"),
        text(body, "brief"),
      );
      return json(c, 200, { group: pagedRoom(group) });
    } catch (error) {
      rethrow(error);
    }
  });

  app.post("/groups/:groupId/queue/:queueId/cancel", async (c) => {
    bearer(c);
    const body = await readJson(c);
    const userId = text(body, "user_id");
    try {
      return json(c, 200, {
        group: pagedRoom(
          deps.groups.cancelQueue(userId, c.req.param("groupId"), c.req.param("queueId")),
        ),
      });
    } catch (error) {
      rethrow(error);
    }
  });

  app.post("/groups/:groupId/stop", async (c) => {
    bearer(c);
    const body = await readJson(c);
    const userId = text(body, "user_id");
    const groupId = c.req.param("groupId");
    try {
      const group = await deps.groupTurns.stop(userId, groupId);
      return json(c, 200, { group: pagedRoom(group), liveTurnId: deps.groupTurns.liveTurnId(userId, groupId) });
    } catch (error) {
      rethrow(error);
    }
  });

  app.post("/groups/:groupId/context", async (c) => {
    bearer(c);
    const body = await readJson(c);
    const userId = text(body, "user_id");
    const groupId = c.req.param("groupId");
    try {
      return json(c, 200, {
        room: pagedRoom(await deps.groupTurns.clearContext(userId, groupId)),
        liveTurnId: deps.groupTurns.liveTurnId(userId, groupId),
      });
    } catch (error) {
      rethrow(error);
    }
  });

  app.post("/groups/:groupId/workspace/clear", async (c) => {
    bearer(c);
    const body = await readJson(c);
    const userId = requireUserId(text(body, "user_id"));
    const groupId = c.req.param("groupId") ?? "";
    try {
      deps.groupTurns.touch(userId, groupId);
      clearGroupWorkspace(deps.config.userDataRoot, userId, groupId, body.include_work === true);
      return json(c, 200, { cleared: true });
    } catch (error) {
      rethrow(error);
    }
  });

  app.delete("/groups/:groupId", async (c) => {
    const token = bearer(c);
    const userId = requireUserId(c.req.query("user_id") ?? "");
    const groupId = c.req.param("groupId") ?? "";
    try {
      await pushGroupDelete(deps.config.backendUrl, token, groupId);
      await deps.groupTurns.remove(userId, groupId);
      return json(c, 200, { deleted: true });
    } catch (error) {
      rethrow(error);
    }
  });

  app.post("/groups/:groupId/attachments", async (c) => {
    bearer(c);
    // base64 附件 body：放宽到 15MB 附件 + base64 膨胀 + 余量（22MB）
    const body = await readJson(c, { maxBytes: MAX_ATTACHMENT_BODY_BYTES });
    const userId = requireUserId(text(body, "user_id"));
    const groupId = c.req.param("groupId");
    try {
      deps.groupTurns.touch(userId, groupId);
      const [attachment] = parsePromptAttachments({ attachments: [body] });
      if (!attachment) throw new LocalError("请求无效", 400);
      const workspace = ensureGroupWorkspace(deps.config.userDataRoot, userId, groupId);
      const staged = stageAttachment(workspace.root, attachment);
      return json(c, 200, {
        id: staged.id,
        path: staged.path,
        ref: staged.ref,
        name: staged.name,
        media_type: staged.mediaType,
      });
    } catch (error) {
      rethrow(error);
    }
  });

  /** 大文件直连：按本机路径复制 staging，字节不经 JSON/base64，桌面渲染进程不转码。 */
  app.post("/groups/:groupId/attachments/from-path", async (c) => {
    bearer(c);
    const body = await readJson(c);
    const userId = requireUserId(text(body, "user_id"));
    const groupId = c.req.param("groupId");
    try {
      deps.groupTurns.touch(userId, groupId);
      const workspace = ensureGroupWorkspace(deps.config.userDataRoot, userId, groupId);
      const staged = stageAttachmentFromPath(workspace.root, {
        path: text(body, "path"),
        name: optionalText(body, "name"),
        mediaType: optionalText(body, "media_type"),
      });
      return json(c, 200, {
        id: staged.id,
        path: staged.path,
        ref: staged.ref,
        name: staged.name,
        media_type: staged.mediaType,
      });
    } catch (error) {
      rethrow(error);
    }
  });

  app.delete("/groups/:groupId/attachments", (c) => {
    bearer(c);
    const userId = requireUserId(c.req.query("user_id") ?? "");
    const groupId = c.req.param("groupId");
    try {
      deps.groupTurns.touch(userId, groupId);
      const workspace = ensureGroupWorkspace(deps.config.userDataRoot, userId, groupId);
      removeStagedAttachment(workspace.root, c.req.query("path") ?? "");
      return json(c, 200, { deleted: true });
    } catch (error) {
      rethrow(error);
    }
  });
}

function pagedRoom(room: GroupRoom): GroupRoom & { linesHasMore: boolean } {
  const page = pageItems(room.lines, { limit: TRANSCRIPT_PAGE_SIZE });
  return { ...room, lines: page.items, linesHasMore: page.hasMore };
}

function parseMembers(value: unknown): GroupMember[] {
  if (!Array.isArray(value)) throw new LocalError("成员无效", 400);
  return value.map((item) => {
    if (!item || typeof item !== "object") throw new LocalError("成员无效", 400);
    const record = item as { agentId?: unknown; name?: unknown };
    if (typeof record.agentId !== "string" || typeof record.name !== "string") {
      throw new LocalError("成员无效", 400);
    }
    return { agentId: record.agentId, name: record.name };
  });
}

function rethrow(error: unknown): never {
  if (error instanceof GroupError || error instanceof DelegationError) throw new LocalError(error.message, 400);
  rethrowCloud(error);
}

function rethrowCloud(error: unknown): never {
  if (error instanceof BackendClientError) {
    throw new LocalError(error.message, error.status >= 400 && error.status < 600 ? error.status : 502);
  }
  throw error;
}

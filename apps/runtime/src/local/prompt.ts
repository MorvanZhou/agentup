import type { IncomingMessage, ServerResponse } from "node:http";

import { pipeUIMessageStreamToResponse } from "ai";

import { ConfigError, type ModelConfig } from "../config/load.js";
import type { UiLocale } from "../i18n/locale.js";
import { AttachmentError, type PromptAttachment } from "../session/workspace/attachments.js";
import { resolveVisitModelConfig } from "../session/model/session-model.js";
import { ChatBusy, VisitChats, type PromptRewind } from "../session/turn/index.js";
import type { Visit } from "../package/sync.js";
import { LocalError, sendNodeJson } from "./http.js";

export async function streamPrompt(
  chats: VisitChats,
  /** 设备级回落（委托等）；主对话按 Visit session 解析。 */
  readModel: () => ModelConfig,
  visit: Visit,
  text: string,
  req: IncomingMessage,
  res: ServerResponse,
  rewind?: PromptRewind,
  attachments: readonly PromptAttachment[] = [],
  userDataRoot?: string,
  locale?: UiLocale | string | null,
): Promise<void> {
  const model = userDataRoot
    ? resolveVisitModelConfig(userDataRoot, visit)
    : readModel();
  const cancel = new AbortController();
  const onClientGone = () => {
    if (res.writableFinished) return;
    cancel.abort();
  };
  const socket = req.socket;
  socket?.once("close", onClientGone);
  res.once("close", onClientGone);
  try {
    const stream = await chats.promptStream(
      visit,
      model,
      text,
      cancel.signal,
      rewind,
      attachments,
      locale,
    );
    await pipeUIMessageStreamToResponse({ response: res, stream });
  } catch (error) {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (error instanceof AttachmentError) {
      sendNodeJson(res, error.status, { error: error.message });
      return;
    }
    if (error instanceof ConfigError) {
      sendNodeJson(res, 503, { error: error.message });
      return;
    }
    const message = error instanceof Error && error.message ? error.message : "对话失败";
    sendNodeJson(res, error instanceof ChatBusy ? 409 : 500, { error: message });
  } finally {
    socket?.off("close", onClientGone);
    res.off("close", onClientGone);
  }
}

/** 兼容自定义 `{ text }` 与 AI SDK transport 的 `{ messages }`；允许仅附件。 */
export function promptText(body: Record<string, unknown>): string {
  if (typeof body.text === "string") {
    const text = body.text.trim();
    if (text || hasAttachmentPayload(body)) return text;
    throw new LocalError("请求无效", 400);
  }
  if (!Array.isArray(body.messages)) {
    if (hasAttachmentPayload(body)) return "";
    throw new LocalError("请求无效", 400);
  }
  for (let index = body.messages.length - 1; index >= 0; index -= 1) {
    const message = body.messages[index];
    if (!message || typeof message !== "object") continue;
    const record = message as { role?: unknown; parts?: unknown };
    if (record.role !== "user" || !Array.isArray(record.parts)) continue;
    const text = record.parts
      .map((part) =>
        part && typeof part === "object" && (part as { type?: unknown }).type === "text"
          ? String((part as { text?: unknown }).text ?? "")
          : "",
      )
      .join("")
      .trim();
    if (text || hasAttachmentPayload(body)) return text;
  }
  if (hasAttachmentPayload(body)) return "";
  throw new LocalError("请求无效", 400);
}

function hasAttachmentPayload(body: Record<string, unknown>): boolean {
  const raw = body.attachments ?? body.images;
  return Array.isArray(raw) && raw.length > 0;
}

/** 编辑旧消息重发：带回退目标（Pi entry id 或当前分支 user 下标）。 */
export function promptRewind(body: Record<string, unknown>): PromptRewind | undefined {
  const messageId =
    typeof body.rewind_message_id === "string" && body.rewind_message_id.trim()
      ? body.rewind_message_id.trim()
      : undefined;
  const ordinalRaw = body.user_turn_ordinal;
  const userTurnOrdinal =
    typeof ordinalRaw === "number" && Number.isInteger(ordinalRaw) && ordinalRaw >= 0
      ? ordinalRaw
      : undefined;
  if (!messageId && userTurnOrdinal === undefined) return undefined;
  return { messageId, userTurnOrdinal };
}

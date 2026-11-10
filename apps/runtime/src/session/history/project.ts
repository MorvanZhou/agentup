import fs from "node:fs";

import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { DynamicToolUIPart, UIDataTypes, UIMessage, UIMessagePart, UITools } from "ai";

import { DELEGATION_RESULT_CUSTOM_TYPE } from "../delegation/types.js";
import { assistantFailureNotice } from "../model/unavailable.js";
import { ASYNC_WAKE_CUSTOM_TYPE } from "../wake/index.js";
import {
  AGENTUP_ARTIFACTS_CUSTOM_TYPE,
  parseArtifactsEntryData,
} from "./artifacts.js";
import {
  AGENTUP_DELIVERABLES_CUSTOM_TYPE,
  parseDeliverablesEntryData,
} from "./deliverables.js";
import {
  AGENTUP_PREVIEW_CUSTOM_TYPE,
  parsePreviewEntryData,
} from "../tools/present-preview.js";
import { healInterruptedSessionTools, settleInterruptedToolParts } from "./heal.js";
import {
  AGENTUP_REPLY_MODEL_CUSTOM_TYPE,
  parseReplyModelEntryData,
} from "./reply-model.js";
import { AGENTUP_SUMMARY_CUSTOM_TYPE, parseSummaryEntryData } from "./summary.js";
import { projectToolOutput, projectToolText } from "./tool-output.js";

/** 从 SessionManager 投影，user 消息 id 使用 Pi entry id，便于编辑重发时 rewind。 */
export function projectHistoryFromManager(manager: SessionManager, idPrefix = "session"): UIMessage[] {
  const branch = manager.getBranch();
  const messages: unknown[] = [];
  const entryIds: Array<string | undefined> = [];
  /** 下一条真实 assistant 标为主动同步（紧跟 async_wake）。 */
  let markNextAssistantProactive = false;
  for (const entry of branch) {
    if (entry.type === "message") {
      const raw = entry.message as { role?: unknown };
      if (raw?.role === "assistant" && markNextAssistantProactive) {
        messages.push({ ...(entry.message as object), __agentUpProactive: true });
        markNextAssistantProactive = false;
      } else {
        if (raw?.role === "user") markNextAssistantProactive = false;
        messages.push(entry.message);
      }
      entryIds.push(entry.id);
      continue;
    }
    if (entry.type === "custom" && entry.customType === AGENTUP_SUMMARY_CUSTOM_TYPE) {
      const summary = parseSummaryEntryData(entry.data);
      if (!summary) continue;
      // 挂到最近一条非委托 assistant，供合并投影写入 metadata.custom.agentUpSummary
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const raw = messages[index];
        if (!raw || typeof raw !== "object") continue;
        const message = raw as { role?: unknown; __agentUpDelegation?: unknown };
        if (message.role !== "assistant" || message.__agentUpDelegation === true) continue;
        messages[index] = { ...message, __agentUpSummary: summary };
        break;
      }
      continue;
    }
    if (entry.type === "custom" && entry.customType === AGENTUP_ARTIFACTS_CUSTOM_TYPE) {
      const artifacts = parseArtifactsEntryData(entry.data);
      if (!artifacts) continue;
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const raw = messages[index];
        if (!raw || typeof raw !== "object") continue;
        const message = raw as { role?: unknown; __agentUpDelegation?: unknown };
        if (message.role !== "assistant" || message.__agentUpDelegation === true) continue;
        messages[index] = { ...message, __agentUpArtifacts: artifacts };
        break;
      }
      continue;
    }
    if (entry.type === "custom" && entry.customType === AGENTUP_DELIVERABLES_CUSTOM_TYPE) {
      const deliverables = parseDeliverablesEntryData(entry.data);
      if (!deliverables) continue;
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const raw = messages[index];
        if (!raw || typeof raw !== "object") continue;
        const message = raw as { role?: unknown; __agentUpDelegation?: unknown };
        if (message.role !== "assistant" || message.__agentUpDelegation === true) continue;
        messages[index] = { ...message, __agentUpDeliverables: deliverables };
        break;
      }
      continue;
    }
    if (entry.type === "custom" && entry.customType === AGENTUP_PREVIEW_CUSTOM_TYPE) {
      const preview = parsePreviewEntryData(entry.data);
      if (!preview) continue;
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const raw = messages[index];
        if (!raw || typeof raw !== "object") continue;
        const message = raw as { role?: unknown; __agentUpDelegation?: unknown };
        if (message.role !== "assistant" || message.__agentUpDelegation === true) continue;
        messages[index] = { ...message, __agentUpPreview: preview };
        break;
      }
      continue;
    }
    if (entry.type === "custom" && entry.customType === AGENTUP_REPLY_MODEL_CUSTOM_TYPE) {
      const replyModel = parseReplyModelEntryData(entry.data);
      if (!replyModel) continue;
      // 挂到最近一条非委托 assistant，供合并投影写入 metadata.custom.agentUpReplyModel
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const raw = messages[index];
        if (!raw || typeof raw !== "object") continue;
        const message = raw as { role?: unknown; __agentUpDelegation?: unknown };
        if (message.role !== "assistant" || message.__agentUpDelegation === true) continue;
        messages[index] = { ...message, __agentUpReplyModel: replyModel };
        break;
      }
      continue;
    }
    if (
      entry.type === "custom_message" &&
      entry.customType === ASYNC_WAKE_CUSTOM_TYPE
    ) {
      // 空闲 wake：打断 assistant 合并，并标记随后一条为「主动同步」新气泡。
      messages.push({ role: "assistant", content: [], __agentUpSegmentBreak: true });
      entryIds.push(undefined);
      markNextAssistantProactive = true;
      continue;
    }
    if (
      entry.type === "custom_message" &&
      entry.customType === DELEGATION_RESULT_CUSTOM_TYPE &&
      entry.display
    ) {
      messages.push({
        role: "assistant",
        content: [{ type: "text", text: customMessageText(entry.content) }],
        __agentUpDelegation: true,
        __agentUpDetails: entry.details,
      });
      entryIds.push(entry.id);
    }
  }
  return projectHistory(messages, idPrefix, entryIds);
}

/** 把 Pi 会话消息投影成 AI SDK UIMessage，保留 parts 出现顺序。 */
export function projectHistory(
  messages: readonly unknown[],
  idPrefix = "session",
  entryIds?: ReadonlyArray<string | undefined>,
): UIMessage[] {
  const result: UIMessage[] = [];
  const tools = new Map<string, DynamicToolUIPart>();
  let assistant: UIMessage | undefined;

  messages.forEach((raw, index) => {
    if (!raw || typeof raw !== "object") return;
    const message = raw as { role?: unknown; content?: unknown; timestamp?: unknown };
    const createdAt = createdAtMetadata(message.timestamp);
    if (message.role === "user") {
      assistant = undefined;
      const entryId = entryIds?.[index];
      const id = typeof entryId === "string" && entryId ? entryId : `${idPrefix}-user-${index}`;
      const custom = {
        ...(createdAt?.custom ?? {}),
        ...(typeof entryId === "string" && entryId ? { agentUpEntryId: entryId } : {}),
      };
      result.push({
        id,
        role: "user",
        parts: userParts(message.content),
        ...(Object.keys(custom).length > 0 ? { metadata: { custom } } : {}),
      });
      return;
    }
    if (message.role === "assistant") {
      if ((raw as { __agentUpSegmentBreak?: unknown }).__agentUpSegmentBreak === true) {
        // 下一轮 assistant 必须新开气泡（空闲异步同步），不得并入上一句。
        assistant = undefined;
        return;
      }
      const delegation = (raw as { __agentUpDelegation?: unknown }).__agentUpDelegation === true;
      if (delegation) {
        assistant = undefined;
        const entryId = entryIds?.[index];
        const details = (raw as { __agentUpDetails?: unknown }).__agentUpDetails;
        result.push({
          id: typeof entryId === "string" && entryId ? entryId : `${idPrefix}-delegation-${index}`,
          role: "assistant",
          parts: [{ type: "text", text: userText(message.content), state: "done" }],
          metadata: {
            custom: {
              agentUpDelegation: true,
              ...(details && typeof details === "object" ? (details as Record<string, unknown>) : {}),
            },
          },
        });
        return;
      }
      const proactive = (raw as { __agentUpProactive?: unknown }).__agentUpProactive === true;
      if (!assistant) {
        const entryId = entryIds?.[index];
        const id =
          typeof entryId === "string" && entryId ? entryId : `${idPrefix}-assistant-${index}`;
        const replyModel = parseReplyModelEntryData(
          (raw as { __agentUpReplyModel?: unknown }).__agentUpReplyModel,
        );
        const custom = {
          ...(createdAt?.custom ?? {}),
          ...(typeof entryId === "string" && entryId ? { agentUpEntryId: entryId } : {}),
          ...(proactive ? { agentUpProactiveSync: true } : {}),
          ...(replyModel ? { agentUpReplyModel: replyModel } : {}),
        };
        assistant = {
          id,
          role: "assistant",
          parts: [],
          ...(Object.keys(custom).length > 0 ? { metadata: { custom } } : {}),
        };
        result.push(assistant);
      } else {
        // 合并气泡：后附的 reply-model 挂在后续 Pi assistant 上时仍并进 metadata
        const replyModel = parseReplyModelEntryData(
          (raw as { __agentUpReplyModel?: unknown }).__agentUpReplyModel,
        );
        if (replyModel && assistant) {
          const prev =
            typeof assistant.metadata === "object" && assistant.metadata
              ? (assistant.metadata as Record<string, unknown>)
              : {};
          const prevCustom =
            prev.custom && typeof prev.custom === "object"
              ? (prev.custom as Record<string, unknown>)
              : {};
          assistant.metadata = {
            ...prev,
            custom: { ...prevCustom, agentUpReplyModel: replyModel },
          };
        }
      }
      for (const part of Array.isArray(message.content) ? message.content : []) {
        if (!part || typeof part !== "object") continue;
        const item = part as Record<string, unknown>;
        if (item.type === "thinking" && typeof item.thinking === "string" && item.thinking) {
          assistant.parts.push({ type: "reasoning", text: item.thinking, state: "done" });
        }
        if (item.type === "text" && typeof item.text === "string" && item.text) {
          assistant.parts.push({ type: "text", text: item.text, state: "done" });
        }
        if (item.type === "toolCall" && typeof item.id === "string" && typeof item.name === "string") {
          const tool: DynamicToolUIPart = {
            type: "dynamic-tool",
            toolCallId: item.id,
            toolName: item.name,
            state: "input-available",
            input: item.arguments ?? {},
          };
          tools.set(item.id, tool);
          assistant.parts.push(tool);
        }
      }
      const error = (raw as { errorMessage?: unknown }).errorMessage;
      if (typeof error === "string" && error) {
        assistant.metadata = { ...(typeof assistant.metadata === "object" && assistant.metadata ? assistant.metadata : {}), error };
        // Pi 常只留空 assistant + errorMessage（连不上 / 429 / abort 等）；补可读正文，重开历史也能看到原因。
        if (!assistant.parts.some((part) => part.type === "text" && Boolean(part.text?.trim()))) {
          const notice = assistantFailureNotice(error, undefined, { includeCancel: true });
          if (notice) {
            assistant.parts.push({
              type: "text",
              text: notice,
              state: "done",
            });
          }
        }
      }
      const summary = parseSummaryEntryData((raw as { __agentUpSummary?: unknown }).__agentUpSummary);
      const artifacts = parseArtifactsEntryData(
        (raw as { __agentUpArtifacts?: unknown }).__agentUpArtifacts,
      );
      const deliverables = parseDeliverablesEntryData(
        (raw as { __agentUpDeliverables?: unknown }).__agentUpDeliverables,
      );
      const preview = parsePreviewEntryData((raw as { __agentUpPreview?: unknown }).__agentUpPreview);
      if (summary || artifacts || deliverables || preview) {
        const prev =
          typeof assistant.metadata === "object" && assistant.metadata
            ? (assistant.metadata as Record<string, unknown>)
            : {};
        const prevCustom =
          prev.custom && typeof prev.custom === "object"
            ? (prev.custom as Record<string, unknown>)
            : {};
        // 序数按合并后气泡（可能含多条 Pi assistant）计，勿只按本条 content 裁剪。
        assistant.metadata = {
          ...prev,
          custom: {
            ...prevCustom,
            ...(summary ? { agentUpSummary: clampSummaryIndex(summary, assistant.parts) } : {}),
            ...(artifacts ? { agentUpArtifacts: artifacts } : {}),
            ...(deliverables ? { agentUpDeliverables: deliverables } : {}),
            ...(preview ? { agentUpPreview: preview } : {}),
          },
        };
      }
      return;
    }
    if (message.role === "toolResult") {
      const record = raw as { toolCallId?: unknown; isError?: unknown };
      const tool = typeof record.toolCallId === "string" ? tools.get(record.toolCallId) : undefined;
      if (!tool) return;
      const output = projectToolOutput(message.content);
      const next: DynamicToolUIPart =
        record.isError === true
          ? {
              type: "dynamic-tool",
              toolCallId: tool.toolCallId,
              toolName: tool.toolName,
              state: "output-error",
              input: tool.input ?? {},
              errorText: projectToolText(message.content) || "工具调用失败",
            }
          : {
              type: "dynamic-tool",
              toolCallId: tool.toolCallId,
              toolName: tool.toolName,
              state: "output-available",
              input: tool.input ?? {},
              output,
            };
      tools.set(tool.toolCallId, next);
      replaceToolPart(assistant, tool.toolCallId, next);
    }
  });

  settleInterruptedToolParts(result);
  return result;
}

/** 打开会话文件并投影；退出留下的悬空 toolCall 先愈合。 */
export function projectSession(
  cwd: string,
  sessionDir: string,
  info: { id: string; path: string },
): UIMessage[] {
  if (!fs.existsSync(info.path)) return [];
  const manager = SessionManager.open(info.path, sessionDir, cwd);
  // 退出时可能留下无结果的 toolCall（ask_user / 审批中命令等）；先写入中断结果再投影。
  healInterruptedSessionTools(manager);
  return projectHistoryFromManager(manager, info.id);
}

/**
 * 摘要序数按「合并后气泡」非空 text 计。
 * 越界（例如 wake 前旧序号）收到本气泡最后一段。
 */
function clampSummaryIndex(
  summary: { textPartIndex: number },
  parts: unknown,
): { textPartIndex: number } {
  let count = 0;
  if (Array.isArray(parts)) {
    for (const part of parts) {
      if (!part || typeof part !== "object") continue;
      const item = part as { type?: unknown; text?: unknown };
      if (item.type === "text" && typeof item.text === "string" && item.text) count += 1;
    }
  }
  if (count <= 0 || summary.textPartIndex < count) return summary;
  return { textPartIndex: count - 1 };
}

/** Pi 消息 timestamp（毫秒）→ UIMessage metadata，供桌面时间分隔使用。 */
function createdAtMetadata(timestamp: unknown): { custom: { agentUpCreatedAt: string } } | undefined {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp) || timestamp <= 0) return undefined;
  return { custom: { agentUpCreatedAt: new Date(timestamp).toISOString() } };
}

function replaceToolPart(assistant: UIMessage | undefined, toolCallId: string, next: DynamicToolUIPart): void {
  if (!assistant) return;
  assistant.parts = assistant.parts.map((part: UIMessagePart<UIDataTypes, UITools>) =>
    part.type === "dynamic-tool" && part.toolCallId === toolCallId ? next : part,
  );
}

function customMessageText(content: string | Array<{ type?: string; text?: string }>): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text!)
    .join("");
}

function userText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (part && typeof part === "object" && (part as { type?: unknown }).type === "text" ? String((part as { text?: unknown }).text ?? "") : ""))
    .join("");
}

/** 用户消息：文本 + 图片（Pi ImageContent → AI SDK file part，供气泡附件回显）。 */
function userParts(content: unknown): UIMessagePart<UIDataTypes, UITools>[] {
  if (typeof content === "string") {
    return content ? [{ type: "text", text: content }] : [];
  }
  if (!Array.isArray(content)) return [];
  const parts: UIMessagePart<UIDataTypes, UITools>[] = [];
  let imageIndex = 0;
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const item = part as Record<string, unknown>;
    if (item.type === "text" && typeof item.text === "string" && item.text) {
      parts.push({ type: "text", text: item.text });
      continue;
    }
    if (
      item.type === "image" &&
      typeof item.data === "string" &&
      item.data &&
      typeof item.mimeType === "string" &&
      item.mimeType
    ) {
      imageIndex += 1;
      const mediaType = item.mimeType;
      const ext =
        mediaType === "image/png"
          ? "png"
          : mediaType === "image/jpeg"
            ? "jpg"
            : mediaType === "image/gif"
              ? "gif"
              : mediaType === "image/webp"
                ? "webp"
                : "bin";
      parts.push({
        type: "file",
        mediaType,
        url: `data:${mediaType};base64,${item.data}`,
        filename: `image-${imageIndex}.${ext}`,
      });
    }
  }
  return parts.length > 0 ? parts : [{ type: "text", text: "" }];
}

import fs from "node:fs";
import path from "node:path";

import { buildSessionContext, SessionManager } from "@earendil-works/pi-coding-agent";
import type { DynamicToolUIPart, UIDataTypes, UIMessage, UIMessagePart, UITools } from "ai";

import { ensurePersonalAssistant } from "../../local/assistant/personal-assistant.js";
import { clearCheckpoints } from "../checkpoint/checkpoint.js";
import { DELEGATION_RESULT_CUSTOM_TYPE } from "../delegation/types.js";
import { isModelServiceUnavailable, modelUnavailableNotice } from "../model/unavailable.js";
import { stampNewSessionModel } from "../model/session-model.js";
import { ASYNC_WAKE_CUSTOM_TYPE } from "../wake/index.js";
import {
  AGENTUP_ARTIFACTS_CUSTOM_TYPE,
  parseArtifactsEntryData,
} from "./artifacts.js";
import { AGENTUP_SUMMARY_CUSTOM_TYPE, parseSummaryEntryData } from "./summary.js";

export const CONTEXT_RESET_TEXT = "已开始新对话，之后不再带入此前上下文";

/** 与 ask_user 正常取消文案对齐，便于桌面摘要识别为「已放弃」。 */
export const INTERRUPTED_ASK_USER_RESULT =
  "User dismissed the questions. Session was interrupted before answers were received.";
export const INTERRUPTED_TOOL_RESULT =
  "Tool call interrupted: the app exited before the tool finished.";

/** 新开一个空的 Pi 会话，让之后的消息不再带上之前的上下文。旧会话文件保留。 */
export function clearContext(userDataRoot: string, userId: string, agentId: string): void {
  const { cwd, sessionDir } = visitSession(userDataRoot, userId, agentId);
  clearContextAt(userDataRoot, cwd, sessionDir);
}

export function clearPersonalContext(userDataRoot: string, userId: string): void {
  const root = ensurePersonalAssistant(userDataRoot, userId);
  clearContextAt(userDataRoot, path.join(root, "cwd"), path.join(root, "sessions"));
}

function clearContextAt(userDataRoot: string, cwd: string, sessionDir: string): void {
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(sessionDir, { recursive: true });
  const created = SessionManager.create(cwd, sessionDir);
  const file = created.getSessionFile();
  if (!file) throw new Error("没有生成新会话");
  fs.writeFileSync(file, "");
  SessionManager.open(file, sessionDir, cwd);
  // 新对话继承上一 session 模型（无则 enabled 第一个）
  stampNewSessionModel(userDataRoot, cwd, sessionDir);
}

/** 永久删除该 Agent 本机全部会话文件；不动 cwd 工作产物。 */
export function clearHistory(userDataRoot: string, userId: string, agentId: string): void {
  const { sessionDir, visitRoot } = visitSession(userDataRoot, userId, agentId);
  clearHistoryAt(sessionDir);
  clearCheckpoints(visitRoot);
}

export function clearPersonalHistory(userDataRoot: string, userId: string): void {
  const root = ensurePersonalAssistant(userDataRoot, userId);
  clearHistoryAt(path.join(root, "sessions"));
  clearCheckpoints(root);
}

function clearHistoryAt(sessionDir: string): void {
  if (fs.existsSync(sessionDir)) fs.rmSync(sessionDir, { recursive: true, force: true });
  fs.mkdirSync(sessionDir, { recursive: true });
}

/**
 * 读取本机 `sessions/` 里全部 Pi 会话，按创建时间拼成一条时间线。
 * 会话边界插入「新对话」标记；只读文件，不经 backend，也不创建会话。
 */
export async function readHistory(userDataRoot: string, userId: string, agentId: string): Promise<UIMessage[]> {
  const { cwd, sessionDir } = visitSession(userDataRoot, userId, agentId);
  return readHistoryAt(cwd, sessionDir);
}

export async function readPersonalHistory(userDataRoot: string, userId: string): Promise<UIMessage[]> {
  const root = ensurePersonalAssistant(userDataRoot, userId);
  return readHistoryAt(path.join(root, "cwd"), path.join(root, "sessions"));
}

async function readHistoryAt(cwd: string, sessionDir: string): Promise<UIMessage[]> {
  if (!fs.existsSync(sessionDir)) return [];

  const sessions = await SessionManager.list(cwd, sessionDir);
  sessions.sort((left, right) => {
    const delta = left.created.getTime() - right.created.getTime();
    return delta !== 0 ? delta : left.path.localeCompare(right.path);
  });

  const result: UIMessage[] = [];
  let pendingReset = false;

  for (const info of sessions) {
    if (!fs.existsSync(info.path)) continue;
    const manager = SessionManager.open(info.path, sessionDir, cwd);
    // 退出时可能留下无结果的 toolCall（ask_user / 审批中命令等）；先写入中断结果再投影。
    healInterruptedSessionTools(manager);
    const messages = projectHistoryFromManager(manager, info.id);
    if (messages.length === 0) {
      if (result.length > 0) pendingReset = true;
      continue;
    }
    if (result.length > 0) {
      result.push(contextResetMessage(info.id));
      pendingReset = false;
    }
    result.push(...messages);
  }

  if (pendingReset) {
    result.push(contextResetMessage("pending"));
  }

  return result;
}

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
        const custom = {
          ...(createdAt?.custom ?? {}),
          ...(typeof entryId === "string" && entryId ? { agentUpEntryId: entryId } : {}),
          ...(proactive ? { agentUpProactiveSync: true } : {}),
        };
        assistant = {
          id,
          role: "assistant",
          parts: [],
          ...(Object.keys(custom).length > 0 ? { metadata: { custom } } : {}),
        };
        result.push(assistant);
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
        // 模型连不上时 Pi 只留空 assistant + errorMessage；补一条可读正文（重开历史也能看到）。
        if (
          isModelServiceUnavailable(error) &&
          !assistant.parts.some((part) => part.type === "text" && Boolean(part.text?.trim()))
        ) {
          assistant.parts.push({
            type: "text",
            text: modelUnavailableNotice(),
            state: "done",
          });
        }
      }
      const summary = parseSummaryEntryData((raw as { __agentUpSummary?: unknown }).__agentUpSummary);
      const artifacts = parseArtifactsEntryData(
        (raw as { __agentUpArtifacts?: unknown }).__agentUpArtifacts,
      );
      if (summary || artifacts) {
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
          custom: {
            ...prevCustom,
            ...(summary ? { agentUpSummary: clampSummaryIndex(summary, message.content) } : {}),
            ...(artifacts ? { agentUpArtifacts: artifacts } : {}),
          },
        };
      }
      return;
    }
    if (message.role === "toolResult") {
      const record = raw as { toolCallId?: unknown; isError?: unknown };
      const tool = typeof record.toolCallId === "string" ? tools.get(record.toolCallId) : undefined;
      if (!tool) return;
      const output = userText(message.content);
      const next: DynamicToolUIPart =
        record.isError === true
          ? {
              type: "dynamic-tool",
              toolCallId: tool.toolCallId,
              toolName: tool.toolName,
              state: "output-error",
              input: tool.input ?? {},
              errorText: output || "工具调用失败",
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

/**
 * 把会话里「有 toolCall、无 toolResult」的悬空调用补成中断结果。
 * 进程退出后多数等待已无法继续；不愈合则下次 prompt 会卡在残缺工具链上。
 * `skipToolCallIds`：盘上仍可闭合的 HITL（审批 / ask_user），留给用户拍板（策略 A）。
 */
export function healInterruptedSessionTools(
  manager: SessionManager,
  options: { skipToolCallIds?: ReadonlySet<string> } = {},
): number {
  const skip = options.skipToolCallIds ?? new Set<string>();
  const pending = new Map<string, string>();
  for (const message of buildSessionContext(manager.getEntries()).messages) {
    if (!message || typeof message !== "object") continue;
    const record = message as {
      role?: unknown;
      content?: unknown;
      toolCallId?: unknown;
      toolName?: unknown;
    };
    if (record.role === "assistant" && Array.isArray(record.content)) {
      for (const part of record.content) {
        if (!part || typeof part !== "object") continue;
        const item = part as { type?: unknown; id?: unknown; name?: unknown };
        if (item.type === "toolCall" && typeof item.id === "string" && typeof item.name === "string") {
          pending.set(item.id, item.name);
        }
      }
    }
    if (record.role === "toolResult" && typeof record.toolCallId === "string") {
      pending.delete(record.toolCallId);
    }
  }
  const now = Date.now();
  let healed = 0;
  for (const [toolCallId, toolName] of pending) {
    if (skip.has(toolCallId)) continue;
    // 与 ask_user 一样软中断：不标 isError，避免模型把「应用退出」当成工具硬失败。
    manager.appendMessage({
      role: "toolResult",
      toolCallId,
      toolName,
      content: [
        {
          type: "text",
          text: toolName === "ask_user" ? INTERRUPTED_ASK_USER_RESULT : INTERRUPTED_TOOL_RESULT,
        },
      ],
      isError: false,
      timestamp: now + healed,
    } as never);
    healed += 1;
  }
  return healed;
}

/** 投影层兜底：仍停在 input-available 的工具视为中断（未愈合的会话 / 单测直接调 projectHistory）。 */
export function settleInterruptedToolParts(messages: UIMessage[]): void {
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    message.parts = message.parts.map((part) => {
      if (part.type !== "dynamic-tool" || part.state !== "input-available") return part;
      return {
        type: "dynamic-tool" as const,
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        state: "output-available" as const,
        input: part.input ?? {},
        output: part.toolName === "ask_user" ? INTERRUPTED_ASK_USER_RESULT : INTERRUPTED_TOOL_RESULT,
      };
    });
  }
}

export function contextResetMessage(id: string): UIMessage {
  return {
    id: `context-reset-${id}`,
    role: "system",
    parts: [{ type: "text", text: CONTEXT_RESET_TEXT }],
    metadata: { custom: { agentUpKind: "context-reset" } },
  };
}

/** Pi 消息 timestamp（毫秒）→ UIMessage metadata，供桌面时间分隔使用。 */
/** 摘要序数按「本条 assistant」计。跨过 async_wake 的旧序号会越界，收到本条最后一段。 */
function clampSummaryIndex(
  summary: { textPartIndex: number },
  content: unknown,
): { textPartIndex: number } {
  let count = 0;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const item = part as { type?: unknown; text?: unknown };
      if (item.type === "text" && typeof item.text === "string" && item.text) count += 1;
    }
  }
  if (count <= 0 || summary.textPartIndex < count) return summary;
  return { textPartIndex: count - 1 };
}

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

function visitSession(
  userDataRoot: string,
  userId: string,
  agentId: string,
): { cwd: string; sessionDir: string; visitRoot: string } {
  if (!userId || userId === "." || userId === ".." || /[/\\\u0000]/.test(userId)) throw new Error("请求无效");
  if (!agentId || agentId === "." || agentId === ".." || /[/\\\u0000]/.test(agentId)) throw new Error("请求无效");
  const visitRoot = path.join(userDataRoot, "users", userId, "agents", agentId);
  return { cwd: path.join(visitRoot, "cwd"), sessionDir: path.join(visitRoot, "sessions"), visitRoot };
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

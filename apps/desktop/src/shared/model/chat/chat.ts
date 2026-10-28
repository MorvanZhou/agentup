import type { DynamicToolUIPart, UIDataTypes, UIMessage, UIMessagePart, UITools } from "ai";

export type AgentUpApprovalData = {
  id: string;
  toolCallId: string;
  toolName: string;
  args: unknown;
  /** 委托子会话里发起审批的专家名。 */
  askedByName?: string;
  /** 发起审批的子 Agent，用来对上头像。 */
  askedByAgentId?: string;
  /** 该委托任务的 brief 摘要。 */
  taskLabel?: string;
  taskId?: string;
  /** 同一跟进会话里还排着的 HITL 条数。 */
  queueBehind?: number;
};

export type AgentUpAskUserOption = {
  title: string;
  description?: string;
};

export type AgentUpAskUserQuestion = {
  question: string;
  context?: string;
  options: AgentUpAskUserOption[];
  allowMultiple: boolean;
};

export type AgentUpAskUserData = {
  id: string;
  toolCallId: string;
  questions: AgentUpAskUserQuestion[];
  /** 委托子会话里提问的专家名。问题和选项仍是对方原文。 */
  askedByName?: string;
  askedByAgentId?: string;
  /** 该委托任务的 brief 摘要。 */
  taskLabel?: string;
  taskId?: string;
  /** 同一跟进会话里还排着的 HITL 条数。 */
  queueBehind?: number;
};

/** 阻塞 shell 过久：询问是否终止当前命令。 */
export type AgentUpShellHangData = {
  id: string;
  toolCallId: string;
  toolName: string;
  command: string;
  elapsedMs: number;
  askedByName?: string;
  askedByAgentId?: string;
  taskLabel?: string;
  taskId?: string;
  queueBehind?: number;
};

export type ShellHangAction = "kill" | "wait" | "bg";

/** 委托子任务已启动（transient；过程走旁路 stream，不进父消息）。 */
export type AgentUpDelegationStartedData = {
  taskId: string;
  toolCallId?: string;
  toAgentId: string;
  toAgentName: string;
  brief: string;
  wait: boolean;
};

/** 当前会话模型服务不可用（transient；桌面 toast）。 */
export type AgentUpModelUnavailableData = {
  message: string;
};

/** 单题答案；整批取消用 cancelled。 */
export type AskUserItemAnswer =
  | { kind: "selection"; selections: string[] }
  | { kind: "freeform"; text: string }
  | { kind: "skipped" };

/** 用户对 ask_user 的回答。 */
export type AskUserAnswer =
  | { kind: "cancelled" }
  | { kind: "answers"; items: AskUserItemAnswer[] };

/** 命令工具审批范围：一次性 / 当前对话 / 当前 Agent（不受新对话影响）。 */
export type ApprovalScope = "once" | "session" | "agent";

export const CONTEXT_RESET_TEXT = "已开始新对话，之后不再带入此前上下文";

export function isContextResetMessage(message: {
  role: string;
  id?: string;
  metadata?: unknown;
}): boolean {
  if (message.role !== "system") return false;
  if (typeof message.id === "string" && message.id.startsWith("context-reset-")) return true;
  if (!message.metadata || typeof message.metadata !== "object") return false;
  const meta = message.metadata as { agentUpKind?: unknown; custom?: { agentUpKind?: unknown } };
  return meta.agentUpKind === "context-reset" || meta.custom?.agentUpKind === "context-reset";
}

export function parseHistory(value: unknown): UIMessage[] {
  if (!Array.isArray(value)) throw new Error("聊天记录无效");
  return value.map((item) => parseMessage(item));
}

function parseMessage(value: unknown): UIMessage {
  if (typeof value !== "object" || value === null) throw new Error("聊天记录无效");
  const message = value as Record<string, unknown>;
  if (typeof message.id !== "string" || (message.role !== "user" && message.role !== "assistant" && message.role !== "system")) {
    throw new Error("聊天记录无效");
  }
  if (!Array.isArray(message.parts)) throw new Error("聊天记录无效");
  return {
    id: message.id,
    role: message.role,
    parts: message.parts.map(parsePart),
    ...(message.metadata !== undefined ? { metadata: message.metadata } : {}),
  };
}

function parsePart(value: unknown): UIMessagePart<UIDataTypes, UITools> {
  if (typeof value !== "object" || value === null) throw new Error("聊天记录无效");
  const part = value as Record<string, unknown>;
  if (part.type === "text" && typeof part.text === "string") {
    return {
      type: "text",
      text: part.text,
      ...(typeof part.id === "string" && part.id ? { id: part.id } : {}),
      ...(part.state === "streaming" || part.state === "done" ? { state: part.state } : {}),
    };
  }
  if (part.type === "reasoning" && typeof part.text === "string") {
    return { type: "reasoning", text: part.text, ...(part.state === "streaming" || part.state === "done" ? { state: part.state } : {}) };
  }
  if (part.type === "file" && typeof part.mediaType === "string" && typeof part.url === "string") {
    return {
      type: "file",
      mediaType: part.mediaType,
      url: part.url,
      ...(typeof part.filename === "string" ? { filename: part.filename } : {}),
    };
  }
  if (part.type === "dynamic-tool") return parseDynamicTool(part);
  if (part.type === "step-start") return { type: "step-start" };
  throw new Error("聊天记录无效");
}

function parseDynamicTool(part: Record<string, unknown>): DynamicToolUIPart {
  if (typeof part.toolCallId !== "string" || typeof part.toolName !== "string" || typeof part.state !== "string") {
    throw new Error("聊天记录无效");
  }
  const base = { type: "dynamic-tool" as const, toolCallId: part.toolCallId, toolName: part.toolName };
  if (part.state === "input-streaming") {
    return { ...base, state: "input-streaming", input: part.input };
  }
  if (part.state === "input-available") {
    return { ...base, state: "input-available", input: part.input ?? {} };
  }
  if (part.state === "output-available") {
    return { ...base, state: "output-available", input: part.input ?? {}, output: part.output };
  }
  if (part.state === "output-error") {
    return {
      ...base,
      state: "output-error",
      input: part.input ?? {},
      errorText: typeof part.errorText === "string" ? part.errorText : "工具调用失败",
    };
  }
  throw new Error("聊天记录无效");
}

export type PromptFileAttachment = {
  name: string;
  mediaType: string;
  dataBase64: string;
};

/** 最近一条 user：正文 + file parts（assistant-ui 附件最终落成 AI SDK file）。 */
export function lastUserPrompt(messages: UIMessage[]): {
  text: string;
  attachments: PromptFileAttachment[];
} {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    const text = message.parts
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("")
      .trim();
    // 仅图片走 attachments → prompt.images；非图片已在正文 @ATTACHMENTS/... 落盘。
    const attachments = message.parts.flatMap((part) => {
      if (!part || typeof part !== "object" || (part as { type?: unknown }).type !== "file") return [];
      const file = part as {
        type: "file";
        mediaType?: string;
        mimeType?: string;
        url?: string;
        data?: string;
        filename?: string;
      };
      const mediaType = file.mediaType || file.mimeType;
      if (!mediaType?.startsWith("image/")) return [];
      const raw = file.url || file.data;
      if (!raw) return [];
      const dataBase64 = dataUrlToBase64(raw);
      if (!dataBase64) return [];
      return [
        {
          name: typeof file.filename === "string" && file.filename.trim() ? file.filename.trim() : "file",
          mediaType,
          dataBase64,
        },
      ];
    });
    if (text || attachments.length > 0) return { text, attachments };
  }
  return { text: "", attachments: [] };
}

export function lastUserText(messages: UIMessage[]): string {
  return lastUserPrompt(messages).text;
}

function dataUrlToBase64(url: string): string | undefined {
  const trimmed = url.trim();
  const match = /^data:[^;]+;base64,(.+)$/s.exec(trimmed);
  if (match?.[1]) return match[1].replace(/\s+/g, "");
  // 已是裸 base64 时也接受（部分适配器路径）
  if (/^[A-Za-z0-9+/=\s]+$/.test(trimmed) && trimmed.length > 32) return trimmed.replace(/\s+/g, "");
  return undefined;
}

/**
 * 最近一次「新对话」标记之后的 user 条数减一：编辑重发时的分支下标。
 * 无 user 时返回 -1。
 */
export function userTurnOrdinalAfterReset(messages: readonly UIMessage[]): number {
  let count = 0;
  for (const message of messages) {
    if (isContextResetMessage(message)) {
      count = 0;
      continue;
    }
    if (message.role === "user") count += 1;
  }
  return count - 1;
}

/** 从消息 metadata 读 Pi entry id（历史加载时写入）。 */
export function agentUpEntryId(message: UIMessage | undefined): string | undefined {
  if (!message?.metadata || typeof message.metadata !== "object") return undefined;
  const meta = message.metadata as { agentUpEntryId?: unknown; custom?: { agentUpEntryId?: unknown } };
  if (typeof meta.agentUpEntryId === "string" && meta.agentUpEntryId) return meta.agentUpEntryId;
  if (typeof meta.custom?.agentUpEntryId === "string" && meta.custom.agentUpEntryId) {
    return meta.custom.agentUpEntryId;
  }
  return undefined;
}

/** 读 metadata.custom.agentUpSummary（与气泡总结 tab 同源）。 */
function readAgentUpSummaryRef(
  metadata: unknown,
): { textPartIndex: number; textPartId?: string } | null {
  if (!metadata || typeof metadata !== "object") return null;
  const custom = (metadata as { custom?: unknown }).custom;
  const raw =
    custom && typeof custom === "object"
      ? (custom as { agentUpSummary?: unknown }).agentUpSummary
      : (metadata as { agentUpSummary?: unknown }).agentUpSummary;
  if (!raw || typeof raw !== "object") return null;
  const index = (raw as { textPartIndex?: unknown }).textPartIndex;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0) return null;
  const textPartId = (raw as { textPartId?: unknown }).textPartId;
  return {
    textPartIndex: index,
    ...(typeof textPartId === "string" && textPartId ? { textPartId } : {}),
  };
}

function normalizePreviewLine(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/** 单条消息预览：有 agentUpSummary 时只用总结段，否则拼全部正文。 */
function messagePreviewText(message: UIMessage): string {
  const summary = readAgentUpSummaryRef(message.metadata);
  if (summary) {
    const parts = message.parts;
    if (summary.textPartId) {
      const byId = parts.find(
        (part) => part.type === "text" && "id" in part && part.id === summary.textPartId,
      );
      if (byId && byId.type === "text") {
        const line = normalizePreviewLine(byId.text);
        if (line) return line;
      }
    }
    const textIndices: number[] = [];
    parts.forEach((part, index) => {
      if (part.type === "text" && part.text) textIndices.push(index);
    });
    const absolute = textIndices[summary.textPartIndex];
    if (absolute !== undefined) {
      const part = parts[absolute];
      if (part?.type === "text") {
        const line = normalizePreviewLine(part.text);
        if (line) return line;
      }
    }
  }
  return normalizePreviewLine(
    message.parts.map((part) => (part.type === "text" ? part.text : "")).join(""),
  );
}

/** 侧栏预览：末条有正文的消息；优先用总结 tab 对应段落。 */
export function lastMessagePreview(messages: UIMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || isContextResetMessage(message)) continue;
    const text = messagePreviewText(message);
    if (text) return text;
  }
  return "";
}

export function isAgentUpApproval(data: unknown): data is AgentUpApprovalData {
  if (typeof data !== "object" || data === null) return false;
  const record = data as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.toolCallId === "string" &&
    typeof record.toolName === "string"
  );
}

export function isAgentUpShellHang(data: unknown): data is AgentUpShellHangData {
  if (typeof data !== "object" || data === null) return false;
  const record = data as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.toolCallId === "string" &&
    typeof record.toolName === "string" &&
    typeof record.command === "string" &&
    typeof record.elapsedMs === "number"
  );
}

export function isAgentUpAskUser(data: unknown): data is AgentUpAskUserData {
  if (typeof data !== "object" || data === null) return false;
  const record = data as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.toolCallId !== "string" ||
    !Array.isArray(record.questions) ||
    record.questions.length === 0
  ) {
    return false;
  }
  return record.questions.every((question) => {
    if (typeof question !== "object" || question === null) return false;
    const item = question as Record<string, unknown>;
    if (
      typeof item.question !== "string" ||
      typeof item.allowMultiple !== "boolean" ||
      !Array.isArray(item.options) ||
      item.options.length === 0
    ) {
      return false;
    }
    return item.options.every((option) => {
      if (typeof option !== "object" || option === null) return false;
      const opt = option as Record<string, unknown>;
      return (
        typeof opt.title === "string" &&
        (opt.description === undefined || typeof opt.description === "string")
      );
    });
  });
}

export function isAgentUpDelegationStarted(
  data: unknown,
): data is AgentUpDelegationStartedData {
  if (typeof data !== "object" || data === null) return false;
  const record = data as Record<string, unknown>;
  return (
    typeof record.taskId === "string" &&
    record.taskId.trim().length > 0 &&
    typeof record.toAgentId === "string" &&
    typeof record.toAgentName === "string" &&
    typeof record.brief === "string" &&
    typeof record.wait === "boolean" &&
    (record.toolCallId === undefined || typeof record.toolCallId === "string")
  );
}

export function isAgentUpModelUnavailable(
  data: unknown,
): data is AgentUpModelUnavailableData {
  if (typeof data !== "object" || data === null) return false;
  const record = data as Record<string, unknown>;
  return typeof record.message === "string" && record.message.trim().length > 0;
}

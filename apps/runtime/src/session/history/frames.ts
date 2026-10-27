import { randomUUID } from "node:crypto";

import type { AgentSessionEvent, SessionEntry } from "@earendil-works/pi-coding-agent";
import type { UIMessageChunk } from "ai";

import { sanitizeStreamText } from "../stream-guard.js";
import { projectToolOutput, projectToolText } from "./tool-output.js";
import {
  AGENTUP_ARTIFACTS_CUSTOM_TYPE,
  parseArtifactsEntryData,
  type AgentUpArtifactsData,
} from "./artifacts.js";
import {
  AGENTUP_SUMMARY_CUSTOM_TYPE,
  parseSummaryEntryData,
  type AgentUpSummaryRef,
} from "./summary.js";

export type AgentUpApprovalData = {
  id: string;
  toolCallId: string;
  toolName: string;
  args: unknown;
};

export type AgentUpAskUserQuestion = {
  question: string;
  context?: string;
  options: { title: string; description?: string }[];
  allowMultiple: boolean;
};

export type AgentUpAskUserData = {
  id: string;
  toolCallId: string;
  questions: AgentUpAskUserQuestion[];
};

export type AgentUpShellHangData = {
  id: string;
  toolCallId: string;
  toolName: string;
  command: string;
  elapsedMs: number;
  askedByName?: string;
  taskLabel?: string;
};

/** 把 Pi 会话事件投影成 AI SDK UIMessageStream chunks。 */
export class PiUIMessageProjector {
  private messageId = "";
  private textId = "";
  private reasoningId = "";
  private textOpen = false;
  private reasoningOpen = false;
  private started = false;
  /** 当前未关闭 text 段已累计长度；关闭时 >0 才记入主产物序数。 */
  private openTextLength = 0;
  /** 与历史投影一致：非空 text part 的流式 id，按下标对应 textPartIndex。 */
  private readonly textPartIds: string[] = [];
  /** 已向流写出过 agentUpSummary，避免 entry 与 finish 重复。 */
  private summaryEmitted = false;
  private readonly toolNames = new Map<string, string>();
  /** 已发出 tool-input-start（参数仍在流式生成）。 */
  private readonly startedTools = new Set<string>();
  /** 已发出 tool-input-available（参数齐备，可执行 / 等待用户）。 */
  private readonly announcedTools = new Set<string>();
  /** OpenAI 等场景：id 尚未到齐时，按 contentIndex 暂存参数 delta。 */
  private readonly pendingDeltas = new Map<number, string>();

  project(event: AgentSessionEvent): UIMessageChunk[] {
    if (event.type === "entry_appended") {
      return [...this.summaryFromEntry(event.entry), ...this.artifactsFromEntry(event.entry)];
    }
    if (event.type === "message_start" && event.message.role === "assistant") {
      return this.ensureMessage();
    }
    if (event.type === "message_update") {
      const update = event.assistantMessageEvent;
      if (update.type === "thinking_delta") return this.reasoningDelta(update.delta);
      if (update.type === "text_delta") return this.textDelta(update.delta);
      if (update.type === "toolcall_start") {
        const tool = toolCallFromPartial(update.contentIndex, update.partial);
        // id/name 未齐时也先关掉 text/reasoning，避免 UI 以为还在打字、不出「正在计划…」
        if (!tool) return [...this.closeOpenParts(), ...this.ensureMessage()];
        return this.toolInputStart(tool);
      }
      if (update.type === "toolcall_delta") {
        return this.toolInputDeltaFromUpdate(update.contentIndex, update.delta, update.partial);
      }
      if (update.type === "toolcall_end") {
        const toolCall = update.toolCall;
        this.pendingDeltas.delete(update.contentIndex);
        return this.toolInputAvailable(
          typeof toolCall?.id === "string" ? toolCall.id : undefined,
          typeof toolCall?.name === "string" ? toolCall.name : undefined,
          toolCall?.arguments ?? {},
        );
      }
      return [];
    }
    if (event.type === "tool_execution_start") {
      return this.toolInputAvailable(event.toolCallId, event.toolName, event.args);
    }
    if (event.type === "tool_execution_update") {
      return this.toolOutputPreliminary(event.toolCallId, event.toolName, event.args, event.partialResult);
    }
    if (event.type === "tool_execution_end") {
      return this.toolOutputFinal(event.toolCallId, event.toolName, event.result, event.isError);
    }
    return [];
  }

  approval(request: AgentUpApprovalData): UIMessageChunk[] {
    return [
      ...this.toolInputAvailable(request.toolCallId, request.toolName, request.args),
      {
        type: "data-agentup-approval",
        data: request,
        transient: true,
      } as UIMessageChunk,
    ];
  }

  askUser(request: AgentUpAskUserData): UIMessageChunk[] {
    return [
      ...this.toolInputAvailable(request.toolCallId, "ask_user", { questions: request.questions }),
      {
        type: "data-agentup-ask-user",
        data: request,
        transient: true,
      } as UIMessageChunk,
    ];
  }

  shellHang(request: AgentUpShellHangData): UIMessageChunk[] {
    return [
      {
        type: "data-agentup-shell-hang",
        data: request,
        transient: true,
      } as UIMessageChunk,
    ];
  }

  /**
   * 委托子任务已启动：仅 transient 元数据（taskId 等），过程本身走旁路 stream，不进父消息 parts。
   */
  delegationStarted(data: {
    taskId: string;
    toolCallId?: string;
    toAgentId: string;
    toAgentName: string;
    brief: string;
    wait: boolean;
  }): UIMessageChunk[] {
    return [
      {
        type: "data-agentup-delegation-started",
        data,
        transient: true,
      } as UIMessageChunk,
    ];
  }

  /**
   * 模型服务不可用：写入助手正文 + transient，供桌面 toast；不标 incomplete/error，避免与正文重复。
   */
  modelUnavailable(notice: string): UIMessageChunk[] {
    return [
      ...this.textDelta(notice),
      {
        type: "data-agentup-model-unavailable",
        data: { message: notice },
        transient: true,
      } as UIMessageChunk,
    ];
  }

  finish(errorText?: string): UIMessageChunk[] {
    const chunks: UIMessageChunk[] = [...this.closeOpenParts()];
    // extension 的 entry_appended 可能早于/晚于消费者订阅窗口；finish 再兜底一次主产物引用
    chunks.push(...this.emitSummaryFromTextParts());
    if (errorText) chunks.push({ type: "error", errorText });
    if (this.started) {
      chunks.push({ type: "finish-step" }, { type: "finish" });
    } else if (errorText) {
      chunks.push(...this.ensureMessage(), { type: "finish-step" }, { type: "finish" });
    }
    return chunks;
  }

  private ensureMessage(): UIMessageChunk[] {
    if (this.started) return [];
    this.started = true;
    this.messageId = `assistant-${randomUUID()}`;
    return [
      {
        type: "start",
        messageId: this.messageId,
        messageMetadata: { custom: { agentUpCreatedAt: new Date().toISOString() } },
      },
      { type: "start-step" },
    ];
  }

  private reasoningDelta(delta: string): UIMessageChunk[] {
    const visible = stripSpecialForDisplay(delta);
    if (!visible) return [];
    const chunks: UIMessageChunk[] = [...this.ensureMessage()];
    if (this.textOpen) chunks.push(...this.closeText());
    if (!this.reasoningOpen) {
      this.reasoningId = `reasoning-${randomUUID()}`;
      this.reasoningOpen = true;
      chunks.push({ type: "reasoning-start", id: this.reasoningId });
    }
    chunks.push({ type: "reasoning-delta", id: this.reasoningId, delta: visible });
    return chunks;
  }

  private textDelta(delta: string): UIMessageChunk[] {
    const visible = stripSpecialForDisplay(delta);
    if (!visible) return [];
    const chunks: UIMessageChunk[] = [...this.ensureMessage()];
    if (this.reasoningOpen) chunks.push(...this.closeReasoning());
    if (!this.textOpen) {
      this.textId = `text-${randomUUID()}`;
      this.textOpen = true;
      this.openTextLength = 0;
      chunks.push({ type: "text-start", id: this.textId });
    }
    this.openTextLength += visible.length;
    chunks.push({ type: "text-delta", id: this.textId, delta: visible });
    return chunks;
  }

  private summaryFromEntry(entry: SessionEntry): UIMessageChunk[] {
    if (entry.type !== "custom" || entry.customType !== AGENTUP_SUMMARY_CUSTOM_TYPE) return [];
    const parsed = parseSummaryEntryData(entry.data);
    if (!parsed || !this.started) return [];
    return this.emitSummaryRef({
      textPartIndex: parsed.textPartIndex,
      textPartId: this.resolvedTextPartIds()[parsed.textPartIndex],
    });
  }

  private artifactsFromEntry(entry: SessionEntry): UIMessageChunk[] {
    if (entry.type !== "custom" || entry.customType !== AGENTUP_ARTIFACTS_CUSTOM_TYPE) return [];
    const parsed = parseArtifactsEntryData(entry.data);
    if (!parsed || !this.started) return [];
    return this.emitArtifacts(parsed);
  }

  private emitArtifacts(artifacts: AgentUpArtifactsData): UIMessageChunk[] {
    return [
      {
        type: "message-metadata",
        messageMetadata: { custom: { agentUpArtifacts: artifacts } },
      },
    ];
  }

  private emitSummaryFromTextParts(): UIMessageChunk[] {
    if (!this.started || this.summaryEmitted) return [];
    const ids = this.resolvedTextPartIds();
    if (ids.length === 0) return [];
    const textPartIndex = ids.length - 1;
    return this.emitSummaryRef({
      textPartIndex,
      textPartId: ids[textPartIndex],
    });
  }

  private resolvedTextPartIds(): string[] {
    // agent_settled 可能早于 finish()：最后一段 text 仍 open，一并计入序数
    const ids = [...this.textPartIds];
    if (this.textOpen && this.openTextLength > 0 && this.textId) {
      ids.push(this.textId);
    }
    return ids;
  }

  private emitSummaryRef(summary: AgentUpSummaryRef): UIMessageChunk[] {
    if (this.summaryEmitted) return [];
    this.summaryEmitted = true;
    const payload: AgentUpSummaryRef = {
      textPartIndex: summary.textPartIndex,
      ...(summary.textPartId ? { textPartId: summary.textPartId } : {}),
    };
    return [
      {
        type: "message-metadata",
        messageMetadata: { custom: { agentUpSummary: payload } },
      },
    ];
  }

  private toolInputStart(tool: { id: string; name: string } | undefined): UIMessageChunk[] {
    if (!tool || this.startedTools.has(tool.id) || this.announcedTools.has(tool.id)) return [];
    this.startedTools.add(tool.id);
    this.toolNames.set(tool.id, tool.name);
    return [
      ...this.closeOpenParts(),
      ...this.ensureMessage(),
      {
        type: "tool-input-start",
        toolCallId: tool.id,
        toolName: tool.name,
        dynamic: true,
      },
    ];
  }

  /**
   * 参数流式 delta。OpenAI 等可能在 start 时还没有 id：
   * 先按 contentIndex 暂存，等 partial 里 id/name 齐后再补发 start + 缓冲。
   */
  private toolInputDeltaFromUpdate(
    contentIndex: number,
    delta: string,
    partial: { content?: unknown } | undefined,
  ): UIMessageChunk[] {
    const tool = toolCallFromPartial(contentIndex, partial);
    if (!tool) {
      if (delta) {
        this.pendingDeltas.set(contentIndex, `${this.pendingDeltas.get(contentIndex) ?? ""}${delta}`);
      }
      // 参数在流、工具卡还不能建：仍结束上一文本段，让桌面进入步骤间隙态
      return [...this.closeOpenParts(), ...this.ensureMessage()];
    }
    const chunks: UIMessageChunk[] = [];
    if (!this.startedTools.has(tool.id) && !this.announcedTools.has(tool.id)) {
      chunks.push(...this.toolInputStart(tool));
      const buffered = this.pendingDeltas.get(contentIndex);
      if (buffered) {
        this.pendingDeltas.delete(contentIndex);
        chunks.push(...this.toolInputDelta(tool.id, buffered));
      }
    } else {
      this.pendingDeltas.delete(contentIndex);
    }
    if (delta) chunks.push(...this.toolInputDelta(tool.id, delta));
    return chunks;
  }

  private toolInputDelta(toolCallId: string, delta: string): UIMessageChunk[] {
    if (!delta || !this.startedTools.has(toolCallId) || this.announcedTools.has(toolCallId)) {
      return [];
    }
    return [{ type: "tool-input-delta", toolCallId, inputTextDelta: delta }];
  }

  private toolInputAvailable(
    toolCallId: string | undefined,
    toolName: string | undefined,
    input: unknown,
  ): UIMessageChunk[] {
    if (!toolCallId || this.announcedTools.has(toolCallId)) return [];
    const name = toolName || this.toolNames.get(toolCallId);
    if (!name) return [];
    this.announcedTools.add(toolCallId);
    this.startedTools.add(toolCallId);
    this.toolNames.set(toolCallId, name);
    return [
      ...this.closeOpenParts(),
      ...this.ensureMessage(),
      {
        type: "tool-input-available",
        toolCallId,
        toolName: name,
        input,
        dynamic: true,
      },
    ];
  }

  private toolOutputPreliminary(
    toolCallId: string,
    toolName: string,
    args: unknown,
    partialResult: unknown,
  ): UIMessageChunk[] {
    return [
      ...this.toolInputAvailable(toolCallId, toolName, args),
      {
        type: "tool-output-available",
        toolCallId,
        output: projectToolText(partialResult),
        dynamic: true,
        preliminary: true,
      },
    ];
  }

  private toolOutputFinal(
    toolCallId: string,
    toolName: string,
    result: unknown,
    isError: boolean,
  ): UIMessageChunk[] {
    const name = this.toolNames.get(toolCallId) ?? toolName;
    this.toolNames.set(toolCallId, name);
    if (isError) {
      return [
        {
          type: "tool-output-error",
          toolCallId,
          errorText: projectToolText(result) || "工具调用失败",
          dynamic: true,
        },
      ];
    }
    return [
      {
        type: "tool-output-available",
        toolCallId,
        output: projectToolOutput(result),
        dynamic: true,
      },
    ];
  }

  private closeOpenParts(): UIMessageChunk[] {
    return [...this.closeReasoning(), ...this.closeText()];
  }

  private closeReasoning(): UIMessageChunk[] {
    if (!this.reasoningOpen) return [];
    this.reasoningOpen = false;
    return [{ type: "reasoning-end", id: this.reasoningId }];
  }

  private closeText(): UIMessageChunk[] {
    if (!this.textOpen) return [];
    this.textOpen = false;
    if (this.openTextLength > 0 && this.textId) {
      this.textPartIds.push(this.textId);
    }
    this.openTextLength = 0;
    return [{ type: "text-end", id: this.textId }];
  }
}

function toolCallFromPartial(
  contentIndex: number,
  partial: { content?: unknown } | undefined,
): { id: string; name: string } | undefined {
  if (!partial || !Array.isArray(partial.content)) return undefined;
  const item = partial.content[contentIndex];
  if (!item || typeof item !== "object") return undefined;
  const record = item as { type?: unknown; id?: unknown; name?: unknown };
  if (record.type !== "toolCall" || typeof record.id !== "string" || typeof record.name !== "string") {
    return undefined;
  }
  if (!record.id || !record.name) return undefined;
  return { id: record.id, name: record.name };
}

/** 投影层：去掉完整 special；半截前缀暂保留，避免误吞代码里的 `<|`。 */
function stripSpecialForDisplay(delta: string): string {
  if (!delta) return "";
  const { text, pending } = sanitizeStreamText(delta);
  return text + pending;
}

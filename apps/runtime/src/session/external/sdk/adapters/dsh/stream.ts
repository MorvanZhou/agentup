import type { WorkerResult } from "../../contract.js";
import { resultFromSdkMessage } from "../../host/result.js";
import {
  formatAskUserResultText,
  type AskUserAnswer,
  type AskUserItemAnswer,
  type AskUserQuestion,
} from "../../../../tools/ask-user.js";
import type { DshHarnessNotification, DshRunResult } from "./load.js";

/**
 * 把 DeepSeek Harness 通知转成 Host 鸭子消息：
 * - session.event assistant/message → 文本
 * - tool/call → tool_use（空参延迟 announce）
 * - tool/result → tool_result
 * 绝不合成 toolcall_*。
 */

type PendingTool = {
  id: string;
  name: string;
  args: Record<string, unknown>;
  announced: boolean;
};

export async function* mirrorDshRun(
  run: Promise<DshRunResult>,
  onAttach: (push: (notification: DshHarnessNotification) => void) => void,
): AsyncGenerator<unknown, void, undefined> {
  const queue: unknown[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  let sawTerminal = false;
  const pendingTools = new Map<string, PendingTool>();
  let sessionId: string | undefined;

  const push = (message: unknown) => {
    queue.push(message);
    wake?.();
  };

  onAttach((notification) => {
    for (const message of projectDshNotification(notification, pendingTools)) {
      push(message);
    }
  });

  yield {
    type: "system",
    subtype: "init",
    session_id: sessionId,
  };

  void run
    .then((result) => {
      sessionId = result.sessionId;
      sawTerminal = true;
      push(resultMessageOf(result));
    })
    .catch((error) => {
      sawTerminal = true;
      const aborted =
        error instanceof Error &&
        (error.name === "AbortError" || /abort/i.test(error.message));
      push(
        resultMessageOf({
          sessionId: sessionId ?? "",
          finalResponse: "",
          finishReason: aborted ? "aborted" : "error",
          errorMessage: error instanceof Error ? error.message : String(error),
        }),
      );
    })
    .finally(() => {
      closed = true;
      if (!sawTerminal) {
        push(
          resultMessageOf({
            sessionId: sessionId ?? "",
            finalResponse: "",
            finishReason: "error",
            errorMessage: "stream ended without run result",
          }),
        );
      }
      wake?.();
    });

  while (!closed || queue.length > 0) {
    if (queue.length === 0) {
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
      wake = null;
      continue;
    }
    yield queue.shift();
  }
}

export function projectDshNotification(
  notification: DshHarnessNotification,
  pendingTools: Map<string, PendingTool>,
): unknown[] {
  if (!notification || typeof notification !== "object") return [];
  if (notification.method !== "session.event") return [];
  const event = notification.params?.event;
  if (!event || typeof event !== "object" || Array.isArray(event)) return [];
  const row = event as Record<string, unknown>;
  const type = typeof row.type === "string" ? row.type : "";
  const data =
    row.data && typeof row.data === "object" && !Array.isArray(row.data)
      ? (row.data as Record<string, unknown>)
      : row;

  if (type === "assistant/message") {
    const text = assistantTextOf(data);
    if (!text) return [];
    return [
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text }],
        },
      },
    ];
  }

  if (type === "tool/call") {
    return projectToolCall(data, pendingTools);
  }
  if (type === "tool/result") {
    return projectToolResult(data, pendingTools);
  }
  return [];
}

function projectToolCall(
  data: Record<string, unknown>,
  pendingTools: Map<string, PendingTool>,
): unknown[] {
  const id = toolIdOf(data);
  if (!id) return [];
  const rawName =
    typeof data.name === "string"
      ? data.name
      : typeof data.toolName === "string"
        ? data.toolName
        : "tool";
  const args = argsOf(data);
  const projected = unwrapDshMcpTool(rawName, args);
  const pending: PendingTool = {
    id,
    name: projected.name,
    args: projected.args,
    announced: false,
  };
  pendingTools.set(id, pending);
  if (!hasMeaningfulArgs(pending.args)) return [];
  pending.announced = true;
  return [toolUseMessage(pending)];
}

function projectToolResult(
  data: Record<string, unknown>,
  pendingTools: Map<string, PendingTool>,
): unknown[] {
  const id = toolIdOf(data) || toolIdFromMessage(data.message);
  if (!id) return [];
  const pending = pendingTools.get(id);
  const out: unknown[] = [];
  if (pending && !pending.announced) {
    // terminal 时参仍空也 announce，避免协助卡悬挂
    const lateArgs = argsOf(data);
    if (hasMeaningfulArgs(lateArgs)) pending.args = lateArgs;
    const projected = unwrapDshMcpTool(pending.name, pending.args);
    pending.name = projected.name;
    pending.args = projected.args;
    pending.announced = true;
    out.push(toolUseMessage(pending));
  }
  const name = pending?.name ?? "tool";
  const rawContent = toolResultTextOf(data);
  // AskUser：厂商 JSON 改写成 Host `User answered:`，桌面摘要才不会标「已跳过」
  const content =
    name === "ask_user"
      ? rewriteAskUserResultText(pending?.args ?? {}, rawContent)
      : rawContent;
  out.push({
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: id,
          content,
        },
      ],
    },
    // 给 projector 的工具名提示（AskUser / MCP 专用卡）
    toolName: name,
  });
  pendingTools.delete(id);
  return out;
}

/** dsh tool/result 常为 `{"answers":[...]}`；有题面时改写成 formatAskUserResultText。 */
export function rewriteAskUserResultText(
  args: Record<string, unknown>,
  content: string,
): string {
  if (/^User answered:/m.test(content) || /User dismissed the questions/i.test(content)) {
    return content;
  }
  const { questions, ids } = questionsFromAskUserArgs(args);
  const answer = hostAnswerFromDshToolResult(content, questions.length, ids);
  if (!questions.length || !answer) return content;
  return formatAskUserResultText(questions, answer);
}

function questionsFromAskUserArgs(args: Record<string, unknown>): {
  questions: AskUserQuestion[];
  ids: string[];
} {
  const raw = args.questions;
  if (!Array.isArray(raw)) return { questions: [], ids: [] };
  const questions: AskUserQuestion[] = [];
  const ids: string[] = [];
  for (const value of raw) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const row = value as Record<string, unknown>;
    const question =
      typeof row.question === "string"
        ? row.question.trim()
        : typeof row.prompt === "string"
          ? row.prompt.trim()
          : "";
    if (!question) continue;
    const options: AskUserQuestion["options"] = [];
    const rawOptions = row.options ?? row.choices;
    if (Array.isArray(rawOptions)) {
      for (const opt of rawOptions) {
        if (typeof opt === "string" && opt.trim()) {
          options.push({ title: opt.trim() });
          continue;
        }
        if (!opt || typeof opt !== "object" || Array.isArray(opt)) continue;
        const item = opt as Record<string, unknown>;
        const title =
          typeof item.label === "string"
            ? item.label.trim()
            : typeof item.title === "string"
              ? item.title.trim()
              : "";
        if (!title) continue;
        const description =
          typeof item.description === "string" ? item.description.trim() : undefined;
        options.push(description ? { title, description } : { title });
      }
    }
    if (options.length === 0) options.push({ title: "自由回答" });
    const context =
      typeof row.context === "string"
        ? row.context.trim()
        : typeof row.header === "string"
          ? row.header.trim()
          : undefined;
    questions.push({
      question,
      ...(context ? { context } : {}),
      options,
      allowMultiple: row.multiSelect === true || row.allowMultiple === true,
    });
    const id =
      typeof row.id === "string" && row.id.trim() ? row.id.trim() : `q${ids.length + 1}`;
    ids.push(id);
  }
  return { questions, ids };
}

function hostAnswerFromDshToolResult(
  content: string,
  questionCount: number,
  ids: string[],
): AskUserAnswer | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const row = parsed as Record<string, unknown>;
  if (row.cancelled === true) return { kind: "cancelled" };
  if (!Array.isArray(row.answers) || questionCount < 1) return null;

  const idToIndex = new Map(ids.map((id, index) => [id, index]));
  const items: AskUserItemAnswer[] = Array.from({ length: questionCount }, () => ({
    kind: "skipped" as const,
  }));
  row.answers.forEach((value, fallbackIndex) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const answer = value as Record<string, unknown>;
    const id = typeof answer.id === "string" ? answer.id.trim() : "";
    const index = (id && idToIndex.has(id) ? idToIndex.get(id) : undefined) ?? fallbackIndex;
    if (index == null || index < 0 || index >= items.length) return;
    const custom = typeof answer.custom === "string" ? answer.custom.trim() : "";
    if (custom) {
      items[index] = { kind: "freeform", text: custom };
      return;
    }
    const selected = Array.isArray(answer.selected)
      ? answer.selected
          .filter((part): part is string => typeof part === "string")
          .map((part) => part.trim())
          .filter(Boolean)
      : [];
    if (selected.length === 0) {
      items[index] = { kind: "skipped" };
      return;
    }
    items[index] = { kind: "selection", selections: selected };
  });
  return { kind: "answers", items };
}

/**
 * DSH MCP 工具名已是 mcp__<server>__<tool>；
 * 若落成裸名 agent_* 也归一成 mcp__agentup__*。
 */
export function unwrapDshMcpTool(
  rawName: string,
  args: Record<string, unknown>,
): { name: string; args: Record<string, unknown> } {
  if (rawName.startsWith("mcp__")) {
    return { name: rawName, args };
  }
  if (
    rawName === "ask_user_question" ||
    rawName === "AskUserQuestion" ||
    rawName === "ask_user"
  ) {
    return { name: "ask_user", args };
  }
  const agentup =
    /^(agent_search|delegate_to_agent|check_delegation|steer_|resolve_|cancel_|deliver_artifacts|complete_group_task)/.test(
      rawName,
    );
  if (agentup) {
    return { name: `mcp__agentup__${rawName}`, args };
  }
  return { name: rawName, args };
}

export function workerResultFromDshMessage(message: unknown): WorkerResult | null {
  return resultFromSdkMessage(message);
}

function resultMessageOf(result: {
  sessionId: string;
  finalResponse: string;
  finishReason: string | null;
  errorMessage?: string;
}): unknown {
  const finish = normalizeFinish(result.finishReason);
  return {
    type: "result",
    subtype: finish === "error" ? "error" : "success",
    result: result.finalResponse,
    session_id: result.sessionId || undefined,
    is_error: finish === "error" || finish === "aborted",
    ...(result.errorMessage ? { errors: [result.errorMessage] } : {}),
    // Host normalizeResult 认这些字段
    finishReason: finish,
  };
}

function normalizeFinish(
  reason: string | null,
): WorkerResult["finishReason"] {
  if (!reason) return "completed";
  const lower = reason.toLowerCase();
  if (lower.includes("abort") || lower.includes("cancel")) return "aborted";
  if (lower.includes("max") && lower.includes("token")) return "max_tokens";
  if (lower === "error" || lower.includes("fail")) return "error";
  if (lower === "completed" || lower === "end_turn" || lower === "stop") {
    return "completed";
  }
  return "completed";
}

function assistantTextOf(data: Record<string, unknown>): string {
  const message = data.message;
  if (typeof message === "string") return message;
  if (message && typeof message === "object" && !Array.isArray(message)) {
    const row = message as Record<string, unknown>;
    if (typeof row.content === "string") return row.content;
    if (Array.isArray(row.content)) return contentBlocksText(row.content);
    if (typeof row.text === "string") return row.text;
  }
  if (typeof data.content === "string") return data.content;
  if (typeof data.text === "string") return data.text;
  return "";
}

function contentBlocksText(blocks: unknown[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (!block || typeof block !== "object" || Array.isArray(block)) continue;
    const row = block as Record<string, unknown>;
    const type = typeof row.type === "string" ? row.type.toLowerCase() : "";
    // dsh 把 CoT 放在 type=reasoning；勿并进用户可见正文（真机曾整段泄漏）
    if (type === "reasoning" || type === "thinking") continue;
    if (type && type !== "text" && type !== "output_text") continue;
    if (typeof row.text === "string") parts.push(row.text);
    else if (typeof row.content === "string") parts.push(row.content);
  }
  return parts.join("");
}

function toolIdOf(data: Record<string, unknown>): string | null {
  for (const key of ["callId", "toolCallId", "tool_call_id", "id"]) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function toolIdFromMessage(message: unknown): string | null {
  if (!message || typeof message !== "object" || Array.isArray(message)) return null;
  return toolIdOf(message as Record<string, unknown>);
}

function argsOf(data: Record<string, unknown>): Record<string, unknown> {
  const raw = data.arguments ?? data.args ?? data.input;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return raw.trim() ? { raw } : {};
    }
    return {};
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

function hasMeaningfulArgs(args: Record<string, unknown>): boolean {
  return Object.keys(args).length > 0;
}

function toolUseMessage(pending: PendingTool): unknown {
  return {
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: pending.id,
          name: pending.name,
          input: pending.args,
        },
      ],
    },
  };
}

function toolResultTextOf(data: Record<string, unknown>): string {
  const message = data.message;
  if (typeof message === "string") return message;
  if (message && typeof message === "object" && !Array.isArray(message)) {
    const row = message as Record<string, unknown>;
    if (typeof row.content === "string") return row.content;
    if (Array.isArray(row.content)) return contentBlocksText(row.content);
    if (typeof row.text === "string") return row.text;
  }
  if (typeof data.content === "string") return data.content;
  if (typeof data.result === "string") return data.result;
  try {
    return JSON.stringify(data);
  } catch {
    return "";
  }
}

/** 从一条 assistant 消息里抽出「协助过的 Agent」展示信息。 */

export type AssistAgentStatus = "running" | "completed" | "failed";

export type AssistAgentRef = {
  agentId: string;
  /** 结果或参数里带出的展示名提示。 */
  nameHint: string;
  brief: string;
  reply: string;
  status: AssistAgentStatus;
  toolCallId: string;
  /** 结果正文或 started 事件里的委托任务 id。 */
  taskId: string;
};

type ToolLikePart = {
  type?: string;
  toolName?: string;
  toolCallId?: string;
  args?: unknown;
  input?: unknown;
  result?: unknown;
  output?: unknown;
  isError?: boolean;
  status?: { type?: string; reason?: string };
  state?: string;
};

/**
 * 凡出现过的 `delegate_to_agent` 都计入（进行中 / 成功 / 失败）。
 * 按 agentId 去重，保留首次出现；后续状态可升级（running→completed/failed）。
 */
export function extractAssistAgents(parts: readonly unknown[]): AssistAgentRef[] {
  const ordered: AssistAgentRef[] = [];
  const indexById = new Map<string, number>();

  for (const raw of parts) {
    const part = asDelegatePart(raw);
    if (!part) continue;

    const args = asRecord(part.args ?? part.input);
    const agentId =
      typeof args.agent_id === "string" ? args.agent_id.trim() : "";
    if (!agentId) continue;

    const brief = typeof args.brief === "string" ? args.brief.trim() : "";
    const resultText = toolResultText(part);
    const failed = isDelegateFailure(part, resultText);
    const running = !failed && isDelegateRunning(part, resultText);
    const completed =
      !failed && !running && Boolean(resultText) && isDelegateSuccess(resultText);
    if (!running && !completed && !failed) continue;

    const parsed = parseDelegationResultText(resultText);
    const status: AssistAgentStatus = failed
      ? "failed"
      : running
        ? "running"
        : "completed";
    const next: AssistAgentRef = {
      agentId,
      nameHint: parsed.agentName,
      brief,
      reply: failed
        ? resultText
        : completed
          ? parsed.body || resultText
          : "",
      status,
      toolCallId: part.toolCallId ?? "",
      taskId: parseDelegationTaskId(resultText),
    };

    const existing = indexById.get(agentId);
    if (existing === undefined) {
      indexById.set(agentId, ordered.length);
      ordered.push(next);
      continue;
    }
    const prev = ordered[existing]!;
    if (prev.status === "running" && next.status !== "running") {
      ordered[existing] = {
        ...next,
        brief: next.brief || prev.brief,
        taskId: next.taskId || prev.taskId,
      };
    }
  }

  return ordered;
}

function asDelegatePart(raw: unknown): ToolLikePart | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const part = raw as ToolLikePart;
  const toolName = part.toolName ?? "";
  if (toolName !== "delegate_to_agent") return undefined;
  if (part.type === "tool-call" || part.type === "dynamic-tool") return part;
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toolResultText(part: ToolLikePart): string {
  const value = part.result ?? part.output;
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return "";
}

function isDelegateRunning(part: ToolLikePart, resultText: string): boolean {
  if (resultText) return false;
  if (part.isError === true) return false;
  if (part.state === "output-error") return false;
  if (part.status?.type === "incomplete" && part.status.reason === "error") return false;
  // 无结果且未标错：进行中（含等待审批后刚执行）
  return true;
}

function isDelegateFailure(part: ToolLikePart, resultText: string): boolean {
  if (part.isError === true) return true;
  if (part.state === "output-error") return true;
  if (part.status?.type === "incomplete" && part.status.reason === "error") return true;
  if (!resultText) return false;
  if (/^Error:/m.test(resultText)) return true;
  if (/Delegation failed/i.test(resultText)) return true;
  return false;
}

function isDelegateSuccess(resultText: string): boolean {
  if (/Delegation completed/i.test(resultText)) return true;
  // 异步已获批启动：算已请到协助（结果另有会话通知）
  if (/Delegation started \(async\)/i.test(resultText)) return true;
  // 其它非失败正文视为成功（兼容旧格式）
  return !isDelegateFailure({}, resultText);
}

/** 从委托工具结果正文解析 task_id。 */
export function parseDelegationTaskId(raw: string): string {
  const text = raw?.trim() ?? "";
  if (!text) return "";
  const match = text.match(/(?:^|\n)task_id:\s*(\S+)/i);
  return match?.[1]?.trim() ?? "";
}

export function parseDelegationResultText(raw: string): {
  agentName: string;
  body: string;
} {
  const text = raw?.trim() ?? "";
  if (!text) return { agentName: "", body: "" };

  let agentName = "";
  const agentLine = text.match(/^agent:\s*(.+)$/m);
  if (agentLine?.[1]) {
    const label = agentLine[1].trim();
    const named = label.match(/^(.*?)\s*\([^)]+\)\s*$/);
    agentName = (named?.[1] ?? label).trim();
  }

  const resultMarker = text.match(/(?:^|\n)result:\s*\n([\s\S]*)$/i);
  if (resultMarker?.[1]?.trim()) {
    return { agentName, body: resultMarker[1].trim() };
  }
  const partialMarker = text.match(/(?:^|\n)partial:\s*\n([\s\S]*)$/i);
  if (partialMarker?.[1]?.trim()) {
    return { agentName, body: partialMarker[1].trim() };
  }
  return { agentName, body: text };
}

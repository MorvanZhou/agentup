/** 从一条 assistant 消息里抽出「协助过的 Agent」展示信息。 */

export type AssistAgentStatus = "running" | "completed" | "failed";

export type AssistAgentRef = {
  agentId: string;
  /** 结果或参数里带出的展示名提示。 */
  nameHint: string;
  brief: string;
  reply: string;
  status: AssistAgentStatus;
  /**
   * 工具结果为「Delegation started (async)」：父回合已派发，
   * 专家可能仍在执行（结果另有 wake / 通知）。
   */
  asyncDispatched?: boolean;
  toolCallId: string;
  /** 结果正文或 started 事件里的委托任务 id。 */
  taskId: string;
  /** 工具 part 墙钟起点（毫秒）；缺省时 UI 可本地兜底。 */
  startedAt?: number;
  /** 工具 part 墙钟终点（毫秒）；进行中通常缺省。 */
  completedAt?: number;
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
  timing?: { startedAt?: number; completedAt?: number };
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
    const asyncDispatched = isDelegationAsyncStarted(resultText);
    const status: AssistAgentStatus = failed
      ? "failed"
      : running
        ? "running"
        : "completed";
    const timing = readPartTiming(part);
    const next: AssistAgentRef = {
      agentId,
      nameHint: parsed.agentName,
      brief,
      // 异步派发无同步回复正文；勿把「started (async)」说明文塞进 reply。
      reply: failed
        ? resultText
        : completed && !asyncDispatched
          ? parsed.body || resultText
          : "",
      status,
      ...(asyncDispatched ? { asyncDispatched: true } : {}),
      toolCallId: part.toolCallId ?? "",
      taskId: parseDelegationTaskId(resultText),
      ...(timing.startedAt !== undefined ? { startedAt: timing.startedAt } : {}),
      ...(timing.completedAt !== undefined
        ? { completedAt: timing.completedAt }
        : {}),
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
        startedAt: next.startedAt ?? prev.startedAt,
        completedAt: next.completedAt ?? prev.completedAt,
      };
    }
  }

  return ordered;
}

function asDelegatePart(raw: unknown): ToolLikePart | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const part = raw as ToolLikePart;
  // API 裸名 + SDK MCP 全名；Cursor 旧壳 mcp{provider:agentup,toolName:delegate_to_agent}
  const projected = projectDelegateTool(part.toolName ?? "", part.args ?? part.input);
  if (!projected) return undefined;
  if (part.type !== "tool-call" && part.type !== "dynamic-tool") return undefined;
  return { ...part, toolName: projected.toolName, args: projected.args };
}

function projectDelegateTool(
  toolName: string,
  args: unknown,
): { toolName: string; args: Record<string, unknown> } | undefined {
  if (toolName === "delegate_to_agent" || toolName === "mcp__agentup__delegate_to_agent") {
    return { toolName, args: asRecord(args) };
  }
  if (toolName !== "mcp") return undefined;
  const row = asRecord(args);
  const nested =
    typeof row.toolName === "string" ? row.toolName.trim() : "";
  const provider =
    typeof row.providerIdentifier === "string" ? row.providerIdentifier.trim() : "";
  if (provider !== "agentup" || nested !== "delegate_to_agent") return undefined;
  return {
    toolName: "mcp__agentup__delegate_to_agent",
    args: asRecord(row.args),
  };
}

function readPartTiming(part: ToolLikePart): {
  startedAt?: number;
  completedAt?: number;
} {
  const timing = part.timing;
  if (!timing || typeof timing !== "object") return {};
  const startedAt =
    typeof timing.startedAt === "number" && Number.isFinite(timing.startedAt)
      ? timing.startedAt
      : undefined;
  const completedAt =
    typeof timing.completedAt === "number" && Number.isFinite(timing.completedAt)
      ? timing.completedAt
      : undefined;
  return {
    ...(startedAt !== undefined ? { startedAt } : {}),
    ...(completedAt !== undefined ? { completedAt } : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toolResultText(part: ToolLikePart): string {
  return unwrapDelegationResultPayload(part.result ?? part.output).trim();
}

/** Cursor MCP 壳 / 纯文本 → 委托结果正文（与 tool-args.unwrapSdkToolResultText 同形）。 */
function unwrapDelegationResultPayload(raw: unknown): string {
  if (raw === undefined || raw === null) return "";
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return "";
    if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return raw;
    try {
      return unwrapDelegationResultPayload(JSON.parse(trimmed) as unknown) || raw;
    } catch {
      return raw;
    }
  }
  if (typeof raw !== "object") return String(raw);
  const row = raw as Record<string, unknown>;
  if (row.value && typeof row.value === "object" && !Array.isArray(row.value)) {
    const inner = unwrapDelegationResultPayload(row.value);
    if (inner) return inner;
  }
  if (Array.isArray(row.content)) {
    const parts = row.content
      .map((item) => unwrapDelegationContentBlock(item))
      .filter(Boolean);
    if (parts.length > 0) return parts.join("\n");
  }
  const block = unwrapDelegationContentBlock(raw);
  if (block) return block;
  try {
    return JSON.stringify(raw);
  } catch {
    return "";
  }
}

function unwrapDelegationContentBlock(item: unknown): string {
  if (typeof item === "string") return item;
  if (!item || typeof item !== "object" || Array.isArray(item)) return "";
  const row = item as Record<string, unknown>;
  if (typeof row.text === "string") return row.text;
  if (row.text && typeof row.text === "object" && !Array.isArray(row.text)) {
    const nested = row.text as Record<string, unknown>;
    if (typeof nested.text === "string") return nested.text;
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
  if (isDelegationAsyncStarted(resultText)) return true;
  // 其它非失败正文视为成功（兼容旧格式）
  return !isDelegateFailure({}, resultText);
}

/** 异步委托：工具已返回「started」，专家仍可能在跑。 */
export function isDelegationAsyncStarted(resultText: string): boolean {
  return /Delegation started \(async\)/i.test(resultText);
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
  // 先解 Cursor/MCP JSON 壳，再抽 result:/partial:（CodeBuddy 纯文本同样走过）
  const text = unwrapDelegationResultPayload(raw).trim();
  if (!text) return { agentName: "", body: "" };

  let agentName = "";
  const agentLine = text.match(/^agent:\s*(.+)$/m);
  if (agentLine?.[1]) {
    const label = agentLine[1].trim();
    const named = label.match(/^(.*?)\s*\([^)]+\)\s*$/);
    agentName = (named?.[1] ?? label).trim();
  }

  // 兼容 `result:\n正文` 与 `result: 正文`（Cursor / CodeBuddy 都见过）
  const resultMarker = text.match(/(?:^|\n)result:\s*\n?([\s\S]*)$/i);
  if (resultMarker?.[1]?.trim()) {
    return { agentName, body: resultMarker[1].trim() };
  }
  const partialMarker = text.match(/(?:^|\n)partial:\s*\n?([\s\S]*)$/i);
  if (partialMarker?.[1]?.trim()) {
    return { agentName, body: partialMarker[1].trim() };
  }
  return { agentName, body: text };
}

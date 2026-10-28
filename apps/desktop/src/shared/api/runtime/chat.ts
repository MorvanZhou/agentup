import type { UIMessage } from "ai";

import {
  parseHistory,
  type AgentUpAskUserData,
  type AskUserAnswer,
} from "../../model/chat/chat";
import {
  PERSONAL_ASSISTANT_ID,
  type InvocableSkill,
  type ProviderModelRef,
  type SessionModelState,
  type UiLocale,
} from "../../model/runtime/runtime";

import { DesktopApiError } from "./error";
import type { RuntimeHttp } from "./http";
import { readInvocableSkill, readSessionModelState } from "./readers";

function sessionModelPath(agentId: string, userId: string, locale?: UiLocale): string {
  const params = new URLSearchParams({ user_id: userId });
  if (locale) params.set("lang", locale);
  return agentId === PERSONAL_ASSISTANT_ID
    ? `/personal-assistant/session/model?${params}`
    : `/agents/${encodeURIComponent(agentId)}/session/model?${params}`;
}

export type AttentionApproval = {
  id: string;
  /** 侧栏 / Dock 展示归属（同步嵌套时可能已 remap 到父）。 */
  agentId: string;
  /** 真实发起 HITL 的会话（委托子 Agent）。 */
  originAgentId?: string;
  /** 委托方；异步时与 agentId 不同，供主 Agent 侧栏提醒。 */
  parentAgentId?: string;
  /** 群执掌 / 群内委托 HITL；有值时不应挂到一对一 Dock。 */
  groupId?: string;
  toolCallId: string;
  toolName: string;
  args: unknown;
  askedByName?: string;
  taskLabel?: string;
  taskId?: string;
};

export type AttentionAskUser = {
  id: string;
  agentId: string;
  originAgentId?: string;
  parentAgentId?: string;
  /** 群执掌 / 群内委托 HITL；有值时不应挂到一对一 Dock。 */
  groupId?: string;
  toolCallId: string;
  questions: AgentUpAskUserData["questions"];
  askedByName?: string;
  taskLabel?: string;
  taskId?: string;
};

export type AttentionShellHang = {
  id: string;
  agentId: string;
  originAgentId?: string;
  parentAgentId?: string;
  /** 群执掌 / 群内委托 HITL；有值时不应挂到一对一 Dock。 */
  groupId?: string;
  toolCallId: string;
  toolName: string;
  command: string;
  elapsedMs: number;
  askedByName?: string;
  taskLabel?: string;
  taskId?: string;
};

function optionalGroupId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export type BusyTurnPhase = "prompt" | "wake";

export type BusyTurnSource = {
  name: string;
  status?: string;
  agentId?: string;
  kind?: "delegation" | "background";
};

/** 主会话当前回合（编排条：wake 汇总 / 普通回复）。 */
export type BusyTurn = {
  agentId: string;
  phase: BusyTurnPhase;
  sources: BusyTurnSource[];
};

export type AttentionSnapshot = {
  busyAgentIds: string[];
  busyTurns: BusyTurn[];
  approvals: AttentionApproval[];
  askUsers: AttentionAskUser[];
  shellHangs: AttentionShellHang[];
};

/** 解析 `/attention` 或 pulse 内嵌的 attention 对象。 */
export function parseAttentionPayload(payload: Record<string, unknown>): AttentionSnapshot {
  const busyRaw = payload.busy_agent_ids;
  const busyAgentIds = Array.isArray(busyRaw)
    ? busyRaw.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  const busyTurns: BusyTurn[] = [];
  if (Array.isArray(payload.busy_turns)) {
    for (const raw of payload.busy_turns) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as Record<string, unknown>;
      if (typeof item.agent_id !== "string" || !item.agent_id) continue;
      const phase = item.phase === "wake" || item.phase === "prompt" ? item.phase : "prompt";
      const sources: BusyTurnSource[] = [];
      if (Array.isArray(item.sources)) {
        for (const src of item.sources) {
          if (!src || typeof src !== "object") continue;
          const row = src as Record<string, unknown>;
          if (typeof row.name !== "string" || !row.name.trim()) continue;
          sources.push({
            name: row.name.trim(),
            status: typeof row.status === "string" ? row.status : undefined,
            agentId: typeof row.agent_id === "string" ? row.agent_id : undefined,
            kind:
              row.kind === "background" || row.kind === "delegation" ? row.kind : undefined,
          });
        }
      }
      busyTurns.push({ agentId: item.agent_id, phase, sources });
    }
  }
  const approvals: AttentionApproval[] = [];
  if (Array.isArray(payload.approvals)) {
    for (const raw of payload.approvals) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as Record<string, unknown>;
      if (
        typeof item.id !== "string" ||
        typeof item.agent_id !== "string" ||
        typeof item.tool_call_id !== "string" ||
        typeof item.tool_name !== "string"
      ) {
        continue;
      }
      approvals.push({
        id: item.id,
        agentId: item.agent_id,
        originAgentId:
          typeof item.origin_agent_id === "string" && item.origin_agent_id
            ? item.origin_agent_id
            : undefined,
        parentAgentId:
          typeof item.parent_agent_id === "string" && item.parent_agent_id
            ? item.parent_agent_id
            : undefined,
        groupId: optionalGroupId(item.group_id),
        toolCallId: item.tool_call_id,
        toolName: item.tool_name,
        args: item.args,
        askedByName:
          typeof item.asked_by_name === "string" && item.asked_by_name.trim()
            ? item.asked_by_name.trim()
            : undefined,
        taskLabel:
          typeof item.task_label === "string" && item.task_label.trim()
            ? item.task_label.trim()
            : undefined,
        taskId: optionalGroupId(item.task_id),
      });
    }
  }
  const askUsers: AttentionAskUser[] = [];
  if (Array.isArray(payload.ask_users)) {
    for (const raw of payload.ask_users) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as Record<string, unknown>;
      if (
        typeof item.id !== "string" ||
        typeof item.agent_id !== "string" ||
        typeof item.tool_call_id !== "string" ||
        !Array.isArray(item.questions)
      ) {
        continue;
      }
      askUsers.push({
        id: item.id,
        agentId: item.agent_id,
        originAgentId:
          typeof item.origin_agent_id === "string" && item.origin_agent_id
            ? item.origin_agent_id
            : undefined,
        parentAgentId:
          typeof item.parent_agent_id === "string" && item.parent_agent_id
            ? item.parent_agent_id
            : undefined,
        groupId: optionalGroupId(item.group_id),
        toolCallId: item.tool_call_id,
        questions: item.questions as AgentUpAskUserData["questions"],
        askedByName:
          typeof item.asked_by_name === "string" && item.asked_by_name.trim()
            ? item.asked_by_name.trim()
            : undefined,
        taskLabel:
          typeof item.task_label === "string" && item.task_label.trim()
            ? item.task_label.trim()
            : undefined,
        taskId: optionalGroupId(item.task_id),
      });
    }
  }
  const shellHangs: AttentionShellHang[] = [];
  if (Array.isArray(payload.shell_hangs)) {
    for (const raw of payload.shell_hangs) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as Record<string, unknown>;
      if (
        typeof item.id !== "string" ||
        typeof item.agent_id !== "string" ||
        typeof item.tool_call_id !== "string" ||
        typeof item.tool_name !== "string" ||
        typeof item.command !== "string" ||
        typeof item.elapsed_ms !== "number"
      ) {
        continue;
      }
      shellHangs.push({
        id: item.id,
        agentId: item.agent_id,
        originAgentId:
          typeof item.origin_agent_id === "string" && item.origin_agent_id
            ? item.origin_agent_id
            : undefined,
        parentAgentId:
          typeof item.parent_agent_id === "string" && item.parent_agent_id
            ? item.parent_agent_id
            : undefined,
        groupId: optionalGroupId(item.group_id),
        toolCallId: item.tool_call_id,
        toolName: item.tool_name,
        command: item.command,
        elapsedMs: item.elapsed_ms,
        askedByName:
          typeof item.asked_by_name === "string" && item.asked_by_name.trim()
            ? item.asked_by_name.trim()
            : undefined,
        taskLabel:
          typeof item.task_label === "string" && item.task_label.trim()
            ? item.task_label.trim()
            : undefined,
        taskId: optionalGroupId(item.task_id),
      });
    }
  }
  return { busyAgentIds, busyTurns, approvals, askUsers, shellHangs };
}

/** 侧栏 / Dock：runtime busy + 仍可闭合的 HITL。 */
export async function attention(
  http: RuntimeHttp,
  token: string,
  userId: string,
): Promise<AttentionSnapshot> {
  const payload = await http.request(
    `/attention?user_id=${encodeURIComponent(userId)}`,
    token,
  );
  return parseAttentionPayload(payload);
}

export async function decideShellHang(
  http: RuntimeHttp,
  token: string,
  hangId: string,
  action: "kill" | "wait" | "bg",
): Promise<void> {
  await http.request(`/shell-hangs/${encodeURIComponent(hangId)}`, token, { action });
}

export async function decideApproval(
  http: RuntimeHttp,
  token: string,
  approvalId: string,
  allow: boolean,
  scope: "once" | "session" | "agent" = "once",
): Promise<void> {
  await http.request(`/approvals/${encodeURIComponent(approvalId)}`, token, {
    allow,
    ...(allow && scope !== "once" ? { scope } : {}),
  });
}

export async function answerAskUser(
  http: RuntimeHttp,
  token: string,
  askUserId: string,
  answer: AskUserAnswer,
): Promise<void> {
  const body =
    answer.kind === "cancelled"
      ? { cancelled: true }
      : { answer };
  await http.request(`/ask-user/${encodeURIComponent(askUserId)}`, token, body);
}

/** 当前会话可调用的 skills（私人助理已激活 / 第三方运行包）。 */
export async function invocableSkills(
  http: RuntimeHttp,
  token: string,
  agentId: string,
  userId: string,
): Promise<InvocableSkill[]> {
  const endpoint =
    agentId === PERSONAL_ASSISTANT_ID
      ? `/personal-assistant/skills?user_id=${encodeURIComponent(userId)}`
      : `/agents/${encodeURIComponent(agentId)}/skills?user_id=${encodeURIComponent(userId)}`;
  const payload = await http.request(endpoint, token);
  if (!Array.isArray(payload.skills)) throw new DesktopApiError("技能列表无效");
  return payload.skills.map(readInvocableSkill);
}

export type HistoryPage = { messages: UIMessage[]; hasMore: boolean };

export async function history(
  http: RuntimeHttp,
  token: string,
  agentId: string,
  userId: string,
  options: { limit?: number; before?: string } = {},
): Promise<HistoryPage> {
  const query = [`user_id=${encodeURIComponent(userId)}`];
  if (options.limit) query.push(`limit=${options.limit}`);
  if (options.before) query.push(`before=${encodeURIComponent(options.before)}`);
  const endpoint =
    agentId === PERSONAL_ASSISTANT_ID
      ? `/personal-assistant/history?${query.join("&")}`
      : `/agents/${encodeURIComponent(agentId)}/history?${query.join("&")}`;
  const payload = await http.request(endpoint, token);
  try {
    return { messages: parseHistory(payload.messages), hasMore: payload.hasMore === true };
  } catch {
    throw new DesktopApiError("聊天记录无效");
  }
}

export async function sessionModel(
  http: RuntimeHttp,
  token: string,
  agentId: string,
  userId: string,
  locale?: UiLocale,
): Promise<SessionModelState> {
  const payload = await http.request(sessionModelPath(agentId, userId, locale), token);
  return readSessionModelState(payload);
}

export async function setSessionModel(
  http: RuntimeHttp,
  token: string,
  agentId: string,
  userId: string,
  ref: ProviderModelRef,
  locale?: UiLocale,
): Promise<SessionModelState> {
  const endpoint =
    agentId === PERSONAL_ASSISTANT_ID
      ? "/personal-assistant/session/model"
      : `/agents/${encodeURIComponent(agentId)}/session/model`;
  const params = locale ? `?lang=${encodeURIComponent(locale)}` : "";
  const payload = await http.request(`${endpoint}${params}`, token, {
    user_id: userId,
    template_id: ref.templateId,
    model_id: ref.modelId,
  }, "PUT");
  return readSessionModelState(payload);
}

/** 停止本机会话当前 turn，并等到 runtime busy 解开。 */
export async function abortTurn(
  http: RuntimeHttp,
  token: string,
  agentId: string,
  userId: string,
): Promise<void> {
  const endpoint =
    agentId === PERSONAL_ASSISTANT_ID
      ? "/personal-assistant/abort"
      : `/agents/${encodeURIComponent(agentId)}/abort`;
  await http.request(endpoint, token, { user_id: userId });
}

export async function clearContext(
  http: RuntimeHttp,
  token: string,
  agentId: string,
  userId: string,
): Promise<void> {
  const endpoint =
    agentId === PERSONAL_ASSISTANT_ID
      ? "/personal-assistant/context"
      : `/agents/${encodeURIComponent(agentId)}/context`;
  await http.request(endpoint, token, { user_id: userId });
}

export async function clearHistory(
  http: RuntimeHttp,
  token: string,
  agentId: string,
  userId: string,
): Promise<void> {
  const endpoint =
    agentId === PERSONAL_ASSISTANT_ID
      ? `/personal-assistant/history?user_id=${encodeURIComponent(userId)}`
      : `/agents/${encodeURIComponent(agentId)}/history?user_id=${encodeURIComponent(userId)}`;
  await http.request(endpoint, token, undefined, "DELETE");
}

export type DelegationTaskDto = {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  toAgentName: string;
  brief: string;
  status: "pending_auth" | "running" | "completed" | "failed" | "cancelled";
  wait: boolean;
  resultSummary: string | null;
  error: string | null;
  seen: boolean;
  notified: boolean;
  createdAt: number;
  updatedAt: number;
  /** 群内委派；有值时桌面勿当一对一异步完成（toast / 私聊未读）。 */
  groupId?: string;
};

export function parseDelegationTask(raw: unknown): DelegationTaskDto {
  const item = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const groupId = optionalGroupId(item.group_id);
  return {
    id: String(item.id ?? ""),
    fromAgentId: String(item.from_agent_id ?? ""),
    toAgentId: String(item.to_agent_id ?? ""),
    toAgentName: String(item.to_agent_name ?? item.to_agent_id ?? ""),
    brief: String(item.brief ?? ""),
    status: item.status as DelegationTaskDto["status"],
    wait: item.wait !== false,
    resultSummary: typeof item.result_summary === "string" ? item.result_summary : null,
    error: typeof item.error === "string" ? item.error : null,
    seen: item.seen === true,
    notified: item.notified === true,
    createdAt: typeof item.created_at === "number" ? item.created_at : 0,
    updatedAt: typeof item.updated_at === "number" ? item.updated_at : 0,
    ...(groupId ? { groupId } : {}),
  };
}

/** 私人助理委托任务列表（可选仅未见 / 状态 / 委托方）。 */
export async function listDelegations(
  http: RuntimeHttp,
  token: string,
  userId: string,
  options: {
    unseenOnly?: boolean;
    status?: DelegationTaskDto["status"];
    fromAgentId?: string;
  } = {},
): Promise<DelegationTaskDto[]> {
  const params = new URLSearchParams({ user_id: userId });
  if (options.unseenOnly) params.set("unseen", "1");
  if (options.status) params.set("status", options.status);
  if (options.fromAgentId) params.set("from_agent_id", options.fromAgentId);
  const payload = await http.request(
    `/personal-assistant/delegations?${params.toString()}`,
    token,
  );
  if (!Array.isArray(payload.tasks)) throw new DesktopApiError("委托列表无效");
  return payload.tasks.map(parseDelegationTask);
}

export async function acknowledgeDelegation(
  http: RuntimeHttp,
  token: string,
  userId: string,
  taskId: string,
): Promise<void> {
  await http.request(
    `/personal-assistant/delegations/${encodeURIComponent(taskId)}/ack`,
    token,
    { user_id: userId },
  );
}

/** 取消进行中的委托任务。 */
export async function cancelDelegation(
  http: RuntimeHttp,
  token: string,
  userId: string,
  taskId: string,
): Promise<{ id: string; status: DelegationTaskDto["status"] }> {
  const payload = await http.request(
    `/personal-assistant/delegations/${encodeURIComponent(taskId)}/cancel`,
    token,
    { user_id: userId },
  );
  return {
    id: String(payload.id ?? taskId),
    status: (payload.status as DelegationTaskDto["status"]) ?? "cancelled",
  };
}

export type BackgroundJobDto = {
  id: string;
  agentId: string;
  name: string;
  command: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  exitCode: number | null;
  outputTail: string | null;
  error: string | null;
  seen: boolean;
  notified: boolean;
  createdAt: number;
  updatedAt: number;
};

export function parseBackgroundJob(raw: unknown): BackgroundJobDto {
  const item = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    id: String(item.id ?? ""),
    agentId: String(item.agent_id ?? ""),
    name: String(item.name ?? ""),
    command: String(item.command ?? ""),
    status: item.status as BackgroundJobDto["status"],
    exitCode: typeof item.exit_code === "number" ? item.exit_code : null,
    outputTail: typeof item.output_tail === "string" ? item.output_tail : null,
    error: typeof item.error === "string" ? item.error : null,
    seen: item.seen === true,
    notified: item.notified === true,
    createdAt: typeof item.created_at === "number" ? item.created_at : 0,
    updatedAt: typeof item.updated_at === "number" ? item.updated_at : 0,
  };
}

export async function listBackgroundJobs(
  http: RuntimeHttp,
  token: string,
  userId: string,
  options: {
    unseenOnly?: boolean;
    status?: BackgroundJobDto["status"];
    agentId?: string;
  } = {},
): Promise<BackgroundJobDto[]> {
  const params = new URLSearchParams({ user_id: userId });
  if (options.unseenOnly) params.set("unseen", "1");
  if (options.status) params.set("status", options.status);
  if (options.agentId) params.set("agent_id", options.agentId);
  const payload = await http.request(
    `/personal-assistant/background-jobs?${params.toString()}`,
    token,
  );
  if (!Array.isArray(payload.jobs)) throw new DesktopApiError("后台任务列表无效");
  return payload.jobs.map(parseBackgroundJob);
}

export async function acknowledgeBackgroundJob(
  http: RuntimeHttp,
  token: string,
  userId: string,
  jobId: string,
): Promise<void> {
  await http.request(
    `/personal-assistant/background-jobs/${encodeURIComponent(jobId)}/ack`,
    token,
    { user_id: userId },
  );
}

export async function cancelBackgroundJob(
  http: RuntimeHttp,
  token: string,
  userId: string,
  jobId: string,
): Promise<{ id: string; status: BackgroundJobDto["status"] }> {
  const payload = await http.request(
    `/personal-assistant/background-jobs/${encodeURIComponent(jobId)}/cancel`,
    token,
    { user_id: userId },
  );
  return {
    id: String(payload.id ?? jobId),
    status: (payload.status as BackgroundJobDto["status"]) ?? "cancelled",
  };
}

export type DelegationConfirmedArtifactDto = {
  path: string;
  size?: number;
};

export type DelegationHistoryDto = {
  task: {
    id: string;
    status: DelegationTaskDto["status"];
    toAgentId: string;
    toAgentName: string;
    brief: string;
    resultSummary: string | null;
    error: string | null;
    /** 群内委派：产物在共享工作区，预览须走 `group:<id>`。 */
    groupId?: string;
    /**
     * deliver_artifacts / complete_group_task 确认清单。
     * 旁路 UI 投影成 agentUpArtifacts；缺省表示尚未确认。
     */
    artifacts?: DelegationConfirmedArtifactDto[];
  };
  messages: UIMessage[];
};

function parseConfirmedArtifacts(raw: unknown): DelegationConfirmedArtifactDto[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const files: DelegationConfirmedArtifactDto[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as { path?: unknown; size?: unknown };
    if (typeof record.path !== "string" || !record.path.trim()) continue;
    const entry: DelegationConfirmedArtifactDto = { path: record.path };
    if (typeof record.size === "number" && Number.isFinite(record.size) && record.size >= 0) {
      entry.size = record.size;
    }
    files.push(entry);
  }
  return files;
}

/** 委托隔离子会话历史（旁路，不进父消息）。 */
export async function delegationHistory(
  http: RuntimeHttp,
  token: string,
  userId: string,
  taskId: string,
): Promise<DelegationHistoryDto> {
  const payload = await http.request(
    `/personal-assistant/delegations/${encodeURIComponent(taskId)}/history?user_id=${encodeURIComponent(userId)}`,
    token,
  );
  const taskRaw = (payload.task ?? {}) as Record<string, unknown>;
  let messages: UIMessage[] = [];
  try {
    messages = parseHistory(payload.messages);
  } catch {
    throw new DesktopApiError("委托历史无效");
  }
  const groupId = optionalGroupId(taskRaw.group_id);
  const artifacts = parseConfirmedArtifacts(taskRaw.artifacts);
  return {
    task: {
      id: String(taskRaw.id ?? taskId),
      status: taskRaw.status as DelegationTaskDto["status"],
      toAgentId: String(taskRaw.to_agent_id ?? ""),
      toAgentName: String(taskRaw.to_agent_name ?? taskRaw.to_agent_id ?? ""),
      brief: String(taskRaw.brief ?? ""),
      resultSummary: typeof taskRaw.result_summary === "string" ? taskRaw.result_summary : null,
      error: typeof taskRaw.error === "string" ? taskRaw.error : null,
      ...(groupId ? { groupId } : {}),
      ...(artifacts ? { artifacts } : {}),
    },
    messages,
  };
}

/** 委托执行旁路 SSE（UIMessageStream）；调用方自行 parseJsonEventStream。 */
export function delegationStreamUrl(
  baseUrl: string,
  userId: string,
  taskId: string,
): string {
  const params = new URLSearchParams({ user_id: userId });
  return `${baseUrl}/personal-assistant/delegations/${encodeURIComponent(taskId)}/stream?${params}`;
}

/** wake 等编排回合旁路 UIMessage SSE（与 /prompt 同形）。 */
export function turnStreamUrl(baseUrl: string, userId: string, agentId: string): string {
  const params = new URLSearchParams({ user_id: userId, agent_id: agentId });
  return `${baseUrl.replace(/\/$/, "")}/turn-stream?${params}`;
}

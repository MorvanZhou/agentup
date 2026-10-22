import type { UIMessage } from "ai";

import {
  parseHistory,
  type AgentUpAskUserData,
  type AskUserAnswer,
} from "../../model/chat";
import {
  PERSONAL_ASSISTANT_ID,
  type InvocableSkill,
  type ProviderModelRef,
  type SessionModelState,
  type UiLocale,
} from "../../model/runtime";

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
  agentId: string;
  toolCallId: string;
  toolName: string;
  args: unknown;
};

export type AttentionAskUser = {
  id: string;
  agentId: string;
  toolCallId: string;
  questions: AgentUpAskUserData["questions"];
};

export type AttentionSnapshot = {
  busyAgentIds: string[];
  approvals: AttentionApproval[];
  askUsers: AttentionAskUser[];
};

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
  const busyRaw = payload.busy_agent_ids;
  const busyAgentIds = Array.isArray(busyRaw)
    ? busyRaw.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
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
        toolCallId: item.tool_call_id,
        toolName: item.tool_name,
        args: item.args,
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
        toolCallId: item.tool_call_id,
        questions: item.questions as AgentUpAskUserData["questions"],
      });
    }
  }
  return { busyAgentIds, approvals, askUsers };
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

export async function history(
  http: RuntimeHttp,
  token: string,
  agentId: string,
  userId: string,
): Promise<UIMessage[]> {
  const endpoint =
    agentId === PERSONAL_ASSISTANT_ID
      ? `/personal-assistant/history?user_id=${encodeURIComponent(userId)}`
      : `/agents/${encodeURIComponent(agentId)}/history?user_id=${encodeURIComponent(userId)}`;
  const payload = await http.request(endpoint, token);
  try {
    return parseHistory(payload.messages);
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
};

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
  return payload.tasks.map((raw) => {
    const item = raw as Record<string, unknown>;
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
    };
  });
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
  return payload.jobs.map((raw) => {
    const item = raw as Record<string, unknown>;
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
  });
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

export type DelegationHistoryDto = {
  task: {
    id: string;
    status: DelegationTaskDto["status"];
    toAgentId: string;
    toAgentName: string;
    brief: string;
    resultSummary: string | null;
    error: string | null;
  };
  messages: UIMessage[];
};

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
  return {
    task: {
      id: String(taskRaw.id ?? taskId),
      status: taskRaw.status as DelegationTaskDto["status"],
      toAgentId: String(taskRaw.to_agent_id ?? ""),
      toAgentName: String(taskRaw.to_agent_name ?? taskRaw.to_agent_id ?? ""),
      brief: String(taskRaw.brief ?? ""),
      resultSummary: typeof taskRaw.result_summary === "string" ? taskRaw.result_summary : null,
      error: typeof taskRaw.error === "string" ? taskRaw.error : null,
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

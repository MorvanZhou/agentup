import { DesktopApiError } from "./error";
import type { RuntimeHttp } from "./http";

/**
 * followUp 队列：本地 Agent App（SDK）接入下，回合进行中用户新发消息不再 409，
 * 而是进 runtime 的队列，本轮结束后合并成一条再开一轮（docs/agent_cli §12.8）。
 */

export type FollowUpItem = {
  id: string;
  text: string;
  createdAt: number;
};

export async function listFollowUps(
  http: RuntimeHttp,
  token: string,
  userId: string,
  agentId: string,
): Promise<FollowUpItem[]> {
  const payload = await http.request(`/follow-ups${query(userId, agentId)}`, token);
  return readQueue(payload);
}

export async function enqueueFollowUp(
  http: RuntimeHttp,
  token: string,
  userId: string,
  agentId: string,
  text: string,
): Promise<FollowUpItem[]> {
  const payload = await http.request(
    "/follow-ups",
    token,
    { user_id: userId, agent_id: agentId, text },
    "POST",
  );
  return readQueue(payload);
}

export async function updateFollowUp(
  http: RuntimeHttp,
  token: string,
  userId: string,
  agentId: string,
  id: string,
  text: string,
): Promise<FollowUpItem[]> {
  const payload = await http.request(
    `/follow-ups/${encodeURIComponent(id)}`,
    token,
    { user_id: userId, agent_id: agentId, text },
    "PATCH",
  );
  return readQueue(payload);
}

export async function promoteFollowUp(
  http: RuntimeHttp,
  token: string,
  userId: string,
  agentId: string,
  id: string,
): Promise<FollowUpItem[]> {
  const payload = await http.request(
    `/follow-ups/${encodeURIComponent(id)}/promote${query(userId, agentId)}`,
    token,
    undefined,
    "POST",
  );
  return readQueue(payload);
}

export async function removeFollowUp(
  http: RuntimeHttp,
  token: string,
  userId: string,
  agentId: string,
  id: string,
): Promise<FollowUpItem[]> {
  const payload = await http.request(
    `/follow-ups/${encodeURIComponent(id)}${query(userId, agentId)}`,
    token,
    undefined,
    "DELETE",
  );
  return readQueue(payload);
}

export async function clearFollowUps(
  http: RuntimeHttp,
  token: string,
  userId: string,
  agentId: string,
): Promise<number> {
  const payload = await http.request(`/follow-ups${query(userId, agentId)}`, token, undefined, "DELETE");
  return typeof payload.cleared === "number" ? payload.cleared : 0;
}

export async function resumeFollowUps(
  http: RuntimeHttp,
  token: string,
  userId: string,
  agentId: string,
): Promise<void> {
  await http.request(
    "/follow-ups/resume",
    token,
    { user_id: userId, agent_id: agentId },
    "POST",
  );
}

function query(userId: string, agentId: string): string {
  return `?${new URLSearchParams({ user_id: userId, agent_id: agentId }).toString()}`;
}

function readQueue(payload: Record<string, unknown>): FollowUpItem[] {
  if (!Array.isArray(payload.queue)) throw new DesktopApiError("排队列表无效");
  const items: FollowUpItem[] = [];
  for (const row of payload.queue) {
    const item = readItem(row);
    if (item) items.push(item);
  }
  return items;
}

function readItem(row: unknown): FollowUpItem | null {
  if (!row || typeof row !== "object") return null;
  const record = row as { id?: unknown; text?: unknown; created_at?: unknown };
  if (typeof record.id !== "string" || typeof record.text !== "string") return null;
  return {
    id: record.id,
    text: record.text,
    createdAt: typeof record.created_at === "number" ? record.created_at : 0,
  };
}

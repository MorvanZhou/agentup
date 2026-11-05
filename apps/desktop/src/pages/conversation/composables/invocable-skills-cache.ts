import { DesktopApi } from "../../../shared/api/runtime";
import type { InvocableSkill } from "../../../shared/model/runtime/runtime";

/** 按 user/agent 缓存可调用 skill，Composer 与历史气泡共用，避免每条消息重拉。 */
const cache = new Map<string, InvocableSkill[]>();
const inflight = new Map<string, Promise<InvocableSkill[]>>();

function cacheKey(userId: string, agentId: string): string {
  return `${userId}/${agentId}`;
}

export function peekInvocableSkills(userId: string, agentId: string): InvocableSkill[] | undefined {
  if (!userId || !agentId) return undefined;
  return cache.get(cacheKey(userId, agentId));
}

export function loadInvocableSkills(
  token: string,
  agentId: string,
  userId: string,
  api: DesktopApi = new DesktopApi(),
): Promise<InvocableSkill[]> {
  if (!token || !agentId || !userId) return Promise.resolve([]);
  const key = cacheKey(userId, agentId);
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  const pending = inflight.get(key);
  if (pending) return pending;
  const request = api
    .invocableSkills(token, agentId, userId)
    .then((list) => {
      cache.set(key, list);
      inflight.delete(key);
      return list;
    })
    .catch((error) => {
      inflight.delete(key);
      throw error;
    });
  inflight.set(key, request);
  return request;
}

/** 测试或切换身份时清缓存。 */
export function clearInvocableSkillsCache(): void {
  cache.clear();
  inflight.clear();
}

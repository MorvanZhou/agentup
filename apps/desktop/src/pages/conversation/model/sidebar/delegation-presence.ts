import { t, tf } from "../../../../shared/model/ui/ui-locale";

/** 侧栏与直聊横幅共用的一条异步进行中委托。 */
export type IncomingDelegation = {
  id: string;
  fromAgentId: string;
  brief: string;
  createdAt: number;
};

/** 花名册上的派生忙碌：谁派出了几人，谁正接着谁的活。 */
export type DelegationPresence = {
  /** fromAgentId → 去重后的专家人数。 */
  dispatchedCount: Record<string, number>;
  /** toAgentId → 进行中的异步委托（保持输入顺序）。 */
  incoming: Record<string, IncomingDelegation[]>;
};

export type DelegationPresenceTask = {
  id?: string;
  fromAgentId?: string;
  toAgentId?: string;
  brief?: string;
  wait?: boolean;
  status?: string;
  createdAt?: number;
};

const EMPTY: DelegationPresence = { dispatchedCount: {}, incoming: {} };

/**
 * 从全量委托抽出花名册要显示的在场感。
 * 只收异步且 running（缺 status 视为接口已按 running 过滤）。
 * 同步短任务、待批准、终态都不进；排队仍是 running，与执行中同一句文案。
 */
export function delegationPresence(
  tasks: readonly DelegationPresenceTask[] | undefined,
): DelegationPresence {
  const peopleByParent = new Map<string, Set<string>>();
  const incoming: Record<string, IncomingDelegation[]> = {};
  const seen = new Set<string>();

  for (const task of tasks ?? []) {
    if (task.wait !== false) continue;
    if (task.status != null && task.status !== "running") continue;
    const id = task.id?.trim() ?? "";
    const fromAgentId = task.fromAgentId?.trim() ?? "";
    const toAgentId = task.toAgentId?.trim() ?? "";
    if (!id || !fromAgentId || !toAgentId) continue;
    if (seen.has(id)) continue;
    seen.add(id);

    let people = peopleByParent.get(fromAgentId);
    if (!people) {
      people = new Set();
      peopleByParent.set(fromAgentId, people);
    }
    people.add(toAgentId);

    const list = incoming[toAgentId] ?? [];
    list.push({
      id,
      fromAgentId,
      brief: task.brief ?? "",
      createdAt: typeof task.createdAt === "number" ? task.createdAt : 0,
    });
    incoming[toAgentId] = list;
  }

  if (peopleByParent.size === 0) return EMPTY;

  const dispatchedCount: Record<string, number> = {};
  for (const [agentId, people] of peopleByParent) {
    dispatchedCount[agentId] = people.size;
  }
  return { dispatchedCount, incoming };
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** 横幅上的「已进行多久」。不足一分钟、时钟缺失或倒退都算刚刚开始。 */
export function delegationElapsedLabel(createdAt: number, now: number): string {
  if (!Number.isFinite(createdAt) || createdAt <= 0 || !Number.isFinite(now) || now < createdAt) {
    return t("delegationBannerJust");
  }
  const elapsed = now - createdAt;
  if (elapsed < MINUTE_MS) return t("delegationBannerJust");
  if (elapsed < HOUR_MS) {
    return tf("delegationBannerMinutes", { count: Math.floor(elapsed / MINUTE_MS) });
  }
  if (elapsed < DAY_MS) {
    return tf("delegationBannerHours", { count: Math.floor(elapsed / HOUR_MS) });
  }
  return tf("delegationBannerDays", { count: Math.floor(elapsed / DAY_MS) });
}

export type DelegationBannerLine = {
  id: string;
  fromAgentId: string;
  fromName: string;
  brief: string;
  elapsed: string;
};

/** 直聊横幅的一行：派出方展示名、去掉首尾空白的 brief、耗时。 */
export function delegationBannerLines(input: {
  tasks: readonly IncomingDelegation[];
  resolveName: (agentId: string) => string;
  now: number;
}): DelegationBannerLine[] {
  return input.tasks.map((task) => ({
    id: task.id,
    fromAgentId: task.fromAgentId,
    fromName: input.resolveName(task.fromAgentId).trim(),
    brief: task.brief.trim(),
    elapsed: delegationElapsedLabel(task.createdAt, input.now),
  }));
}

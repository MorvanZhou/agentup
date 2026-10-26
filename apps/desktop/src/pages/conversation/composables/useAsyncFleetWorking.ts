import { computed, onScopeDispose, ref, watch, type Ref } from "vue";

import type { DesktopApi } from "../../../shared/api/runtime/client";
import { asyncWorkingAgentIds } from "../model/sidebar/async-fleet-working";
import {
  delegationPresence,
  type DelegationPresence,
} from "../model/sidebar/delegation-presence";

const FLEET_WORKING_POLL_MS = 2500;
const EMPTY_PRESENCE: DelegationPresence = { dispatchedCount: {}, incoming: {} };

/**
 * 会话页级：轮询全用户 running 委托 / 后台作业。
 * 后台作业点亮「正在回复」；异步委托只提供花名册在场感，不让派出方空闲时转圈。
 */
export function useAsyncFleetWorking(options: {
  api: DesktopApi;
  token: Ref<string>;
  userId: Ref<string>;
}) {
  const agentIds = ref<string[]>([]);
  const presence = ref<DelegationPresence>(EMPTY_PRESENCE);
  let timer: ReturnType<typeof setInterval> | undefined;
  let pollKey = "";

  function stop(): void {
    if (timer) clearInterval(timer);
    timer = undefined;
    pollKey = "";
  }

  function clear(): void {
    agentIds.value = [];
    presence.value = EMPTY_PRESENCE;
  }

  async function tick(): Promise<void> {
    const token = options.token.value;
    const userId = options.userId.value;
    if (!token || !userId) {
      clear();
      return;
    }
    try {
      const [delegations, backgroundJobs] = await Promise.all([
        options.api.listDelegations(token, userId, { status: "running" }),
        options.api.listBackgroundJobs(token, userId, { status: "running" }),
      ]);
      agentIds.value = asyncWorkingAgentIds({ delegations, backgroundJobs });
      presence.value = delegationPresence(delegations);
    } catch {
      // 轮询失败静默；保留上一拍，避免闪断角标
    }
  }

  function start(): void {
    const token = options.token.value;
    const userId = options.userId.value;
    const key = `${userId}\0${token}`;
    if (!token || !userId) {
      stop();
      clear();
      return;
    }
    if (timer && pollKey === key) return;
    stop();
    pollKey = key;
    void tick();
    timer = setInterval(() => {
      void tick();
    }, FLEET_WORKING_POLL_MS);
  }

  watch(
    () => `${options.userId.value}\0${options.token.value}`,
    () => start(),
    { immediate: true },
  );

  onScopeDispose(stop);

  return {
    agentIds: computed(() => agentIds.value),
    presence: computed(() => presence.value),
    refresh: tick,
    stop,
  };
}

import { computed, type Ref } from "vue";

import type { BackgroundJobDto, DelegationTaskDto } from "../../../shared/api/runtime/chat";
import { asyncWorkingAgentIds } from "../model/sidebar/async-fleet-working";
import {
  delegationPresence,
  type DelegationPresence,
} from "../model/sidebar/delegation-presence";

const EMPTY_PRESENCE: DelegationPresence = { dispatchedCount: {}, incoming: {} };

/**
 * 会话页级：从桌面 pulse 的 running fleets 推导侧栏「正在回复」与在场感。
 * 不再单独轮询 `/delegations` / `/background-jobs`。
 */
export function useAsyncFleetWorking(options: {
  runningDelegations: Ref<readonly DelegationTaskDto[]>;
  runningJobs: Ref<readonly BackgroundJobDto[]>;
}) {
  const agentIds = computed(() =>
    asyncWorkingAgentIds({
      delegations: options.runningDelegations.value,
      backgroundJobs: options.runningJobs.value,
    }),
  );

  const presence = computed(() => {
    const delegations = options.runningDelegations.value;
    if (delegations.length === 0) return EMPTY_PRESENCE;
    return delegationPresence(delegations);
  });

  return {
    agentIds,
    presence,
  };
}

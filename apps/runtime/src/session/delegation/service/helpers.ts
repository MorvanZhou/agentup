import { composeSystemPrompt } from "../../../local/agents/identity.js";
import type { LocalAgentCard } from "../../../local/agents/local-agent.js";
import type { DelegationSteerBlock } from "../steer.js";
import type { DelegationTask, RecruitedAgentInfo } from "../types.js";

export const AGENT_ID = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;

export function isTerminalStatus(status: DelegationTask["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export function parentKey(userId: string, agentId: string): string {
  return `${userId}/${agentId}`;
}

/** 任一 signal abort 则合成 abort；用于父 turn + 任务级取消并联。 */
export function linkAbortSignals(
  ...signals: Array<AbortSignal | undefined>
): AbortSignal {
  const active = signals.filter((item): item is AbortSignal => Boolean(item));
  if (active.length === 0) return new AbortController().signal;
  if (active.length === 1) return active[0]!;
  const merged = new AbortController();
  const onAbort = () => {
    if (!merged.signal.aborted) {
      const reason = active.find((item) => item.aborted)?.reason;
      merged.abort(reason);
    }
  };
  for (const signal of active) {
    if (signal.aborted) {
      onAbort();
      break;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  }
  return merged.signal;
}

export function reuseBlockedMessage(reason: DelegationSteerBlock, taskId: string): string {
  if (reason === "waiting_user") {
    return `该专员正在等你处理任务 ${taskId}，没有另开任务。请先回答或批准，或 cancel_delegation。`;
  }
  if (reason === "finished") {
    return `任务 ${taskId} 已结束，没有另开任务。需要继续就重新 delegate_to_agent。`;
  }
  return `该专员的任务 ${taskId} 还没开始执行，没有另开任务。请稍后 steer_delegation，或 cancel_delegation。`;
}

export function mergePlanned(
  planned: ReadonlyArray<{ existing?: DelegationTask }>,
  created: DelegationTask[],
): DelegationTask[] {
  let index = 0;
  return planned.map((slot) => slot.existing ?? created[index++]!);
}

export function fromLocalCard(card: LocalAgentCard): RecruitedAgentInfo {
  const name = card.name.trim();
  const role = card.role.trim();
  const background = card.background.trim();
  return {
    agentId: card.agentId,
    name,
    role,
    background,
    remark: "",
    systemText:
      name && role && background
        ? composeSystemPrompt({ name, role, background }, "zh")
        : undefined,
    ...(card.rules.trim() ? { agentsText: card.rules.trim() } : {}),
  };
}

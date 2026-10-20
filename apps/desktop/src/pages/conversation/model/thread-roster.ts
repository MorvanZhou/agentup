import type { ComputedRef, InjectionKey, Ref } from "vue";
import { computed, inject } from "vue";

/** 侧栏可解析的 Agent 名片（用于协助头像 / 跳转）。 */
export type RosterAgent = {
  agentId: string;
  name: string;
  remark: string;
  avatarUrl?: string;
  /** false 表示已解雇或不在列表。 */
  available: boolean;
};

export type OpenRosterAgentResult = "opened" | "dismissed";

export type ThreadRoster = {
  agents: RosterAgent[];
  /** 打开该 Agent 会话；已解雇返回 dismissed。 */
  openAgent: (agentId: string) => OpenRosterAgentResult;
};

export const threadRosterKey = Symbol("threadRoster") as InjectionKey<
  Ref<ThreadRoster> | ComputedRef<ThreadRoster>
>;

const empty: ThreadRoster = {
  agents: [],
  openAgent: () => "dismissed",
};

export function injectThreadRoster(): ComputedRef<ThreadRoster> {
  const value = inject(threadRosterKey);
  return computed(() => value?.value ?? empty);
}

export function resolveRosterAgent(
  roster: ThreadRoster,
  agentId: string,
  nameHint = "",
): RosterAgent {
  const found = roster.agents.find((item) => item.agentId === agentId);
  if (found) return found;
  return {
    agentId,
    name: nameHint || agentId,
    remark: "",
    available: false,
  };
}

import type { UIMessage } from "ai";
import { getCurrentScope, onScopeDispose, ref } from "vue";

import { DesktopApi, DesktopApiError } from "../../../shared/api/runtime";
import type {
  AgentUpApprovalData,
  AgentUpAskUserData,
  ApprovalScope,
  AskUserAnswer,
} from "../../../shared/model/chat";
import { showToast } from "../../../shared/model/toast";
import { forgetComposerDraft } from "../model/composer-draft";

const DELEGATION_POLL_MS = 5_000;

export function useAgentChat(
  api = new DesktopApi(),
  options: { onTurnEnd?: (agentId: string, preview: string) => void } = {},
) {
  const histories = ref<Record<string, UIMessage[]>>({});
  const approvals = ref<Record<string, AgentUpApprovalData>>({});
  const askUsers = ref<Record<string, AgentUpAskUserData>>({});
  const loaded = new Set<string>();
  const loadEpoch = ref<Record<string, number>>({});
  let delegationPoll: ReturnType<typeof setInterval> | undefined;
  let delegationPollKey = "";

  async function load(agentId: string, token: string, userId: string, force = false): Promise<void> {
    const key = `${userId}/${agentId}`;
    if (!force && loaded.has(key)) return;
    loaded.add(key);
    try {
      const messages = await api.history(token, agentId, userId);
      histories.value = { ...histories.value, [agentId]: messages };
      loadEpoch.value = { ...loadEpoch.value, [agentId]: (loadEpoch.value[agentId] ?? 0) + 1 };
    } catch (error) {
      loaded.delete(key);
      showToast(error instanceof DesktopApiError ? error.message : "聊天记录读取失败");
    }
  }

  async function clearContext(agentId: string, token: string, userId: string): Promise<void> {
    // 先收起浮层，避免接口失败时问卷/审批仍挂着。
    setApproval(agentId, undefined);
    setAskUser(agentId, undefined);
    await api.clearContext(token, agentId, userId);
    await load(agentId, token, userId, true);
  }

  async function clearHistory(agentId: string, token: string, userId: string): Promise<void> {
    setApproval(agentId, undefined);
    setAskUser(agentId, undefined);
    await api.clearHistory(token, agentId, userId);
    await load(agentId, token, userId, true);
  }

  function isLoaded(agentId: string, userId: string): boolean {
    return loaded.has(`${userId}/${agentId}`);
  }

  function setApproval(agentId: string, approval: AgentUpApprovalData | undefined): void {
    if (!approval) {
      const next = { ...approvals.value };
      delete next[agentId];
      approvals.value = next;
      return;
    }
    approvals.value = { ...approvals.value, [agentId]: approval };
  }

  function setAskUser(agentId: string, askUser: AgentUpAskUserData | undefined): void {
    if (!askUser) {
      const next = { ...askUsers.value };
      delete next[agentId];
      askUsers.value = next;
      return;
    }
    askUsers.value = { ...askUsers.value, [agentId]: askUser };
  }

  async function decide(
    agentId: string,
    token: string,
    allow: boolean,
    scope: ApprovalScope = "once",
  ): Promise<void> {
    const approval = approvals.value[agentId];
    if (!approval) return;
    await api.decideApproval(token, approval.id, allow, scope);
    setApproval(agentId, undefined);
  }

  async function answerAsk(
    agentId: string,
    token: string,
    answer: AskUserAnswer,
  ): Promise<void> {
    const askUser = askUsers.value[agentId];
    if (!askUser) return;
    await api.answerAskUser(token, askUser.id, answer);
    setAskUser(agentId, undefined);
  }

  function syncMessages(agentId: string, messages: UIMessage[]): void {
    histories.value = { ...histories.value, [agentId]: messages };
  }

  /** 解雇或离队后丢掉 KeepAlive 残留缓存，避免重招后仍显示旧对话。 */
  function forget(agentId: string): void {
    if (!agentId) return;
    forgetComposerDraft(agentId);
    for (const key of [...loaded]) {
      if (key.endsWith(`/${agentId}`)) loaded.delete(key);
    }
    if (agentId in histories.value) {
      const next = { ...histories.value };
      delete next[agentId];
      histories.value = next;
    }
    if (agentId in loadEpoch.value) {
      const next = { ...loadEpoch.value };
      delete next[agentId];
      loadEpoch.value = next;
    }
    setApproval(agentId, undefined);
    setAskUser(agentId, undefined);
  }

  function turnEnded(agentId: string, preview: string): void {
    options.onTurnEnd?.(agentId, preview);
  }

  /** 异步委托完成后：重载委托方历史并 toast（私人助理与第三方相同）。 */
  function watchDelegations(agentId: string, token: string, userId: string): void {
    const key = `${userId}/${agentId}`;
    if (!agentId) {
      stopDelegationWatch();
      return;
    }
    if (delegationPoll && delegationPollKey === key) return;
    stopDelegationWatch();
    delegationPollKey = key;
    const tick = async () => {
      try {
        const tasks = await api.listDelegations(token, userId, { unseenOnly: true });
        const finished = tasks.filter(
          (task) => task.status === "completed" || task.status === "failed",
        );
        if (finished.length === 0) return;
        const reloadIds = new Set<string>();
        for (const task of finished) {
          await api.acknowledgeDelegation(token, userId, task.id);
          const label = task.toAgentName || task.toAgentId;
          showToast(
            task.status === "completed"
              ? `「${label}」已完成委托任务`
              : `「${label}」委托失败`,
          );
          if (task.fromAgentId) reloadIds.add(task.fromAgentId);
        }
        for (const id of reloadIds) {
          await load(id, token, userId, true);
        }
      } catch {
        // 轮询失败静默；下一轮再试
      }
    };
    void tick();
    delegationPoll = setInterval(() => {
      void tick();
    }, DELEGATION_POLL_MS);
  }

  function stopDelegationWatch(): void {
    if (delegationPoll) clearInterval(delegationPoll);
    delegationPoll = undefined;
    delegationPollKey = "";
  }

  if (getCurrentScope()) {
    onScopeDispose(() => {
      stopDelegationWatch();
    });
  }

  return {
    histories,
    approvals,
    askUsers,
    loadEpoch,
    load,
    clearContext,
    clearHistory,
    isLoaded,
    setApproval,
    setAskUser,
    decide,
    answerAsk,
    syncMessages,
    forget,
    turnEnded,
    watchDelegations,
    stopDelegationWatch,
    api,
  };
}

import type { UIMessage } from "ai";
import { getCurrentScope, onScopeDispose, ref } from "vue";

import { DesktopApi, DesktopApiError } from "../../../shared/api/runtime";
import type {
  AgentUpApprovalData,
  AgentUpAskUserData,
  AgentUpShellHangData,
  ApprovalScope,
  AskUserAnswer,
  ShellHangAction,
} from "../../../shared/model/chat/chat";
import { showToast } from "../../../shared/model/ui/toast";
import { t, tf } from "../../../shared/model/ui/ui-locale";
import { forgetComposerDraft } from "../model/composer/composer-draft";

/** 异步完成后要较快拉到 idle wake 的助手回复。 */
const DELEGATION_POLL_MS = 2_000;

function lastAssistantPreview(messages: readonly UIMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "assistant") continue;
    const text = (message.parts ?? [])
      .map((part) => (part.type === "text" && part.text ? part.text : ""))
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (text) return text.length > 120 ? `${text.slice(0, 119)}…` : text;
  }
  return "";
}

export function useAgentChat(
  api = new DesktopApi(),
  options: { onTurnEnd?: (agentId: string, preview: string) => void } = {},
) {
  const histories = ref<Record<string, UIMessage[]>>({});
  const approvals = ref<Record<string, AgentUpApprovalData>>({});
  const askUsers = ref<Record<string, AgentUpAskUserData>>({});
  const shellHangs = ref<Record<string, AgentUpShellHangData>>({});
  const loaded = new Set<string>();
  const loadEpoch = ref<Record<string, number>>({});
  let delegationPoll: ReturnType<typeof setInterval> | undefined;
  let delegationPollKey = "";
  /** 已 toast 过的终态任务，避免未 notified 前重复打扰。 */
  const toastedAsyncIds = new Set<string>();

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
      showToast(error instanceof DesktopApiError ? error.message : "聊天记录读取失败", "error");
    }
  }

  async function abortTurn(agentId: string, token: string, userId: string): Promise<void> {
    setApproval(agentId, undefined);
    setAskUser(agentId, undefined);
    setShellHang(agentId, undefined);
    await api.abortTurn(token, agentId, userId);
  }

  async function clearContext(agentId: string, token: string, userId: string): Promise<void> {
    // 先收起浮层，避免接口失败时问卷/审批仍挂着。
    setApproval(agentId, undefined);
    setAskUser(agentId, undefined);
    setShellHang(agentId, undefined);
    await api.clearContext(token, agentId, userId);
    await load(agentId, token, userId, true);
  }

  async function clearHistory(agentId: string, token: string, userId: string): Promise<void> {
    setApproval(agentId, undefined);
    setAskUser(agentId, undefined);
    setShellHang(agentId, undefined);
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
    // 同一 id 只挂一个 agent（嵌套 HITL 曾被流+attention 双写到父子两端）。
    const next = { ...approvals.value };
    for (const [otherId, existing] of Object.entries(next)) {
      if (otherId !== agentId && existing?.id === approval.id) {
        delete next[otherId];
      }
    }
    next[agentId] = approval;
    approvals.value = next;
  }

  function setAskUser(agentId: string, askUser: AgentUpAskUserData | undefined): void {
    if (!askUser) {
      const next = { ...askUsers.value };
      delete next[agentId];
      askUsers.value = next;
      return;
    }
    const next = { ...askUsers.value };
    for (const [otherId, existing] of Object.entries(next)) {
      if (otherId !== agentId && existing?.id === askUser.id) {
        delete next[otherId];
      }
    }
    next[agentId] = askUser;
    askUsers.value = next;
  }

  function setShellHang(agentId: string, hang: AgentUpShellHangData | undefined): void {
    if (!hang) {
      const next = { ...shellHangs.value };
      delete next[agentId];
      shellHangs.value = next;
      return;
    }
    const next = { ...shellHangs.value };
    for (const [otherId, existing] of Object.entries(next)) {
      if (otherId !== agentId && existing?.id === hang.id) {
        delete next[otherId];
      }
    }
    next[agentId] = hang;
    shellHangs.value = next;
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
    clearApprovalById(approval.id);
  }

  async function answerAsk(
    agentId: string,
    token: string,
    answer: AskUserAnswer,
  ): Promise<void> {
    const askUser = askUsers.value[agentId];
    if (!askUser) return;
    await api.answerAskUser(token, askUser.id, answer);
    clearAskUserById(askUser.id);
  }

  async function decideShellHang(
    agentId: string,
    token: string,
    action: ShellHangAction,
  ): Promise<void> {
    const hang = shellHangs.value[agentId];
    if (!hang) return;
    try {
      await api.decideShellHang(token, hang.id, action);
      clearShellHangById(hang.id);
    } catch (error) {
      showToast(
        error instanceof DesktopApiError && error.message
          ? error.message
          : t("shellHangDecideFailed"),
        "error",
      );
    }
  }

  function clearApprovalById(id: string): void {
    const next = { ...approvals.value };
    let changed = false;
    for (const [key, existing] of Object.entries(next)) {
      if (existing?.id === id) {
        delete next[key];
        changed = true;
      }
    }
    if (changed) approvals.value = next;
  }

  function clearAskUserById(id: string): void {
    const next = { ...askUsers.value };
    let changed = false;
    for (const [key, existing] of Object.entries(next)) {
      if (existing?.id === id) {
        delete next[key];
        changed = true;
      }
    }
    if (changed) askUsers.value = next;
  }

  function clearShellHangById(id: string): void {
    const next = { ...shellHangs.value };
    let changed = false;
    for (const [key, existing] of Object.entries(next)) {
      if (existing?.id === id) {
        delete next[key];
        changed = true;
      }
    }
    if (changed) shellHangs.value = next;
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
    setShellHang(agentId, undefined);
  }

  function turnEnded(agentId: string, preview: string): void {
    options.onTurnEnd?.(agentId, preview);
  }

  /**
   * 异步完成后：仅在 notified（wake 已交付）时 toast + ack + 重载历史。
   * sync（wait）结果已在父 turn tool result，不 toast；若仍进 unseen 则静默 ack。
   */
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
        const [tasks, jobs] = await Promise.all([
          api.listDelegations(token, userId, { unseenOnly: true }),
          api.listBackgroundJobs(token, userId, { unseenOnly: true }),
        ]);
        const finished = tasks.filter(
          (task) =>
            task.status === "completed" ||
            task.status === "failed" ||
            task.status === "cancelled",
        );
        const finishedJobs = jobs.filter(
          (job) =>
            job.status === "completed" ||
            job.status === "failed" ||
            job.status === "cancelled",
        );
        if (finished.length === 0 && finishedJobs.length === 0) return;
        /** agentId → 用于侧栏预览的摘要（优先任务结果）。 */
        const previewByAgent = new Map<string, string>();
        const reloadIds = new Set<string>();
        for (const task of finished) {
          // sync：结果已在父 turn；勿 toast，只清 unseen（兼容旧盘数据）。
          if (task.wait) {
            await api.acknowledgeDelegation(token, userId, task.id);
            continue;
          }
          // async：等 wake 标 notified 再提示，避免未交付时反复弹、重启又弹。
          if (!task.notified) continue;
          const toastKey = `d:${task.id}`;
          if (!toastedAsyncIds.has(toastKey)) {
            toastedAsyncIds.add(toastKey);
            const label = task.toAgentName || task.toAgentId;
            showToast(
              task.status === "completed"
                ? tf("asyncDelegationDone", { name: label })
                : task.status === "cancelled"
                  ? tf("asyncDelegationCancelled", { name: label })
                  : tf("asyncDelegationFailed", { name: label }),
              task.status === "failed" ? "error" : "success",
            );
          }
          await api.acknowledgeDelegation(token, userId, task.id);
          if (task.fromAgentId) {
            reloadIds.add(task.fromAgentId);
            const hint = (task.resultSummary || task.brief || "").trim();
            if (hint && !previewByAgent.has(task.fromAgentId)) {
              previewByAgent.set(task.fromAgentId, hint);
            }
          }
        }
        for (const job of finishedJobs) {
          if (!job.notified) continue;
          const toastKey = `b:${job.id}`;
          if (!toastedAsyncIds.has(toastKey)) {
            toastedAsyncIds.add(toastKey);
            const label = job.name || job.id.slice(0, 8);
            showToast(
              job.status === "completed"
                ? tf("asyncBgDone", { name: label })
                : job.status === "cancelled"
                  ? tf("asyncBgCancelled", { name: label })
                  : tf("asyncBgFailed", { name: label }),
              job.status === "failed" ? "error" : "success",
            );
          }
          await api.acknowledgeBackgroundJob(token, userId, job.id);
          if (job.agentId) {
            reloadIds.add(job.agentId);
            const hint = (job.outputTail || job.name || job.command || "").trim();
            if (hint && !previewByAgent.has(job.agentId)) {
              previewByAgent.set(job.agentId, hint);
            }
          }
        }
        for (const id of reloadIds) {
          await load(id, token, userId, true);
          const fromHistory = lastAssistantPreview(histories.value[id] ?? []);
          const preview = fromHistory || previewByAgent.get(id) || "";
          // 与普通回合结束相同：更新侧栏预览；非当前会话则累加未读。
          if (preview) turnEnded(id, preview);
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
    toastedAsyncIds.clear();
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
    shellHangs,
    loadEpoch,
    load,
    abortTurn,
    clearContext,
    clearHistory,
    isLoaded,
    setApproval,
    setAskUser,
    setShellHang,
    decide,
    answerAsk,
    decideShellHang,
    syncMessages,
    forget,
    turnEnded,
    watchDelegations,
    stopDelegationWatch,
    api,
  };
}

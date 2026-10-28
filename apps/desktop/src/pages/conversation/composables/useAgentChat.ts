import type { UIMessage } from "ai";
import { getCurrentScope, onScopeDispose, ref } from "vue";

import { DesktopApi, DesktopApiError } from "../../../shared/api/runtime";
import type { BackgroundJobDto, DelegationTaskDto } from "../../../shared/api/runtime/chat";
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
import { THREAD_WINDOW_PAGE } from "../model/thread/thread-window";
import { mergeNewestPage } from "../model/thread/transcript-page";


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
  const historyHasMore = ref<Record<string, boolean>>({});
  const revealEarlier = ref<Record<string, number>>({});
  const approvals = ref<Record<string, AgentUpApprovalData>>({});
  const askUsers = ref<Record<string, AgentUpAskUserData>>({});
  const shellHangs = ref<Record<string, AgentUpShellHangData>>({});
  const loaded = new Set<string>();
  const loadEpoch = ref<Record<string, number>>({});
  let delegationWatchKey = "";
  /** 已 toast 过的终态任务，避免未 notified 前重复打扰。 */
  const toastedAsyncIds = new Set<string>();

  async function load(agentId: string, token: string, userId: string, force = false): Promise<void> {
    const key = `${userId}/${agentId}`;
    if (!force && loaded.has(key)) return;
    loaded.add(key);
    try {
      const page = await api.history(token, agentId, userId, { limit: THREAD_WINDOW_PAGE });
      const existing = histories.value[agentId] ?? [];
      const anchor = page.messages[0]?.id;
      const overlap = anchor ? existing.findIndex((message) => message.id === anchor) : -1;
      histories.value = { ...histories.value, [agentId]: mergeNewestPage(existing, page.messages) };
      if (overlap <= 0) {
        historyHasMore.value = { ...historyHasMore.value, [agentId]: page.hasMore };
      }
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

  function consumeReveal(agentId: string): void {
    if (!revealEarlier.value[agentId]) return;
    const next = { ...revealEarlier.value };
    delete next[agentId];
    revealEarlier.value = next;
  }

  async function loadOlder(agentId: string, token: string, userId: string): Promise<number> {
    const existing = histories.value[agentId] ?? [];
    const before = existing[0]?.id;
    if (!before || historyHasMore.value[agentId] !== true) return 0;
    try {
      const page = await api.history(token, agentId, userId, { limit: THREAD_WINDOW_PAGE, before });
      const known = new Set(existing.map((message) => message.id));
      const prepended = page.messages.filter((message) => !known.has(message.id));
      if (prepended.length === 0) {
        historyHasMore.value = { ...historyHasMore.value, [agentId]: false };
        return 0;
      }
      histories.value = { ...histories.value, [agentId]: [...prepended, ...existing] };
      historyHasMore.value = { ...historyHasMore.value, [agentId]: page.hasMore };
      revealEarlier.value = { ...revealEarlier.value, [agentId]: prepended.length };
      loadEpoch.value = { ...loadEpoch.value, [agentId]: (loadEpoch.value[agentId] ?? 0) + 1 };
      return 0;
    } catch (error) {
      showToast(error instanceof DesktopApiError ? error.message : "聊天记录读取失败", "error");
      return 0;
    }
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
    if (agentId in historyHasMore.value) {
      const next = { ...historyHasMore.value };
      delete next[agentId];
      historyHasMore.value = next;
    }
    if (agentId in revealEarlier.value) {
      const next = { ...revealEarlier.value };
      delete next[agentId];
      revealEarlier.value = next;
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
   * 绑定当前会话身份：切会话时清 toast 去重；unseen 由桌面 pulse 喂入 ingestUnseenAsync。
   */
  function watchDelegations(agentId: string, token: string, userId: string): void {
    const key = `${userId}/${agentId}`;
    if (!agentId || !token || !userId) {
      stopDelegationWatch();
      return;
    }
    if (delegationWatchKey === key) return;
    stopDelegationWatch();
    delegationWatchKey = key;
  }

  /**
   * 异步完成后：仅在 notified（wake 已交付）时 toast + ack + 重载历史。
   * sync（wait）结果已在父 turn tool result，不 toast；若仍进 unseen 则静默 ack。
   * 数据来自 `/desktop-pulse` 的 unseen 桶，不再单独轮询。
   */
  async function ingestUnseenAsync(
    token: string,
    userId: string,
    tasks: readonly DelegationTaskDto[],
    jobs: readonly BackgroundJobDto[],
  ): Promise<void> {
    if (!token || !userId) return;
    try {
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
        // 群委派终态回群，不占一对一 toast / 私聊未读（兼容旧盘未标 seen）。
        if (task.groupId) {
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
      // 处理失败静默；下一拍 pulse 再试
    }
  }

  function stopDelegationWatch(): void {
    delegationWatchKey = "";
    toastedAsyncIds.clear();
  }

  if (getCurrentScope()) {
    onScopeDispose(() => {
      stopDelegationWatch();
    });
  }

  return {
    histories,
    historyHasMore,
    revealEarlier,
    approvals,
    askUsers,
    shellHangs,
    loadEpoch,
    load,
    loadOlder,
    consumeReveal,
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
    ingestUnseenAsync,
    stopDelegationWatch,
    api,
  };
}

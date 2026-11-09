import type { ModelConfig } from "../../../config/load.js";
import { PERSONAL_ASSISTANT_ID } from "../../../local/assistant/personal-assistant.js";
import type { Visit } from "../../../package/sync.js";
import type { DelegationModelPin } from "../../model/assignment.js";
import type { DelegationProgressHub } from "../progress.js";
import type { DelegationStore } from "../store.js";
import {
  MAX_DELEGATION_FANOUT,
  type DelegateFanoutItem,
  type DelegateFanoutResult,
  type DelegationTask,
  type RecruitedAgentInfo,
} from "../types.js";
import { DelegationError } from "./errors.js";
import { AGENT_ID, mergePlanned, reuseBlockedMessage } from "./helpers.js";
import {
  liveReplyModel,
  pinForDelegation,
  type GroupSpeakerModelPlan,
} from "./model-pin.js";
import type { DelegationSteerOutcome } from "./types.js";

export type DelegateFanoutContext = {
  store: DelegationStore;
  progress: DelegationProgressHub;
  owned: Set<string>;
  userDataRoot: string;
  getModel: (task?: DelegationTask, visit?: Visit) => ModelConfig;
  listRecruited: (userId: string) => Promise<RecruitedAgentInfo[]>;
  requireGroupMember: (userId: string, groupId: string, toAgentId: string) => void;
  groupAwaitingReply?: (input: {
    userId: string;
    groupId: string;
    agentId: string;
  }) => { taskId: string; summary: string } | null;
  groupSpeakerModel?: GroupSpeakerModelPlan;
  groupStarted?: (input: { userId: string; groupId: string; taskId: string }) => void;
  steer: (input: {
    taskId: string;
    userId: string;
    fromAgentId: string;
    note: string;
  }) => Promise<DelegationSteerOutcome>;
  syncVisit: (userId: string, agentId: string) => Promise<Visit>;
  executeTask: (taskId: string, visit: Visit, signal?: AbortSignal) => Promise<void>;
};

export type DelegateFanoutInput = {
  userId: string;
  fromAgentId: string;
  items: DelegateFanoutItem[];
  wait?: boolean;
  signal?: AbortSignal;
  toolCallId?: string;
  groupId?: string;
  /** 子会话再委派时带上父工单的 pin，整条链不再回读会话模式。 */
  modelPin?: DelegationModelPin;
};

/**
 * 批量扇出：多项专家并行（受 MAX_DELEGATION_CONCURRENT 闸门）。
 * 默认 wait=false（立刻返回 task_id）；wait=true 则等全部完成。
 */
export async function runDelegateFanout(
  ctx: DelegateFanoutContext,
  input: DelegateFanoutInput,
): Promise<DelegateFanoutResult> {
  if (input.items.length === 0) {
    throw new DelegationError("tasks 不能为空");
  }
  const groupId = input.groupId;
  if (groupId) {
    for (const item of input.items) ctx.requireGroupMember(input.userId, groupId, item.toAgentId);
  }
  if (input.items.length > MAX_DELEGATION_FANOUT) {
    throw new DelegationError(`一次最多委托 ${MAX_DELEGATION_FANOUT} 个专家`);
  }

  if (groupId && ctx.groupAwaitingReply) {
    for (const item of input.items) {
      const done = ctx.groupAwaitingReply({
        userId: input.userId,
        groupId,
        agentId: item.toAgentId,
      });
      if (!done) continue;
      throw new DelegationError(
        `This member already finished task ${done.taskId} in this turn. Do not call delegate_to_agent again. Reply to the user with the result below.\n${done.summary}`,
      );
    }
  }

  const roster = await ctx.listRecruited(input.userId);
  const resolved: Array<{ toAgentId: string; toAgentName: string; brief: string }> = [];
  for (const item of input.items) {
    if (!AGENT_ID.test(item.toAgentId)) {
      throw new DelegationError(`agent_id 无效: ${item.toAgentId}`);
    }
    if (item.toAgentId === input.fromAgentId) {
      throw new DelegationError("不能委托给自己");
    }
    if (item.toAgentId === PERSONAL_ASSISTANT_ID) {
      throw new DelegationError("不能委托给私人助理");
    }
    const brief = item.brief.trim();
    if (!brief) throw new DelegationError("brief 不能为空");
    const card = roster.find((entry) => entry.agentId === item.toAgentId);
    if (!card) {
      throw new DelegationError(`目标不在可用 Agents 列表中: ${item.toAgentId}`);
    }
    resolved.push({
      toAgentId: item.toAgentId,
      toAgentName: card.remark || card.name || item.toAgentId,
      brief,
    });
  }

  // 群里只有异步：执掌者拿 task_id 结束回合，工作单交回后由群重新唤醒；模型传什么都压成 false。
  // 一对一：扇出仅显式 wait=true 才同步汇合；单项省略 wait 回落同步（避免漏参整轮空等）。
  const wait = groupId ? false : input.items.length > 1 ? input.wait === true : input.wait !== false;
  const modelPin =
    input.modelPin ??
    pinForDelegation({
      userDataRoot: ctx.userDataRoot,
      userId: input.userId,
      fromAgentId: input.fromAgentId,
      groupId,
      groupSpeakerModel: ctx.groupSpeakerModel,
    });

  const planned: Array<{
    item: (typeof resolved)[number];
    existing?: DelegationTask;
  }> = [];
  for (const item of resolved) {
    const active = ctx.store.list(input.userId).filter(
      (task) =>
        task.fromAgentId === input.fromAgentId &&
        task.toAgentId === item.toAgentId &&
        (task.status === "running" || task.status === "pending_auth"),
    );
    if (active.length > 1) {
      throw new DelegationError(
        `同一专员已有多项进行中的任务（${active.map((task) => task.id).join(", ")}）。请用 steer_delegation 指定 task_id，不要再派一次。`,
      );
    }
    const current = active[0];
    if (!current) {
      planned.push({ item });
      continue;
    }
    const outcome = await ctx.steer({
      taskId: current.id,
      userId: input.userId,
      fromAgentId: input.fromAgentId,
      note: item.brief,
    });
    if (!outcome.queued && outcome.reason === "not_started") {
      // 专员会话还没挂上 steerer（排队/刚启动）：先改 brief，开跑时 execute 会读最新 brief。
      const revised = ctx.store.update(current.id, { brief: item.brief }) ?? outcome.task;
      planned.push({ item, existing: revised });
      continue;
    }
    if (!outcome.queued) {
      throw new DelegationError(reuseBlockedMessage(outcome.reason, outcome.task.id));
    }
    // 已插入专员回合：同步改 brief，避免 check_delegation 仍显示旧需求
    const revised = ctx.store.update(current.id, { brief: item.brief }) ?? outcome.task;
    planned.push({ item, existing: revised });
  }

  const steeredTaskIds = planned.flatMap((slot) => (slot.existing ? [slot.existing.id] : []));
  const toCreate = planned.filter((slot) => !slot.existing);
  if (toCreate.length === 0) {
    return {
      tasks: planned.map((slot) => slot.existing!),
      steeredTaskIds,
    };
  }

  const created: DelegationTask[] = [];
  const visits: Visit[] = [];
  for (const slot of toCreate) {
    const item = slot.item;
    // 先落工单；真实模型等 visit 装好后用 getModel（与开跑一致），避免协助面板要等工具结果。
    const task = ctx.store.create({
      userId: input.userId,
      fromAgentId: input.fromAgentId,
      toAgentId: item.toAgentId,
      toAgentName: item.toAgentName,
      brief: item.brief,
      wait,
      groupId,
      modelPin,
      ...(input.toolCallId ? { toolCallId: input.toolCallId } : {}),
    });
    ctx.store.update(task.id, { status: "running" });
    ctx.owned.add(task.id);
    // 异步也要先在令牌仍绑定时装好 visit，避免 turn 结束后 sync 失败。
    // 子会话没装上时不要记进群，否则执掌者会空等一张永远不会交回的单。
    const visit = await ctx.syncVisit(task.userId, task.toAgentId);
    visits.push(visit);
    const live = ctx.store.get(task.id) ?? task;
    const replyModel = liveReplyModel({
      userDataRoot: ctx.userDataRoot,
      getModel: ctx.getModel,
      task: live,
      visit,
      pin: modelPin,
      userId: input.userId,
      toAgentId: item.toAgentId,
    });
    if (replyModel) {
      ctx.store.update(task.id, { replyModel });
    }
    const started = ctx.store.get(task.id) ?? live;
    ctx.progress.emitStarted({
      taskId: started.id,
      userId: started.userId,
      fromAgentId: started.fromAgentId,
      toAgentId: started.toAgentId,
      toAgentName: started.toAgentName,
      brief: started.brief,
      toolCallId: input.toolCallId ?? started.toolCallId,
      wait,
      ...(replyModel ? { replyModel } : {}),
    });
    if (groupId) {
      ctx.groupStarted?.({ userId: input.userId, groupId, taskId: task.id });
    }
    created.push(ctx.store.get(task.id)!);
  }

  const join = wait && steeredTaskIds.length === 0;
  if (!join) {
    for (let i = 0; i < created.length; i += 1) {
      const task = created[i]!;
      const visit = visits[i]!;
      void ctx.executeTask(task.id, visit, input.signal).catch(() => undefined);
    }
    return {
      tasks: mergePlanned(
        planned,
        created.map((task) => ctx.store.get(task.id)!),
      ),
      steeredTaskIds,
    };
  }

  await Promise.all(
    created.map((task, index) => ctx.executeTask(task.id, visits[index]!, input.signal)),
  );
  const done = created.map((task) => ctx.store.get(task.id)!);
  return {
    tasks: done,
    texts: done.map((task) => task.resultSummary ?? ""),
  };
}

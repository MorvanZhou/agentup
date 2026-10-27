import path from "node:path";

import type { ModelConfig } from "../../../config/load.js";
import type { Visit } from "../../../package/sync.js";
import type { ApprovalBroker } from "../../hitl/approval/index.js";
import type { ShellHangBroker } from "../../hitl/shell-hang/index.js";
import type { AskUserBroker } from "../../tools/ask-user.js";
import type { AsyncWakeItem } from "../../wake/index.js";
import type { DelegationProgressHub } from "../progress.js";
import { runDelegatedPrompt } from "../run.js";
import type { DelegationStore } from "../store.js";
import { deliverTaskArtifacts } from "./artifacts.js";
import { linkAbortSignals } from "./helpers.js";
import { afterTerminal } from "./notify.js";
import type { DelegationSlots } from "./slots.js";

export type ExecuteTaskContext = {
  store: DelegationStore;
  slots: DelegationSlots;
  controllers: Map<string, AbortController>;
  userDataRoot: string;
  getModel: () => ModelConfig;
  approvals: ApprovalBroker;
  askUser: AskUserBroker;
  shellHang?: ShellHangBroker;
  enqueueWake?: (item: AsyncWakeItem) => void;
  progress: DelegationProgressHub;
  markNested: (userId: string, parentAgentId: string, childAgentId: string) => () => void;
  bindSteer: (taskId: string, steer: (note: string) => Promise<void>) => () => void;
};

export async function executeDelegationTask(
  ctx: ExecuteTaskContext,
  taskId: string,
  visit: Visit,
  signal?: AbortSignal,
): Promise<void> {
  const task = ctx.store.get(taskId);
  if (!task) return;

  const controller = new AbortController();
  ctx.controllers.set(taskId, controller);
  const linked = linkAbortSignals(signal, controller.signal);

  try {
    await ctx.slots.acquire(task.userId, linked);
    // 排队期间被取消：acquire 抛错或状态已 cancelled
    if (ctx.store.get(taskId)?.status === "cancelled" || linked.aborted) {
      const cancelled = ctx.store.update(taskId, {
        status: "cancelled",
        error: "用户已取消",
      });
      afterTerminal(ctx.store, ctx.enqueueWake, cancelled);
      return;
    }

    const unmark = ctx.markNested(task.userId, task.fromAgentId, task.toAgentId);
    try {
      const outcome = await runDelegatedPrompt(
        visit,
        ctx.getModel(),
        task.brief,
        ctx.approvals,
        ctx.askUser,
        {
          taskId: task.id,
          parentAgentId: task.fromAgentId,
          signal: linked,
          progress: ctx.progress,
          shellHang: ctx.shellHang,
          bindSteer: (steer) => ctx.bindSteer(task.id, steer),
        },
      );
      const latest = ctx.store.get(task.id);
      if (latest?.status === "cancelled") {
        afterTerminal(ctx.store, ctx.enqueueWake, latest);
        return;
      }
      const artifactPatch = outcome.artifactsConfirmed
        ? { artifacts: outcome.artifacts }
        : {};
      const cancelled =
        linked.aborted ||
        (typeof outcome.error === "string" && /取消|abort|cancelled/i.test(outcome.error));
      if (cancelled) {
        ctx.store.update(task.id, {
          status: "cancelled",
          error: "用户已取消",
          resultSummary: outcome.text || undefined,
          ...artifactPatch,
        });
      } else if (outcome.error && !outcome.text) {
        ctx.store.update(task.id, {
          status: "failed",
          error: outcome.error,
          resultSummary: "",
          ...artifactPatch,
        });
      } else if (outcome.error) {
        ctx.store.update(task.id, {
          status: "failed",
          error: outcome.error,
          resultSummary: outcome.text,
          ...artifactPatch,
        });
      } else {
        ctx.store.update(task.id, {
          status: "completed",
          resultSummary: outcome.text,
          error: undefined,
          ...artifactPatch,
        });
      }
      const finished = ctx.store.get(task.id);
      if (finished?.wait) {
        deliverTaskArtifacts(
          ctx.store,
          ctx.userDataRoot,
          finished,
          path.join(visit.root, "cwd"),
        );
      }
      afterTerminal(ctx.store, ctx.enqueueWake, ctx.store.get(task.id));
    } catch (error) {
      const latest = ctx.store.get(task.id);
      if (latest?.status === "cancelled") {
        afterTerminal(ctx.store, ctx.enqueueWake, latest);
        return;
      }
      const aborted = linked.aborted;
      const message = aborted
        ? "用户已取消"
        : error instanceof Error && error.message
          ? error.message
          : "委托失败";
      ctx.store.update(task.id, {
        status: aborted ? "cancelled" : "failed",
        error: message,
      });
      afterTerminal(ctx.store, ctx.enqueueWake, ctx.store.get(task.id));
    } finally {
      unmark();
      ctx.slots.release(task.userId);
    }
  } catch (error) {
    // acquireSlot 因 abort 拒绝
    const latest = ctx.store.get(taskId);
    if (latest?.status === "cancelled") {
      afterTerminal(ctx.store, ctx.enqueueWake, latest);
      return;
    }
    const aborted = linked.aborted;
    const message = aborted
      ? "用户已取消"
      : error instanceof Error && error.message
        ? error.message
        : "委托失败";
    const finished = ctx.store.update(taskId, {
      status: aborted ? "cancelled" : "failed",
      error: message,
    });
    afterTerminal(ctx.store, ctx.enqueueWake, finished);
  } finally {
    ctx.controllers.delete(taskId);
  }
}

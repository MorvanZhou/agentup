import path from "node:path";

import type { ModelConfig } from "../../config/load.js";
import { loadModelConfig, loadModelConfigFromRef, type ModelRef } from "../../config/provider/index.js";
import type { Visit } from "../../package/sync.js";
import type { DelegationService } from "../delegation/index.js";
import type { DelegationTask } from "../delegation/types.js";
import { planGroupSpeakerModel, type ModelAssignmentMode } from "../model/assignment.js";
import { peekVisitModelRef, resolveVisitModelConfig } from "../model/session-model.js";
import { GroupStore } from "./store.js";
import { completedDelegationAwaitingReply } from "./wave.js";
import type { GroupEffect, GroupMember, GroupRoom } from "./types.js";
import { GroupError } from "./types.js";

export type GroupEffectListener = (result: { room: GroupRoom; effect: GroupEffect }) => void;

/** 群记录与委托终态之间的接缝。群任务不进入一对一唤醒。 */
export class GroupRooms {
  readonly store: GroupStore;

  private effectListener?: GroupEffectListener;

  constructor(
    private readonly userDataRoot: string,
    private readonly delegation: DelegationService,
  ) {
    this.store = new GroupStore(userDataRoot);
    this.delegation.setGroupSpeakerModel((input) => this.speakerPlan(input.userId, input.groupId, input.speaker));
    this.delegation.setGroupAwaitingReply((input) => {
      try {
        return completedDelegationAwaitingReply(
          this.store.get(input.userId, input.groupId),
          input.agentId,
        );
      } catch {
        return null;
      }
    });
    this.delegation.setGroupMembers(({ userId, groupId }) => {
      try {
        return this.store.get(userId, groupId).members;
      } catch {
        return undefined;
      }
    });
    this.delegation.setGroupTerminal((task) => this.acceptTerminal(task));
    this.delegation.setGroupTaskStarted((input) => {
      try {
        const room = this.store.get(input.userId, input.groupId);
        const task = this.delegation.getTask(input.taskId);
        this.store.startTask(input.userId, input.groupId, input.taskId, {
          keepSpeaking: room.holderSpeaking,
          authorId: task?.toAgentId ?? "",
          authorName: task?.toAgentName || task?.toAgentId || "",
          brief: task?.brief ?? "",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === "群不存在") return;
        console.error(
          `[runtime] 群任务登记失败 group=${input.groupId} task=${input.taskId}: ${message}`,
        );
      }
    });
    this.delegation.setGroupTaskRunning((input) => {
      try {
        this.store.markTaskRunning(input.userId, input.groupId, input.taskId);
      } catch {
        // 群已删除，或这张单已经结束。
      }
    });
    this.delegation.setGroupQueue((input) => {
      try {
        this.store.enqueue(input.userId, input.groupId, input.toAgentId, input.brief);
      } catch {
        // 群已删除，或被点名的人不是成员。
      }
    });
  }

  /** 工作单交回等晚到的 effect。由执掌者回合消费，不在这里开模型。 */
  setEffectListener(listener: GroupEffectListener): void {
    this.effectListener = listener;
  }

  create(input: {
    userId: string;
    title: string;
    members: GroupMember[];
    defaultHolderId?: string | null;
  }): GroupRoom {
    return this.store.create(input);
  }

  /** 云端元数据下拉：本机已有同 id 时不覆盖。 */
  ensureFromCloud(input: {
    id: string;
    userId: string;
    title: string;
    members: GroupMember[];
    defaultHolderId?: string | null;
  }): GroupRoom {
    return this.store.createWithId(input);
  }

  setModelMode(userId: string, groupId: string, mode: ModelAssignmentMode): GroupRoom {
    return this.store.setModelMode(userId, groupId, mode);
  }

  /** 只写本群统一模型。 */
  setModel(userId: string, groupId: string, ref: ModelRef): GroupRoom {
    return this.store.setModel(userId, groupId, ref);
  }

  /**
   * 执掌者这一轮的模型。单配走他的一对一会话。
   * 统一用本群模型；还没有时抄他当前的一对一模型落到群上，不改他的私聊，也不改设备最近使用。
   */
  resolveHolderModel(userId: string, groupId: string, visit: Visit): ModelConfig {
    if (process.env.AGENTUP_MODEL_NAME?.trim()) return loadModelConfig(this.userDataRoot);
    const speaker = peekVisitModelRef(this.userDataRoot, path.join(visit.root, "sessions"));
    const plan = this.speakerPlan(userId, groupId, speaker);
    if (plan.kind === "visit") return resolveVisitModelConfig(this.userDataRoot, visit);
    return loadModelConfigFromRef(this.userDataRoot, plan.ref);
  }

  private speakerPlan(
    userId: string,
    groupId: string,
    speaker: ModelRef | null,
  ): { kind: "visit" } | { kind: "room"; ref: ModelRef } {
    let room: GroupRoom;
    try {
      room = this.store.peek(userId, groupId);
    } catch {
      return { kind: "visit" };
    }
    const plan = planGroupSpeakerModel(this.userDataRoot, {
      mode: room.modelMode,
      roomModel: room.model,
      speaker,
    });
    if (plan.kind === "visit") return plan;
    if (plan.persist) this.store.setModel(userId, groupId, plan.ref);
    return { kind: "room", ref: plan.ref };
  }

  rename(userId: string, groupId: string, title: string): GroupRoom {
    return this.store.rename(userId, groupId, title);
  }

  setMembers(
    userId: string,
    groupId: string,
    members: GroupMember[],
    defaultHolderId?: string | null,
  ): GroupRoom {
    return this.store.setMembers(userId, groupId, members, defaultHolderId);
  }

  list(userId: string): GroupRoom[] {
    return this.store.list(userId);
  }

  get(userId: string, groupId: string): GroupRoom {
    return this.store.get(userId, groupId);
  }

  post(userId: string, groupId: string, text: string): { room: GroupRoom; effect: GroupEffect } {
    return this.store.post(userId, groupId, text);
  }

  replaceMessage(
    userId: string,
    groupId: string,
    messageId: string,
    text: string,
  ): { room: GroupRoom; effect: GroupEffect } {
    const result = this.store.replaceMessage(userId, groupId, messageId, text);
    for (const taskId of result.cancelledTaskIds) {
      try {
        this.delegation.cancel(taskId, userId);
      } catch {
        // 任务已经结束或不在本机表里。
      }
    }
    return { room: result.room, effect: result.effect };
  }

  cancelQueue(userId: string, groupId: string, queueId: string): GroupRoom {
    return this.store.cancelQueueItem(userId, groupId, queueId);
  }

  /** 停掉这个群还在跑的工作单，再删掉群记录和目录。 */
  remove(userId: string, groupId: string): void {
    this.store.peek(userId, groupId);
    for (const task of this.delegation.listTasks(userId)) {
      if (task.groupId !== groupId) continue;
      if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") continue;
      try {
        this.delegation.cancel(task.id, userId);
      } catch {
        // 任务已经结束或不在本机表里。
      }
    }
    this.store.remove(userId, groupId);
  }

  stop(userId: string, groupId: string): GroupRoom {
    const room = this.store.get(userId, groupId);
    for (const taskId of room.taskIds) {
      try {
        this.delegation.cancel(taskId, userId);
      } catch {
        // 任务已经结束或不在本机表里。
      }
    }
    return this.store.stop(userId, groupId);
  }

  /**
   * 执掌者派出一名子 Agent。brief 只取正文，群记录不进入子会话。
   * 已有进行中的单时可以再派别人；同一人已有一张单时由委托层改那张单。
   */
  async assign(
    userId: string,
    groupId: string,
    toAgentId: string,
    brief: string,
  ): Promise<GroupRoom> {
    const room = this.store.get(userId, groupId);
    if (!room.holderId) throw new GroupError("没有执掌者");
    const task = await this.delegation.delegate({
      userId,
      fromAgentId: room.holderId,
      toAgentId,
      brief: this.store.subBrief(brief),
      wait: false,
      groupId: room.id,
    });
    return this.store.startTask(userId, groupId, task.task.id);
  }

  /** 群内后台任务结束。群已删除时丢弃，不回到一对一。 */
  acceptBackground(userId: string, groupId: string, text: string): void {
    try {
      const result = this.store.noteExternal(userId, groupId, text);
      this.effectListener?.(result);
    } catch {
      // 群已删除。
    }
  }

  private acceptTerminal(task: DelegationTask): void {
    if (!task.groupId) return;
    try {
      const outcome =
        task.status === "failed" || task.status === "cancelled" ? task.status : "completed";
      const result = this.store.finishTask(
        task.userId,
        task.groupId,
        task.id,
        task.resultSummary || task.error || "已交回",
        Date.now(),
        outcome,
      );
      this.effectListener?.(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "群不存在") return;
      console.error(`[runtime] 群任务交回失败 group=${task.groupId} task=${task.id}: ${message}`);
    }
  }
}

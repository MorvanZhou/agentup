import type { DelegationService } from "../delegation/index.js";
import type { DelegationTask } from "../delegation/types.js";
import { GroupStore } from "./store.js";
import type { GroupEffect, GroupMember, GroupRoom } from "./types.js";
import { GroupError } from "./types.js";

export type GroupEffectListener = (result: { room: GroupRoom; effect: GroupEffect }) => void;

/** 群记录与委托终态之间的接缝。群任务不进入一对一唤醒。 */
export class GroupRooms {
  readonly store: GroupStore;

  private effectListener?: GroupEffectListener;

  constructor(
    userDataRoot: string,
    private readonly delegation: DelegationService,
  ) {
    this.store = new GroupStore(userDataRoot);
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

  create(input: { userId: string; title: string; members: GroupMember[] }): GroupRoom {
    return this.store.create(input);
  }

  rename(userId: string, groupId: string, title: string): GroupRoom {
    return this.store.rename(userId, groupId, title);
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

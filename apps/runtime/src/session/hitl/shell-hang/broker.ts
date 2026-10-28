import { randomUUID } from "node:crypto";
import type { ChildProcess } from "node:child_process";

import { killProcessTree } from "./process-kill.js";
import type { ParkedShellHang, ShellHangDecision, ShellHangRequest } from "./types.js";

const OUTPUT_TAIL_MAX = 8_000;

export type ParkInput = {
  userId: string;
  agentId: string;
  toolCallId: string;
  toolName: string;
  command: string;
  cwd: string;
  child: ChildProcess;
  startedAt: number;
  /** 拆出前已有的输出（bash accumulator 未必同步，可空）。 */
  outputSoFar?: string;
  origin?: ShellHangRequest["origin"];
  taskId?: string;
  parentAgentId?: string;
  groupId?: string;
};

export type WaitMoreResult =
  | { kind: "exited"; exitCode: number | null; outputTail: string }
  | { kind: "idle"; hang: ParkedShellHang }
  | { kind: "aborted"; outputTail: string }
  | { kind: "missing" };

type HumanPending = {
  request: ShellHangRequest;
  resolve: (decision: ShellHangDecision | undefined) => void;
};

type ParkedSlot = {
  hang: ParkedShellHang;
  child: ChildProcess;
  /** 人审 escalate 定时器。 */
  escalateTimer?: ReturnType<typeof setTimeout>;
  /** waitMore 时的空闲定时器。 */
  idleTimer?: ReturnType<typeof setTimeout>;
  exitWaiters: Array<(code: number | null) => void>;
  exited: boolean;
  exitCode: number | null;
};

/**
 * 阻塞 shell 空闲挂起 + 人审兜底（仅内存）。
 * 空闲后进程被 park：bash 先返回，由 agent 调 shell_hang_decide；超时无人决再弹人审。
 */
export class ShellHangBroker {
  private readonly parked = new Map<string, ParkedSlot>();
  private readonly byToolCall = new Map<string, string>();
  private readonly humanPending = new Map<string, HumanPending>();
  private readonly listeners = new Set<(request: ShellHangRequest) => void>();
  private humanEscalateMs = 60_000;

  setHumanEscalateMs(ms: number): void {
    this.humanEscalateMs = Math.max(1, ms);
  }

  /**
   * 空闲拆出：进程继续跑，返回 hang id；并启动人审 escalate 计时。
   */
  park(input: ParkInput): ParkedShellHang {
    const pid = input.child.pid;
    if (pid == null) {
      throw new Error("cannot park shell without pid");
    }
    // 同一 toolCall 重复 park 时先清旧的。
    const existingId = this.byToolCall.get(input.toolCallId);
    if (existingId) this.killParked(existingId, "replaced");

    const id = randomUUID();
    const hang: ParkedShellHang = {
      id,
      userId: input.userId,
      agentId: input.agentId,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      command: input.command,
      pid,
      cwd: input.cwd,
      startedAt: input.startedAt,
      parkedAt: Date.now(),
      outputTail: (input.outputSoFar ?? "").slice(-OUTPUT_TAIL_MAX),
      waitCount: 0,
      ...(input.origin ? { origin: input.origin } : {}),
      ...(input.taskId ? { taskId: input.taskId } : {}),
      ...(input.parentAgentId ? { parentAgentId: input.parentAgentId } : {}),
      ...(input.groupId ? { groupId: input.groupId } : {}),
    };

    const slot: ParkedSlot = {
      hang,
      child: input.child,
      exitWaiters: [],
      exited: false,
      exitCode: null,
    };

    const append = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (!text) return;
      hang.outputTail = (hang.outputTail + text).slice(-OUTPUT_TAIL_MAX);
    };
    input.child.stdout?.on("data", append);
    input.child.stderr?.on("data", append);
    input.child.once("close", (code) => {
      slot.exited = true;
      slot.exitCode = code;
      if (slot.idleTimer) clearTimeout(slot.idleTimer);
      if (slot.escalateTimer) clearTimeout(slot.escalateTimer);
      const waiters = slot.exitWaiters.splice(0);
      for (const w of waiters) w(code);
      // 进程已死：取消人审；仍保留 hang，供 agent 的 shell_hang_decide 读尾部。
      this.clearHumanForHang(id);
    });

    this.parked.set(id, slot);
    this.byToolCall.set(input.toolCallId, id);
    this.armHumanEscalate(id);
    return hang;
  }

  getParked(id: string): ParkedShellHang | undefined {
    return this.parked.get(id)?.hang;
  }

  getParkedByToolCall(toolCallId: string): ParkedShellHang | undefined {
    const id = this.byToolCall.get(toolCallId);
    return id ? this.parked.get(id)?.hang : undefined;
  }

  listParked(userId: string, agentId?: string): ParkedShellHang[] {
    const out: ParkedShellHang[] = [];
    for (const { hang } of this.parked.values()) {
      if (hang.userId !== userId) continue;
      if (agentId && hang.agentId !== agentId) continue;
      out.push(hang);
    }
    return out;
  }

  /**
   * Agent / 人审共用：kill 杀进程；bg 取消 escalate 留下进程；wait 仅人审时延长 escalate。
   * Agent 的 wait 走 {@link waitMore}。
   */
  decide(id: string, decision: ShellHangDecision): boolean {
    const human = this.humanPending.get(id);
    if (human) {
      this.humanPending.delete(id);
      human.resolve(decision);
    }

    const slot = this.parked.get(id);
    if (!slot) return Boolean(human);

    if (decision === "kill") {
      this.killParked(id, "decided");
      return true;
    }
    if (decision === "bg") {
      this.detachParked(id);
      return true;
    }
    // wait（人审）：再给一个 escalate 窗口
    if (decision === "wait") {
      slot.hang.waitCount += 1;
      this.armHumanEscalate(id);
      return true;
    }
    return true;
  }

  /**
   * Agent 选择再等：阻塞到退出、再次空闲、或 abort。
   */
  waitMore(
    id: string,
    idleMs: number,
    signal?: AbortSignal,
  ): Promise<WaitMoreResult> {
    const slot = this.parked.get(id);
    if (!slot) return Promise.resolve({ kind: "missing" });
    if (slot.exited) {
      const hang = slot.hang;
      this.forgetParked(id);
      return Promise.resolve({
        kind: "exited",
        exitCode: slot.exitCode,
        outputTail: hang.outputTail,
      });
    }

    slot.hang.waitCount += 1;
    // 人审 escalate 在 agent 主动 wait 期间推迟
    if (slot.escalateTimer) clearTimeout(slot.escalateTimer);

    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: WaitMoreResult) => {
        if (settled) return;
        settled = true;
        if (slot.idleTimer) {
          clearTimeout(slot.idleTimer);
          slot.idleTimer = undefined;
        }
        signal?.removeEventListener("abort", onAbort);
        resolve(result);
      };

      const onAbort = () => {
        finish({ kind: "aborted", outputTail: slot.hang.outputTail });
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });

      const onExit = (code: number | null) => {
        const hang = slot.hang;
        this.forgetParked(id);
        finish({ kind: "exited", exitCode: code, outputTail: hang.outputTail });
      };
      slot.exitWaiters.push(onExit);

      const armIdle = () => {
        if (slot.idleTimer) clearTimeout(slot.idleTimer);
        slot.idleTimer = setTimeout(() => {
          // 仍在跑 → 再次空闲；重新 arm 人审 escalate
          this.armHumanEscalate(id);
          // 去掉本次 exit waiter，避免泄漏
          const idx = slot.exitWaiters.indexOf(onExit);
          if (idx >= 0) slot.exitWaiters.splice(idx, 1);
          finish({ kind: "idle", hang: { ...slot.hang } });
        }, idleMs);
      };
      armIdle();

      const bump = () => {
        if (!settled) armIdle();
      };
      slot.child.stdout?.on("data", bump);
      slot.child.stderr?.on("data", bump);
    });
  }

  /** 工具已正常结束（非 park）：取消对应悬空人审。 */
  cancelForToolCall(toolCallId: string): void {
    for (const [id, pending] of [...this.humanPending.entries()]) {
      if (pending.request.toolCallId !== toolCallId) continue;
      this.humanPending.delete(id);
      pending.resolve(undefined);
    }
  }

  /** 人审：列出待决（含 escalate 弹出的）。 */
  listPending(userId: string): ShellHangRequest[] {
    const out: ShellHangRequest[] = [];
    for (const { request } of this.humanPending.values()) {
      if (request.userId === userId) out.push(request);
    }
    return out;
  }

  subscribe(listener: (request: ShellHangRequest) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 会话结束：杀掉所有本 agent 的 park。 */
  disposeAgent(userId: string, agentId: string): void {
    for (const [id, slot] of [...this.parked.entries()]) {
      if (slot.hang.userId !== userId || slot.hang.agentId !== agentId) continue;
      this.killParked(id, "dispose");
    }
  }

  private armHumanEscalate(id: string): void {
    const slot = this.parked.get(id);
    if (!slot || slot.exited) return;
    if (slot.escalateTimer) clearTimeout(slot.escalateTimer);
    slot.escalateTimer = setTimeout(() => {
      this.openHumanRequest(id);
    }, this.humanEscalateMs);
  }

  private openHumanRequest(id: string): void {
    const slot = this.parked.get(id);
    if (!slot || slot.exited) return;
    if (this.humanPending.has(id)) return;

    const hang = slot.hang;
    const request: ShellHangRequest = {
      id,
      userId: hang.userId,
      agentId: hang.agentId,
      toolCallId: hang.toolCallId,
      toolName: hang.toolName,
      command: hang.command,
      elapsedMs: Date.now() - hang.startedAt,
      ...(hang.origin ? { origin: hang.origin } : {}),
      ...(hang.taskId ? { taskId: hang.taskId } : {}),
      ...(hang.parentAgentId ? { parentAgentId: hang.parentAgentId } : {}),
      ...(hang.groupId ? { groupId: hang.groupId } : {}),
    };

    this.humanPending.set(id, {
      request,
      resolve: (decision) => {
        // decide() 已处理 kill/wait/bg；此处仅保证 Promise 形态兼容旧测试。
        void decision;
      },
    });
    for (const listener of this.listeners) listener(request);
  }

  private killParked(id: string, _reason: string): void {
    const slot = this.parked.get(id);
    if (!slot) return;
    if (slot.escalateTimer) clearTimeout(slot.escalateTimer);
    if (slot.idleTimer) clearTimeout(slot.idleTimer);
    this.clearHumanForHang(id);
    if (!slot.exited && slot.hang.pid > 0) {
      killProcessTree(slot.hang.pid);
    }
    this.forgetParked(id);
  }

  /** bg：不再跟踪、不杀；取消人审。 */
  private detachParked(id: string): void {
    const slot = this.parked.get(id);
    if (!slot) return;
    if (slot.escalateTimer) clearTimeout(slot.escalateTimer);
    if (slot.idleTimer) clearTimeout(slot.idleTimer);
    this.clearHumanForHang(id);
    // 去掉 close 后的自动清理以外的引用
    this.forgetParked(id);
  }

  private forgetParked(id: string): void {
    const slot = this.parked.get(id);
    if (!slot) return;
    this.parked.delete(id);
    this.byToolCall.delete(slot.hang.toolCallId);
  }

  private clearHumanForHang(id: string): void {
    const pending = this.humanPending.get(id);
    if (!pending) return;
    this.humanPending.delete(id);
    pending.resolve(undefined);
  }
}

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { isLocalAgentId } from "../../local/agents/local-agent.js";
import { PERSONAL_ASSISTANT_ID } from "../../local/assistant/personal-assistant.js";
import { spawnArgsForCommand } from "../environment.js";
import type { AsyncWakeItem } from "../wake/index.js";
import { BackgroundJobStore } from "./store.js";
import {
  BACKGROUND_RESULT_CUSTOM_TYPE,
  MAX_BACKGROUND_CONCURRENT,
  MAX_BACKGROUND_OUTPUT_TAIL,
  type BackgroundJob,
  type BackgroundJobStatus,
} from "./types.js";

export { BACKGROUND_RESULT_CUSTOM_TYPE, MAX_BACKGROUND_CONCURRENT };

export type BackgroundJobsOptions = {
  userDataRoot: string;
  /** 完成后排队空闲唤醒（不写可见历史气泡）。 */
  enqueueWake?: (item: AsyncWakeItem) => void;
};

type RunningSlot = {
  child: ChildProcess;
  logFd?: number;
};

/**
 * 非专家后台 shell 作业：bg_run 立刻返回 job_id，完成后回注发起方会话。
 * 不装 pi-background-tasks；契约对齐其 spawn / status / kill。
 */
export class BackgroundJobs {
  private readonly store: BackgroundJobStore;
  private readonly running = new Map<string, RunningSlot>();
  private readonly activeByUser = new Map<string, number>();
  private readonly waiters = new Map<string, Array<() => void>>();

  constructor(private readonly options: BackgroundJobsOptions) {
    this.store = new BackgroundJobStore(options.userDataRoot);
  }

  list(
    userId: string,
    options: {
      unseenOnly?: boolean;
      status?: BackgroundJobStatus;
      agentId?: string;
    } = {},
  ): BackgroundJob[] {
    return this.store.list(userId, options);
  }

  get(jobId: string): BackgroundJob | undefined {
    return this.store.get(jobId);
  }

  acknowledge(jobId: string): BackgroundJob | undefined {
    return this.store.update(jobId, { seen: true });
  }

  /**
   * 启动后台命令。审批在 tool_call 钩子（bg_run 视同主 shell 工具）。
   * 经 detectHostEnvironment 的 command tool spawn（Windows 不用 cmd）。
   * cwd 必须已由调用方解析为 visit 的 cwd。
   */
  async start(input: {
    userId: string;
    agentId: string;
    command: string;
    cwd: string;
    name?: string;
  }): Promise<BackgroundJob> {
    const command = input.command.trim();
    if (!command) throw new BackgroundJobError("command 不能为空");
    const cwd = path.resolve(input.cwd);
    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
      throw new BackgroundJobError("工作目录无效");
    }
    const name = (input.name?.trim() || summarizeCommand(command)).slice(0, 80);
    const job = this.store.create({
      userId: input.userId,
      agentId: input.agentId,
      name,
      command,
      cwd,
    });
    this.store.update(job.id, { status: "running" });
    void this.execute(job.id).catch(() => undefined);
    return this.store.get(job.id)!;
  }

  cancel(jobId: string, userId: string): BackgroundJob {
    this.store.list(userId);
    const job = this.store.get(jobId);
    if (!job || job.userId !== userId) {
      throw new BackgroundJobError("后台任务不存在");
    }
    if (
      job.status === "completed" ||
      job.status === "failed" ||
      job.status === "cancelled"
    ) {
      return job;
    }
    const slot = this.running.get(jobId);
    if (slot) {
      try {
        slot.child.kill("SIGTERM");
        setTimeout(() => {
          try {
            if (!slot.child.killed) slot.child.kill("SIGKILL");
          } catch {
            // ignore
          }
        }, 2000).unref?.();
      } catch {
        // ignore
      }
    }
    const updated =
      this.store.update(jobId, {
        status: "cancelled",
        error: "用户已取消",
      }) ?? job;
    this.notifyOwner(updated);
    return this.store.get(jobId) ?? updated;
  }

  readLogTail(jobId: string, userId: string, maxChars = MAX_BACKGROUND_OUTPUT_TAIL): string {
    this.store.list(userId);
    const job = this.store.get(jobId);
    if (!job || job.userId !== userId) return "";
    if (job.outputTail) return job.outputTail.slice(-maxChars);
    const logPath = this.store.logPath(userId, jobId);
    if (!logPath || !fs.existsSync(logPath)) return "";
    try {
      const raw = fs.readFileSync(logPath, "utf8");
      return raw.slice(-maxChars);
    } catch {
      return "";
    }
  }

  private async execute(jobId: string): Promise<void> {
    const job = this.store.get(jobId);
    if (!job) return;

    await this.acquire(job.userId);
    const latest = this.store.get(jobId);
    if (!latest || latest.status === "cancelled") {
      this.release(job.userId);
      if (latest && !latest.notified) this.notifyOwner(latest);
      return;
    }

    const logPath = this.store.logPath(job.userId, jobId);
    let logFd: number | undefined;
    try {
      if (logPath) {
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        logFd = fs.openSync(logPath, "w", 0o600);
      }

      const spawnSpec = spawnArgsForCommand(latest.command);
      const child = spawn(spawnSpec.file, spawnSpec.args, {
        cwd: latest.cwd,
        env: process.env,
        stdio: [spawnSpec.stdinCommand != null ? "pipe" : "ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      if (spawnSpec.stdinCommand != null) {
        child.stdin?.on("error", () => {});
        child.stdin?.end(spawnSpec.stdinCommand);
      }
      this.running.set(jobId, { child, logFd });

      const chunks: Buffer[] = [];
      const onData = (chunk: Buffer) => {
        chunks.push(chunk);
        if (logFd !== undefined) {
          try {
            fs.writeSync(logFd, chunk);
          } catch {
            // ignore
          }
        }
        // 控制内存：只保留尾部
        const total = chunks.reduce((sum, item) => sum + item.length, 0);
        if (total > MAX_BACKGROUND_OUTPUT_TAIL * 2) {
          const joined = Buffer.concat(chunks);
          chunks.length = 0;
          chunks.push(joined.subarray(-MAX_BACKGROUND_OUTPUT_TAIL));
        }
      };
      child.stdout?.on("data", onData);
      child.stderr?.on("data", onData);

      const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
        (resolve) => {
          child.on("error", (error) => {
            chunks.push(Buffer.from(error.message || "spawn failed"));
            resolve({ code: 1, signal: null });
          });
          child.on("close", (code, signal) => resolve({ code, signal }));
        },
      );

      const current = this.store.get(jobId);
      if (current?.status === "cancelled") {
        const tail = Buffer.concat(chunks).toString("utf8").slice(-MAX_BACKGROUND_OUTPUT_TAIL);
        this.store.update(jobId, { outputTail: tail || current.outputTail });
        this.notifyOwner(this.store.get(jobId)!);
        return;
      }

      const tail = Buffer.concat(chunks).toString("utf8").slice(-MAX_BACKGROUND_OUTPUT_TAIL);
      const signalKill = exit.signal != null;
      const failed = signalKill || (exit.code !== 0 && exit.code !== null);
      this.store.update(jobId, {
        status: failed ? "failed" : "completed",
        exitCode: exit.code,
        outputTail: tail,
        error: failed
          ? signalKill
            ? `进程被信号终止 (${exit.signal})`
            : `退出码 ${exit.code}`
          : undefined,
      });
      this.notifyOwner(this.store.get(jobId)!);
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : "后台任务失败";
      const current = this.store.get(jobId);
      if (current?.status === "cancelled") {
        this.notifyOwner(current);
        return;
      }
      this.store.update(jobId, { status: "failed", error: message });
      const finished = this.store.get(jobId);
      if (finished) this.notifyOwner(finished);
    } finally {
      const slot = this.running.get(jobId);
      if (slot?.logFd !== undefined) {
        try {
          fs.closeSync(slot.logFd);
        } catch {
          // ignore
        }
      }
      this.running.delete(jobId);
      this.release(job.userId);
    }
  }

  private async acquire(userId: string): Promise<void> {
    const active = this.activeByUser.get(userId) ?? 0;
    if (active < MAX_BACKGROUND_CONCURRENT) {
      this.activeByUser.set(userId, active + 1);
      return;
    }
    await new Promise<void>((resolve) => {
      const waiters = this.waiters.get(userId) ?? [];
      waiters.push(() => {
        const current = this.activeByUser.get(userId) ?? 0;
        this.activeByUser.set(userId, current + 1);
        resolve();
      });
      this.waiters.set(userId, waiters);
    });
  }

  private release(userId: string): void {
    const active = this.activeByUser.get(userId) ?? 0;
    const next = Math.max(0, active - 1);
    if (next === 0) this.activeByUser.delete(userId);
    else this.activeByUser.set(userId, next);
    const waiters = this.waiters.get(userId);
    const resume = waiters?.shift();
    if (waiters && waiters.length === 0) this.waiters.delete(userId);
    resume?.();
  }

  /** 完成后排队空闲唤醒（不写可见历史气泡）。 */
  notifyOwner(job: BackgroundJob): void {
    if (job.notified) return;
    if (
      job.status !== "completed" &&
      job.status !== "failed" &&
      job.status !== "cancelled"
    ) {
      return;
    }
    if (!this.options.enqueueWake) return;
    const personal = job.agentId === PERSONAL_ASSISTANT_ID;
    const kind: AsyncWakeItem["kind"] = personal
      ? "personal"
      : isLocalAgentId(job.agentId)
        ? "local"
        : "recruited";
    const label = job.name || job.id.slice(0, 8);
    const body =
      job.status === "completed"
        ? `【后台任务完成】${label}\n\n命令：${job.command}\n退出码：${job.exitCode ?? 0}` +
          (job.outputTail ? `\n\n输出摘要：\n${job.outputTail}` : "")
        : job.status === "cancelled"
          ? `【后台任务已取消】${label}\n\n命令：${job.command}`
          : `【后台任务失败】${label}\n\n命令：${job.command}\n原因：${job.error ?? "未知"}` +
            (job.outputTail ? `\n\n输出摘要：\n${job.outputTail}` : "");
    this.options.enqueueWake({
      id: `background:${job.id}`,
      userId: job.userId,
      agentId: job.agentId,
      kind,
      urgency: job.status === "completed" ? "batch" : "immediate",
      body,
      details: {
        customType: BACKGROUND_RESULT_CUSTOM_TYPE,
        jobId: job.id,
        name: job.name,
        status: job.status,
        command: job.command,
      },
      markDelivered: () => {
        this.store.update(job.id, { notified: true });
      },
    });
  }
}

export class BackgroundJobError extends Error {}

function summarizeCommand(command: string): string {
  const one = command.replace(/\s+/g, " ").trim();
  return one.length > 48 ? `${one.slice(0, 47)}…` : one;
}

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { BackgroundJob, BackgroundJobStatus } from "./types.js";

const LOOSE_USER = /^[A-Za-z0-9_@.-]+$/;

/** 进程内 + 落盘后台作业表。 */
export class BackgroundJobStore {
  private readonly jobs = new Map<string, BackgroundJob>();

  constructor(private readonly userDataRoot?: string) {}

  create(input: {
    userId: string;
    agentId: string;
    name: string;
    command: string;
    cwd: string;
  }): BackgroundJob {
    const now = Date.now();
    const job: BackgroundJob = {
      id: randomUUID(),
      userId: input.userId,
      agentId: input.agentId,
      name: input.name,
      command: input.command,
      cwd: input.cwd,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      seen: false,
      notified: false,
    };
    this.jobs.set(job.id, job);
    this.persist(job);
    return job;
  }

  get(id: string): BackgroundJob | undefined {
    return this.jobs.get(id);
  }

  update(
    id: string,
    patch: Partial<
      Pick<
        BackgroundJob,
        "status" | "exitCode" | "outputTail" | "error" | "seen" | "notified" | "name"
      >
    >,
  ): BackgroundJob | undefined {
    const current = this.get(id);
    if (!current) return undefined;
    const next: BackgroundJob = {
      ...current,
      ...patch,
      updatedAt: Date.now(),
    };
    this.jobs.set(id, next);
    this.persist(next);
    return next;
  }

  list(
    userId: string,
    options: {
      unseenOnly?: boolean;
      status?: BackgroundJobStatus;
      agentId?: string;
    } = {},
  ): BackgroundJob[] {
    this.loadUser(userId);
    const items = [...this.jobs.values()].filter((job) => {
      if (job.userId !== userId) return false;
      if (options.unseenOnly && job.seen) return false;
      if (options.status && job.status !== options.status) return false;
      if (options.agentId && job.agentId !== options.agentId) return false;
      return true;
    });
    items.sort((left, right) => right.updatedAt - left.updatedAt);
    return items;
  }

  logPath(userId: string, jobId: string): string | undefined {
    if (!this.userDataRoot) return undefined;
    return path.join(this.dir(userId), `${jobId}.log`);
  }

  private persist(job: BackgroundJob): void {
    if (!this.userDataRoot) return;
    if (!isSafeUserId(job.userId)) return;
    const dir = this.dir(job.userId);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${job.id}.json`);
    const temporary = `${file}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(job, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, file);
  }

  private dir(userId: string): string {
    return path.join(this.userDataRoot!, "users", userId, ".runtime", "background");
  }

  private loadUser(userId: string): void {
    if (!this.userDataRoot || !isSafeUserId(userId)) return;
    const dir = this.dir(userId);
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      const id = name.slice(0, -".json".length);
      if (this.jobs.has(id)) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as BackgroundJob;
        if (raw && raw.id === id && raw.userId === userId) {
          this.jobs.set(id, raw);
        }
      } catch {
        // 忽略坏文件
      }
    }
  }
}

function isSafeUserId(userId: string): boolean {
  return LOOSE_USER.test(userId) && userId !== "." && userId !== "..";
}

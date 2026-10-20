import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { DelegationStatus, DelegationTask } from "./types.js";

const AGENT_ID = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;

/** 进程内任务表；可选落盘到用户目录便于重启后查询。 */
export class DelegationStore {
  private readonly tasks = new Map<string, DelegationTask>();

  constructor(private readonly userDataRoot?: string) {}

  create(input: {
    userId: string;
    fromAgentId: string;
    toAgentId: string;
    toAgentName: string;
    brief: string;
    wait: boolean;
  }): DelegationTask {
    const now = Date.now();
    const task: DelegationTask = {
      id: randomUUID(),
      userId: input.userId,
      fromAgentId: input.fromAgentId,
      toAgentId: input.toAgentId,
      toAgentName: input.toAgentName,
      brief: input.brief,
      status: "pending_auth",
      createdAt: now,
      updatedAt: now,
      wait: input.wait,
      seen: false,
      notified: false,
    };
    this.tasks.set(task.id, task);
    this.persist(task);
    return task;
  }

  get(id: string): DelegationTask | undefined {
    return this.tasks.get(id) ?? this.load(id);
  }

  update(
    id: string,
    patch: Partial<
      Pick<
        DelegationTask,
        "status" | "resultSummary" | "error" | "seen" | "notified" | "toAgentName"
      >
    >,
  ): DelegationTask | undefined {
    const current = this.get(id);
    if (!current) return undefined;
    const next: DelegationTask = {
      ...current,
      ...patch,
      updatedAt: Date.now(),
    };
    this.tasks.set(id, next);
    this.persist(next);
    return next;
  }

  list(
    userId: string,
    options: { unseenOnly?: boolean; status?: DelegationStatus } = {},
  ): DelegationTask[] {
    this.loadUser(userId);
    const items = [...this.tasks.values()].filter((task) => {
      if (task.userId !== userId) return false;
      if (options.unseenOnly && task.seen) return false;
      if (options.status && task.status !== options.status) return false;
      return true;
    });
    items.sort((left, right) => right.updatedAt - left.updatedAt);
    return items;
  }

  private persist(task: DelegationTask): void {
    if (!this.userDataRoot) return;
    if (!AGENT_ID.test(task.userId) && !isLooseUserId(task.userId)) return;
    const dir = path.join(this.userDataRoot, "users", task.userId, ".runtime", "delegations");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${task.id}.json`);
    const temporary = `${file}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(task, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, file);
  }

  private load(id: string): DelegationTask | undefined {
    if (!this.userDataRoot || !id) return undefined;
    // 无 userId 时无法定位；仅从内存取。
    return undefined;
  }

  private loadUser(userId: string): void {
    if (!this.userDataRoot) return;
    if (!isLooseUserId(userId)) return;
    const dir = path.join(this.userDataRoot, "users", userId, ".runtime", "delegations");
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      const id = name.slice(0, -".json".length);
      if (this.tasks.has(id)) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as unknown;
        const task = parseTask(raw);
        if (task) this.tasks.set(task.id, task);
      } catch {
        // 忽略损坏文件
      }
    }
  }
}

function isLooseUserId(userId: string): boolean {
  return Boolean(userId) && userId !== "." && userId !== ".." && !/[/\\\u0000]/.test(userId);
}

function parseTask(raw: unknown): DelegationTask | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== "string" || !value.id) return undefined;
  if (typeof value.userId !== "string") return undefined;
  if (typeof value.fromAgentId !== "string") return undefined;
  if (typeof value.toAgentId !== "string") return undefined;
  if (typeof value.brief !== "string") return undefined;
  const status = value.status;
  if (
    status !== "pending_auth" &&
    status !== "running" &&
    status !== "completed" &&
    status !== "failed" &&
    status !== "cancelled"
  ) {
    return undefined;
  }
  return {
    id: value.id,
    userId: value.userId,
    fromAgentId: value.fromAgentId,
    toAgentId: value.toAgentId,
    toAgentName: typeof value.toAgentName === "string" ? value.toAgentName : value.toAgentId,
    brief: value.brief,
    status,
    createdAt: numberOr(value.createdAt, Date.now()),
    updatedAt: numberOr(value.updatedAt, Date.now()),
    wait: value.wait !== false,
    resultSummary: typeof value.resultSummary === "string" ? value.resultSummary : undefined,
    error: typeof value.error === "string" ? value.error : undefined,
    seen: value.seen === true,
    notified: value.notified === true,
  };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

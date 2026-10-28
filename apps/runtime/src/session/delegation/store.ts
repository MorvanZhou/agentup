import fs from "node:fs";
import path from "node:path";

import { SHORT_ID_SIZE, shortId } from "../../ids/short-id.js";
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
    groupId?: string;
  }): DelegationTask {
    const now = Date.now();
    const task: DelegationTask = {
      id: this.allocateId(input.userId),
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
      groupId: input.groupId,
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
        | "status"
        | "resultSummary"
        | "error"
        | "seen"
        | "notified"
        | "toAgentName"
        | "artifacts"
        | "artifactsDelivered"
        | "groupId"
        | "brief"
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
    options: {
      unseenOnly?: boolean;
      status?: DelegationStatus;
      fromAgentId?: string;
      groupId?: string;
    } = {},
  ): DelegationTask[] {
    this.loadUser(userId);
    const items = [...this.tasks.values()].filter((task) => {
      if (task.userId !== userId) return false;
      if (options.unseenOnly && task.seen) return false;
      if (options.status && task.status !== options.status) return false;
      if (options.fromAgentId && task.fromAgentId !== options.fromAgentId) return false;
      if (options.groupId && task.groupId !== options.groupId) return false;
      return true;
    });
    items.sort((left, right) => right.updatedAt - left.updatedAt);
    return items;
  }

  /** 本机 `users/` 下可加载委托的账号目录。 */
  listUserIds(): string[] {
    if (!this.userDataRoot) return [];
    const users = path.join(this.userDataRoot, "users");
    if (!fs.existsSync(users)) return [];
    const ids: string[] = [];
    for (const entry of fs.readdirSync(users, { withFileTypes: true })) {
      if (!entry.isDirectory() || !isLooseUserId(entry.name)) continue;
      ids.push(entry.name);
    }
    return ids;
  }

  /** 与 backend / 群 id 相同的 8 位短 id；撞上内存或本账号已有委托文件则重试。 */
  private allocateId(userId: string): string {
    for (let attempt = 0; attempt < SHORT_ID_SIZE; attempt += 1) {
      const id = shortId();
      if (this.tasks.has(id)) continue;
      if (this.userDataRoot && isLooseUserId(userId)) {
        const file = path.join(
          this.userDataRoot,
          "users",
          userId,
          ".runtime",
          "delegations",
          `${id}.json`,
        );
        if (fs.existsSync(file)) continue;
      }
      return id;
    }
    throw new Error("无法分配委托任务 ID");
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
    artifacts: parseArtifacts(value.artifacts),
    artifactsDelivered: value.artifactsDelivered === true,
    groupId: typeof value.groupId === "string" && value.groupId ? value.groupId : undefined,
  };
}

function parseArtifacts(
  raw: unknown,
): { path: string; size?: number }[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const files: { path: string; size?: number }[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const pathValue = (item as { path?: unknown }).path;
    if (typeof pathValue !== "string" || !pathValue.startsWith("ARTIFACT/")) continue;
    const entry: { path: string; size?: number } = { path: pathValue };
    const size = (item as { size?: unknown }).size;
    if (typeof size === "number" && Number.isFinite(size) && size >= 0) entry.size = size;
    files.push(entry);
  }
  return files;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

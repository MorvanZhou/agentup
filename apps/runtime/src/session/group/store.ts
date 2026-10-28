import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { SHORT_ID_SIZE, shortId } from "../../ids/short-id.js";

import {
  formatSessionJsonl,
  parseSessionJsonl,
  readGroupLinesPage,
  splitSessionLines,
  stitchSessionLines,
  type GroupPageSource,
  type GroupSessionRecord,
} from "./sessions.js";
import type {
  GroupAssistantPayload,
  GroupDelegationOutcome,
  GroupEffect,
  GroupLine,
  GroupMember,
  GroupRoom,
} from "./types.js";
import { GROUP_RECORD_VERSION, GroupError } from "./types.js";
import { isInside } from "../workspace/project-roots.js";
import {
  briefForSub,
  cancelQueued,
  clearQueue,
  createGroupRoom,
  enqueueAgent,
  finishHolderTurn,
  haltHolderTurn,
  noteExternalResult,
  noteHolderReply,
  noteTaskFinished,
  noteTaskRunning,
  noteTaskStarted,
  postUserMessage,
  replaceUserMessage,
} from "./wave.js";

export class GroupStore {
  constructor(private readonly userDataRoot: string) {}

  create(input: { userId: string; title: string; members: GroupMember[] }): GroupRoom {
    const room = createGroupRoom({
      id: this.allocateId(input.userId),
      userId: input.userId,
      title: input.title,
      members: input.members,
    });
    this.save(room);
    return room;
  }

  get(userId: string, groupId: string, scope: "all" | "current" = "all"): GroupRoom {
    const index = this.loadIndex(userId, groupId);
    const ids = scope === "current" ? [index.currentSessionId] : index.sessionIds;
    return roomShell(index, stitchSessionLines(this.loadSessions(userId, groupId, ids)));
  }

  /** 只读索引。侧栏和翻页不把每一段会话都解析进来。 */
  peek(userId: string, groupId: string): GroupRoom {
    return roomShell(this.loadIndex(userId, groupId), []);
  }

  describe(userId: string): GroupRoom[] {
    const dir = this.dir(userId);
    if (!fs.existsSync(dir)) return [];
    const rooms: GroupRoom[] = [];
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      try {
        rooms.push(this.peek(userId, name.slice(0, -".json".length)));
      } catch (error) {
        if (error instanceof GroupError && error.message === "群记录已过期") continue;
        throw error;
      }
    }
    rooms.sort((a, b) => a.title.localeCompare(b.title));
    return rooms;
  }

  /** 从最新的 jsonl 往旧翻。当前页凑够后不再打开更早的文件。 */
  readLinesPage(
    userId: string,
    groupId: string,
    options: { limit: number; beforeId?: string },
  ): { lines: GroupLine[]; hasMore: boolean } {
    const index = this.loadIndex(userId, groupId);
    const dir = this.sessionsDir(userId, groupId);
    const sessions: GroupPageSource[] = index.sessionIds.map((id) => {
      const jsonl = path.join(dir, `${id}.jsonl`);
      if (fs.existsSync(jsonl)) return { id, path: jsonl };
      return { id, lines: readSessionFile(dir, id) };
    });
    return readGroupLinesPage(sessions, options);
  }

  /** 只改索引里的群名；空标题回落到成员名拼接，与建群一致。 */
  rename(userId: string, groupId: string, title: string): GroupRoom {
    const index = this.loadIndex(userId, groupId);
    const trimmed = title.trim();
    index.title = trimmed || index.members.map((member) => member.name).join("、");
    fs.writeFileSync(this.file(userId, groupId), JSON.stringify(index, null, 2));
    return this.peek(userId, groupId);
  }

  /** 删掉索引和群目录（会话、执掌者、工作区、当次投影）。群不存在时抛错。 */
  remove(userId: string, groupId: string): void {
    this.loadIndex(userId, groupId);
    const root = path.resolve(this.dir(userId));
    const indexFile = path.resolve(this.file(userId, groupId));
    const dataDir = path.resolve(root, groupId);
    if (!isInside(root, indexFile) || dataDir === root || !isInside(root, dataDir)) {
      throw new GroupError("群不存在");
    }
    removeGroupTree(dataDir);
    fs.rmSync(indexFile, { force: true });
  }

  list(userId: string): GroupRoom[] {
    const dir = this.dir(userId);
    if (!fs.existsSync(dir)) return [];
    const rooms: GroupRoom[] = [];
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      try {
        rooms.push(this.get(userId, name.slice(0, -".json".length)));
      } catch (error) {
        if (error instanceof GroupError && error.message === "群记录已过期") continue;
        throw error;
      }
    }
    rooms.sort((a, b) => a.title.localeCompare(b.title));
    return rooms;
  }

  post(userId: string, groupId: string, text: string, now = Date.now()): { room: GroupRoom; effect: GroupEffect } {
    const current = this.get(userId, groupId);
    const result = postUserMessage(current, { id: randomUUID(), text, now });
    this.save(result.room);
    return result;
  }

  replaceMessage(
    userId: string,
    groupId: string,
    messageId: string,
    text: string,
    now = Date.now(),
  ): { room: GroupRoom; effect: GroupEffect; cancelledTaskIds: string[] } {
    const current = this.get(userId, groupId);
    const result = replaceUserMessage(current, { messageId, id: randomUUID(), text, now });
    this.save(result.room);
    return result;
  }

  /** 改发截断进行中的回合时，先别让 ensure 把旧的执掌者再拉起来。 */
  markHolderQuiet(userId: string, groupId: string): GroupRoom {
    const room = this.get(userId, groupId);
    if (!room.holderSpeaking) return room;
    const next = { ...room, holderSpeaking: false };
    this.save(next);
    return next;
  }

  startTask(
    userId: string,
    groupId: string,
    taskId: string,
    options?: {
      keepSpeaking?: boolean;
      authorId?: string;
      authorName?: string;
      brief?: string;
    },
  ): GroupRoom {
    const room = noteTaskStarted(this.get(userId, groupId), taskId, options);
    this.save(room);
    return room;
  }

  markTaskRunning(userId: string, groupId: string, taskId: string): GroupRoom {
    const room = noteTaskRunning(this.get(userId, groupId), taskId);
    this.save(room);
    return room;
  }

  enqueue(userId: string, groupId: string, agentId: string, text: string): GroupRoom {
    const room = enqueueAgent(this.get(userId, groupId), { id: randomUUID(), agentId, text });
    this.save(room);
    return room;
  }

  finishTask(
    userId: string,
    groupId: string,
    taskId: string,
    summary: string,
    now = Date.now(),
    outcome: GroupDelegationOutcome = "completed",
  ): { room: GroupRoom; effect: GroupEffect } {
    const result = noteTaskFinished(this.get(userId, groupId), {
      id: randomUUID(),
      taskId,
      summary,
      now,
      outcome,
    });
    this.save(result.room);
    return result;
  }

  finishHolder(
    userId: string,
    groupId: string,
    text: string,
    options?: { startedTaskId?: string; now?: number } & GroupAssistantPayload,
  ): { room: GroupRoom; effect: GroupEffect } {
    const result = finishHolderTurn(this.get(userId, groupId), {
      id: randomUUID(),
      text,
      now: options?.now ?? Date.now(),
      startedTaskId: options?.startedTaskId,
      ...(options?.parts ? { parts: options.parts } : {}),
      ...(options?.assistantCustom ? { assistantCustom: options.assistantCustom } : {}),
    });
    this.save(result.room);
    return result;
  }

  noteExternal(
    userId: string,
    groupId: string,
    text: string,
    now = Date.now(),
  ): { room: GroupRoom; effect: GroupEffect } {
    const result = noteExternalResult(this.get(userId, groupId), { id: randomUUID(), text, now });
    this.save(result.room);
    return result;
  }

  noteReply(
    userId: string,
    groupId: string,
    text: string,
    options?: { now?: number } & GroupAssistantPayload,
  ): GroupRoom {
    const room = noteHolderReply(this.get(userId, groupId), {
      id: randomUUID(),
      text,
      now: options?.now ?? Date.now(),
      ...(options?.parts ? { parts: options.parts } : {}),
      ...(options?.assistantCustom ? { assistantCustom: options.assistantCustom } : {}),
    });
    this.save(room);
    return room;
  }

  haltHolder(
    userId: string,
    groupId: string,
    text: string,
    options?: { now?: number } & GroupAssistantPayload,
  ): GroupRoom {
    const room = haltHolderTurn(this.get(userId, groupId), {
      id: randomUUID(),
      text,
      now: options?.now ?? Date.now(),
      ...(options?.parts ? { parts: options.parts } : {}),
      ...(options?.assistantCustom ? { assistantCustom: options.assistantCustom } : {}),
    });
    this.save(room);
    return room;
  }

  cancelQueueItem(userId: string, groupId: string, queueId: string): GroupRoom {
    const room = cancelQueued(this.get(userId, groupId), queueId);
    this.save(room);
    return room;
  }

  stop(userId: string, groupId: string): GroupRoom {
    const room = clearQueue(this.get(userId, groupId));
    this.save(room);
    return room;
  }

  resetContext(userId: string, groupId: string): GroupRoom {
    const room = this.get(userId, groupId);
    const next: GroupRoom = {
      ...room,
      holderId: room.holderId,
      holderSpeaking: false,
      phase: "idle",
      taskIds: [],
      pendingDelegations: [],
      queue: [],
      lines: [
        ...room.lines,
        {
          id: `context-reset-${randomUUID()}`,
          at: Date.now(),
          role: "system",
          authorId: "system",
          text: "已开始新对话，之后不再带入此前上下文",
          mentionIds: [],
        },
      ],
    };
    this.save(next);
    return this.get(userId, groupId);
  }

  /** 子任务 brief 与群投影分开，避免把群记录塞进子会话。 */
  subBrief(text: string): string {
    return briefForSub(text);
  }

  private save(room: GroupRoom): void {
    const dir = this.dir(room.userId);
    fs.mkdirSync(dir, { recursive: true });
    const existing = this.readIndex(room.userId, room.id);
    const segments = splitSessionLines(room.lines);
    const sessionIds = alignSessionIds(existing?.sessionIds ?? [], segments.length);
    const currentSessionId = sessionIds[sessionIds.length - 1];
    if (!currentSessionId) throw new GroupError("群不存在");
    const sessionsDir = this.sessionsDir(room.userId, room.id);
    fs.mkdirSync(sessionsDir, { recursive: true });
    segments.forEach((lines, index) => {
      const id = sessionIds[index];
      if (!id) return;
      fs.writeFileSync(path.join(sessionsDir, `${id}.jsonl`), formatSessionJsonl(lines));
    });
    const index: GroupIndex = {
      version: GROUP_RECORD_VERSION,
      id: room.id,
      userId: room.userId,
      title: room.title,
      members: room.members,
      sessionIds,
      currentSessionId,
      holderId: room.holderId,
      holderSpeaking: room.holderSpeaking,
      phase: room.phase,
      taskIds: room.taskIds,
      pendingDelegations: room.pendingDelegations,
      queue: room.queue,
    };
    fs.writeFileSync(this.file(room.userId, room.id), JSON.stringify(index, null, 2));
  }

  private readIndex(userId: string, groupId: string): GroupIndex | null {
    const file = this.file(userId, groupId);
    if (!fs.existsSync(file)) return null;
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!isGroupIndex(parsed, userId)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private loadIndex(userId: string, groupId: string): GroupIndex {
    const file = this.file(userId, groupId);
    if (!fs.existsSync(file)) throw new GroupError("群不存在");
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      throw new GroupError("群不存在");
    }
    if (!isGroupIndex(parsed, userId)) {
      fs.rmSync(file, { force: true });
      throw new GroupError("群记录已过期");
    }
    return parsed;
  }

  private loadSessions(userId: string, groupId: string, sessionIds: readonly string[]): GroupSessionRecord[] {
    const dir = this.sessionsDir(userId, groupId);
    return sessionIds.map((id) => ({ id, lines: readSessionFile(dir, id) }));
  }

  private sessionsDir(userId: string, groupId: string): string {
    return path.join(this.dir(userId), groupId, "sessions");
  }

  /** 与 backend user_id / agent_id 相同的 8 位字母数字；撞上该用户已有群文件则重试。 */
  private allocateId(userId: string): string {
    const dir = this.dir(userId);
    for (let attempt = 0; attempt < SHORT_ID_SIZE; attempt += 1) {
      const id = shortId();
      if (!fs.existsSync(path.join(dir, `${id}.json`))) return id;
    }
    throw new GroupError("无法分配群 ID");
  }

  private dir(userId: string): string {
    assertId(userId);
    return path.join(this.userDataRoot, "users", userId, ".runtime", "groups");
  }

  private file(userId: string, groupId: string): string {
    assertId(userId);
    assertId(groupId);
    return path.join(this.dir(userId), `${groupId}.json`);
  }
}

function isGroupIndex(value: unknown, userId: string): value is GroupIndex {
  if (!value || typeof value !== "object") return false;
  const index = value as Partial<GroupIndex>;
  return (
    index.version === GROUP_RECORD_VERSION &&
    index.userId === userId &&
    typeof index.currentSessionId === "string" &&
    Array.isArray(index.sessionIds) &&
    Array.isArray(index.pendingDelegations)
  );
}

function readSessionFile(dir: string, id: string): GroupLine[] {
  const jsonl = path.join(dir, `${id}.jsonl`);
  if (fs.existsSync(jsonl)) {
    try {
      return parseSessionJsonl(fs.readFileSync(jsonl, "utf8"));
    } catch {
      return [];
    }
  }
  const legacy = path.join(dir, `${id}.json`);
  if (!fs.existsSync(legacy)) return [];
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(legacy, "utf8"));
    if (!parsed || typeof parsed !== "object") return [];
    const lines = (parsed as { lines?: unknown }).lines;
    return Array.isArray(lines) ? (lines as GroupLine[]) : [];
  } catch {
    return [];
  }
}

function alignSessionIds(existing: readonly string[], segmentCount: number): string[] {
  const count = Math.max(1, segmentCount);
  const ids = existing.slice(0, count);
  while (ids.length < count) ids.push(randomUUID());
  return ids;
}

type GroupIndex = {
  version: typeof GROUP_RECORD_VERSION;
  id: string;
  userId: string;
  title: string;
  members: GroupRoom["members"];
  sessionIds: string[];
  currentSessionId: string;
  holderId: GroupRoom["holderId"];
  holderSpeaking: boolean;
  phase: GroupRoom["phase"];
  taskIds: string[];
  pendingDelegations: GroupRoom["pendingDelegations"];
  queue: GroupRoom["queue"];
};

function roomShell(index: GroupIndex, lines: GroupLine[]): GroupRoom {
  return {
    version: index.version,
    id: index.id,
    userId: index.userId,
    title: index.title,
    members: index.members,
    lines,
    holderId: index.holderId,
    holderSpeaking: index.holderSpeaking,
    phase: index.phase,
    taskIds: index.taskIds,
    pendingDelegations: index.pendingDelegations,
    queue: index.queue,
  };
}

function removeGroupTree(target: string): void {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(target);
  } catch {
    return;
  }
  if (stat.isSymbolicLink()) {
    fs.unlinkSync(target);
    return;
  }
  fs.rmSync(target, { recursive: true, force: true });
}

function assertId(value: string): void {
  if (!value || value === "." || value === ".." || /[/\\\u0000]/.test(value)) {
    throw new GroupError("群不存在");
  }
}

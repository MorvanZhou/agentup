import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { UIMessage, UIMessageChunk } from "ai";

import { onRuntimeProviderSecrets, ProviderSecretPendingError } from "../../config/provider.js";
import { t } from "../../i18n/index.js";
import { isUserCancelError } from "../model/unavailable.js";
import { TRANSCRIPT_PAGE_SIZE } from "../transcript-page.js";
import { TurnStreamHub } from "../turn/turn-stream-hub.js";
import { GroupRooms } from "./rooms.js";
import type { GroupAssistantPayload, GroupEffect, GroupLine, GroupRoom } from "./types.js";
import { holderSessionRelative, projectTranscript } from "./wave.js";

export type GroupTurnHandle = {
  /** 本轮还在跑时，把后到的用户话或交回并进当前回合。 */
  inject(text: string): Promise<void>;
  abort(): Promise<void>;
};

export type GroupTurnStart = {
  userId: string;
  groupId: string;
  agentId: string;
  prompt: string;
  sessionDir: string;
  signal: AbortSignal;
  onChunk: (chunks: UIMessageChunk[]) => void;
  onReady: (handle: GroupTurnHandle) => void;
};

export type GroupTurnResult = {
  text: string;
  message?: UIMessage;
};

/** 在执掌者自己的群会话里跑一轮，并交出可见正文与可选完整气泡。不写一对一。 */
export type GroupTurnDriver = {
  start(input: GroupTurnStart): Promise<GroupTurnResult>;
};

type RunEffect = Exclude<GroupEffect, { type: "stored" }>;

type LiveTurn = {
  turnId: string;
  streamKey: string;
  abort: AbortController;
  stopped: boolean;
  /** 改发会丢掉这一轮，不再写「已停止」。 */
  discard: boolean;
  done: Promise<void>;
  inject: (text: string) => void;
};

/**
 * 把 start/resume/merge 真正跑起来，并把这一轮的 UIMessage 块留给桌面直播。
 * 磁盘上的 holderSpeaking 只在有执行体或刚交回时为真。
 */
export class GroupTurns {
  private readonly hub = new TurnStreamHub();
  private readonly live = new Map<string, LiveTurn>();
  /** 当前或刚结束的流，晚订阅可以回放。 */
  private readonly streams = new Map<string, string>();
  /** 正在删除的群。交回和 ensure 不要再把执掌者拉起来。 */
  private readonly quiet = new Set<string>();
  /** 退出重进时密钥尚未注入，先别把「缺 API Key」写成执掌者回复。 */
  private readonly awaitingSecrets = new Set<string>();
  private secretEpoch = 0;

  constructor(
    private readonly rooms: GroupRooms,
    private readonly driver: GroupTurnDriver,
    private readonly userDataRoot: string,
    options: { whenSecretsReady?: (listener: () => void) => () => void } = {},
  ) {
    this.rooms.setEffectListener((result) => this.deliver(result.room, result.effect));
    const subscribe = options.whenSecretsReady ?? onRuntimeProviderSecrets;
    subscribe(() => {
      this.secretEpoch += 1;
      this.resumeAfterSecrets();
    });
  }

  list(userId: string): GroupRoom[] {
    const rooms = this.rooms.store.describe(userId);
    for (const room of rooms) {
      if (!room.holderSpeaking || !room.holderId) continue;
      this.ensure(this.rooms.store.get(userId, room.id, "current"));
    }
    return rooms;
  }

  /** 界面打开群：只带最近一页记录。执掌者还在说话时，用当前 session 把回合接上。 */
  view(userId: string, groupId: string): GroupRoom & { linesHasMore: boolean } {
    const room = this.rooms.store.peek(userId, groupId);
    if (room.holderSpeaking && room.holderId) {
      this.ensure(this.rooms.store.get(userId, groupId, "current"));
    }
    const page = this.linePage(userId, groupId, { limit: TRANSCRIPT_PAGE_SIZE });
    return { ...room, lines: page.lines, linesHasMore: page.hasMore };
  }

  linePage(
    userId: string,
    groupId: string,
    options: { limit: number; beforeId?: string },
  ): { lines: GroupLine[]; hasMore: boolean } {
    this.rooms.store.peek(userId, groupId);
    return this.rooms.store.readLinesPage(userId, groupId, options);
  }

  touch(userId: string, groupId: string): void {
    this.rooms.store.peek(userId, groupId);
  }

  get(userId: string, groupId: string): GroupRoom {
    const room = this.rooms.get(userId, groupId);
    this.ensure(room);
    return room;
  }

  post(userId: string, groupId: string, text: string): GroupRoom {
    const result = this.rooms.post(userId, groupId, text);
    this.deliver(result.room, result.effect);
    return result.room;
  }

  /** 从这条用户消息改发：截掉它和之后的记录，停掉正在跑的回合，再按新文本开口。 */
  async edit(userId: string, groupId: string, messageId: string, text: string): Promise<GroupRoom> {
    const current = this.live.get(roomKey(userId, groupId));
    if (current) {
      current.discard = true;
      current.stopped = true;
      this.rooms.store.markHolderQuiet(userId, groupId);
      current.abort.abort();
      await current.done;
    }
    const result = this.rooms.replaceMessage(userId, groupId, messageId, text);
    this.forgetRuns(result.room);
    this.deliver(result.room, result.effect);
    return result.room;
  }

  liveTurnId(userId: string, groupId: string): string | null {
    return this.live.get(roomKey(userId, groupId))?.turnId ?? null;
  }

  isTurnOpen(userId: string, groupId: string): boolean {
    const key = this.streams.get(roomKey(userId, groupId));
    return key ? this.hub.isOpen(key) : false;
  }

  /** 晚订阅先回放。没有流时 closed。 */
  subscribe(
    userId: string,
    groupId: string,
    listener: (chunk: UIMessageChunk) => void,
  ): { unsubscribe: () => void; closed: boolean } {
    const key = this.streams.get(roomKey(userId, groupId));
    if (!key) return { unsubscribe: () => undefined, closed: true };
    return this.hub.subscribe(key, listener);
  }

  /**
   * 短等执掌者流出现，然后把块交给 listener，直到这一轮的流关上。
   * 客户端断开只停订阅，不停止模型。
   */
  async follow(
    userId: string,
    groupId: string,
    listener: (chunk: UIMessageChunk) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const ready = await this.waitForStream(userId, groupId, signal);
    if (!ready || signal.aborted) return;
    const key = this.streams.get(roomKey(userId, groupId));
    if (!key) return;
    await new Promise<void>((resolve, reject) => {
      const { unsubscribe, closed } = this.hub.subscribe(key, listener);
      if (closed || signal.aborted) {
        unsubscribe();
        if (signal.aborted) reject(signal.reason ?? new Error("aborted"));
        else resolve();
        return;
      }
      const timer = setInterval(() => {
        if (!this.hub.isOpen(key)) {
          cleanup();
          resolve();
        }
      }, 50);
      const onAbort = () => {
        cleanup();
        reject(signal.reason ?? new Error("aborted"));
      };
      const cleanup = () => {
        clearInterval(timer);
        signal.removeEventListener("abort", onAbort);
        unsubscribe();
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  async stop(userId: string, groupId: string): Promise<GroupRoom> {
    const current = this.live.get(roomKey(userId, groupId));
    if (current) {
      current.stopped = true;
      current.abort.abort();
      await current.done;
    } else {
      try {
        const room = this.rooms.get(userId, groupId);
        if (room.holderSpeaking) this.rooms.store.haltHolder(userId, groupId, t("chat.turnCancelled"));
      } catch {
        // 群已经不在。
      }
    }
    return this.rooms.stop(userId, groupId);
  }

  /** 丢掉进行中的执掌者回合，再删除群记录、会话和工作区。 */
  async remove(userId: string, groupId: string): Promise<void> {
    this.rooms.store.peek(userId, groupId);
    const key = roomKey(userId, groupId);
    this.quiet.add(key);
    try {
      const current = this.live.get(key);
      if (current) {
        current.discard = true;
        current.abort.abort();
        await current.done;
      }
      const streamKey = this.streams.get(key);
      if (streamKey) this.hub.finish(streamKey);
      this.streams.delete(key);
      this.live.delete(key);
      this.rooms.remove(userId, groupId);
    } finally {
      this.quiet.delete(key);
    }
  }

  async clearContext(userId: string, groupId: string): Promise<GroupRoom> {
    const room = await this.stop(userId, groupId);
    const next = this.rooms.store.resetContext(userId, groupId);
    this.forgetRuns(next);
    if (next.holderId) {
      fs.rmSync(this.holderSessionDir(next.userId, next.id, next.holderId), {
        recursive: true,
        force: true,
      });
    }
    return next;
  }

  /** 密钥注入后再开仍标着执掌中、但上一轮没写成回复的房间。 */
  private resumeAfterSecrets(): void {
    for (const key of [...this.awaitingSecrets]) {
      this.awaitingSecrets.delete(key);
      if (this.quiet.has(key) || this.live.has(key)) continue;
      const slash = key.indexOf("/");
      if (slash <= 0) continue;
      try {
        this.ensure(
          this.rooms.store.get(key.slice(0, slash), key.slice(slash + 1), "current"),
        );
      } catch {
        // 群已经删掉。
      }
    }
  }

  private ensure(room: GroupRoom): void {
    if (this.quiet.has(roomKey(room.userId, room.id))) return;
    if (!room.holderSpeaking || !room.holderId) return;
    if (this.live.has(roomKey(room.userId, room.id))) return;
    this.begin(room, {
      type: "resume_holder",
      agentId: room.holderId,
      prompt: projectTranscript(room),
    });
  }

  private deliver(room: GroupRoom, effect: GroupEffect): void {
    if (effect.type === "stored") return;
    if (this.quiet.has(roomKey(room.userId, room.id))) return;
    const live = this.live.get(roomKey(room.userId, room.id));
    if (live) {
      live.inject(holderCue(room, effect, true));
      return;
    }
    this.begin(room, effect);
  }

  private begin(room: GroupRoom, effect: RunEffect): void {
    const key = roomKey(room.userId, room.id);
    if (this.live.has(key)) return;
    const turnId = randomUUID();
    const streamKey = `${key}/${turnId}`;
    const abort = new AbortController();
    let resolveDone: () => void = () => undefined;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    const pending: string[] = [];
    let handle: GroupTurnHandle | null = null;
    const turn: LiveTurn = {
      turnId,
      streamKey,
      abort,
      stopped: false,
      discard: false,
      done,
      inject: (text) => {
        const cue = text.trim();
        if (!cue) return;
        if (handle) void handle.inject(cue).catch(() => undefined);
        else pending.push(cue);
      },
    };
    this.live.set(key, turn);
    this.streams.set(key, streamKey);
    this.hub.begin(streamKey);
    const sessionDir = this.holderSessionDir(room.userId, room.id, effect.agentId);
    if (effect.type === "start_holder") fs.rmSync(sessionDir, { recursive: true, force: true });
    void this.drive(room, effect, turn, sessionDir, (next) => {
      handle = next;
      for (const text of pending.splice(0)) void next.inject(text).catch(() => undefined);
    }).finally(resolveDone);
  }

  private async drive(
    room: GroupRoom,
    effect: RunEffect,
    turn: LiveTurn,
    sessionDir: string,
    onReady: (handle: GroupTurnHandle) => void,
  ): Promise<void> {
    const key = roomKey(room.userId, room.id);
    let next: { room: GroupRoom; effect: GroupEffect } | null = null;
    try {
      let text = "";
      let assistant: GroupAssistantPayload = {};
      let failed = false;
      try {
        const result = await this.driver.start({
          userId: room.userId,
          groupId: room.id,
          agentId: effect.agentId,
          prompt: holderCue(room, effect, sessionHasFiles(sessionDir)),
          sessionDir,
          signal: turn.abort.signal,
          onChunk: (chunks) => this.hub.write(turn.streamKey, chunks),
          onReady,
        });
        text = result.text;
        assistant = assistantPayloadFromMessage(result.message);
      } catch (error) {
        failed = true;
        if (!turn.discard && (turn.stopped || isCancel(error))) {
          this.rooms.store.haltHolder(room.userId, room.id, t("chat.turnCancelled"));
        } else if (!turn.discard && error instanceof ProviderSecretPendingError) {
          // 密文还在，明文要等桌面注入。先保持执掌中，注入后再接上这一轮。
          this.awaitingSecrets.add(key);
          const seen = this.secretEpoch;
          queueMicrotask(() => {
            if (this.secretEpoch !== seen) this.resumeAfterSecrets();
          });
        } else if (!turn.discard) {
          const message = error instanceof Error && error.message ? error.message : t("chat.emptyAssistantResult");
          this.rooms.store.noteReply(room.userId, room.id, message);
        }
      }
      if (turn.discard) {
        // 改发自己重写记录。
      } else if (!failed && turn.stopped) {
        this.rooms.store.haltHolder(
          room.userId,
          room.id,
          text.trim() || t("chat.turnCancelled"),
          assistant,
        );
      } else if (!failed && !turn.stopped) {
        next = this.rooms.store.finishHolder(
          room.userId,
          room.id,
          text.trim() || t("chat.emptyAssistantResult"),
          assistant,
        );
      }
    } catch {
      // 房间已删除，或这一轮已经被停掉。
    }
    if (this.live.get(key)?.turnId === turn.turnId) this.live.delete(key);
    if (next && !turn.stopped) this.deliver(next.room, next.effect);
    this.hub.finish(turn.streamKey);
  }

  /** 留任执掌者的群内会话。换人开工时由调用方清空，下一句才能只送新的一句。 */
  private holderSessionDir(userId: string, groupId: string, agentId: string): string {
    return path.join(this.userDataRoot, "users", userId, holderSessionRelative(groupId, agentId));
  }

  /** 改发或新对话后丢掉进行中的执行目录，下一轮按当前 session 重新投影。 */
  private forgetRuns(room: GroupRoom): void {
    fs.rmSync(path.join(this.userDataRoot, "users", room.userId, ".runtime", "groups", room.id, "runs"), {
      recursive: true,
      force: true,
    });
  }

  private async waitForStream(userId: string, groupId: string, signal: AbortSignal): Promise<boolean> {
    const deadline = Date.now() + 3_000;
    while (!this.hasStream(userId, groupId) && Date.now() < deadline && !signal.aborted) {
      let speaking = false;
      try {
        speaking = this.rooms.get(userId, groupId).holderSpeaking;
      } catch {
        return false;
      }
      if (!speaking && !this.live.has(roomKey(userId, groupId))) return false;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    return this.hasStream(userId, groupId);
  }

  private hasStream(userId: string, groupId: string): boolean {
    const key = this.streams.get(roomKey(userId, groupId));
    if (!key) return false;
    return this.hub.isOpen(key) || this.hub.hasBuffer(key);
  }
}

function roomKey(userId: string, groupId: string): string {
  return `${userId}/${groupId}`;
}

function sessionHasFiles(sessionDir: string): boolean {
  if (!fs.existsSync(sessionDir)) return false;
  return fs.readdirSync(sessionDir).length > 0;
}

/**
 * 新开一轮（换人或重新 @）送整段可见记录。
 * 同一轮里续说，且群会话已经有文件时，只送新的一句，避免把旧记录再贴一遍。
 * 工作单交回或系统通知是新的一句，不能退回更早的用户原话。
 */
function holderCue(room: GroupRoom, effect: RunEffect, sessionReady: boolean): string {
  if (effect.type === "start_holder" || !sessionReady) return effect.prompt;
  if (effect.type === "merge_holder") return openDelegationSummary(room) || effect.prompt;
  const latest = room.lines.at(-1);
  if (latest?.role === "delegation") {
    const summary = openDelegationSummary(room);
    if (summary) return summary;
  }
  if (latest && (latest.role === "handback" || latest.role === "system") && latest.text.trim()) {
    return latest.text.trim();
  }
  return lastText(room, "user") || effect.prompt;
}

/** 还没被执掌者汇总的子任务摘要。过程正文不在这里。 */
function openDelegationSummary(room: GroupRoom): string {
  for (let index = room.pendingDelegations.length - 1; index >= 0; index -= 1) {
    const summary = room.pendingDelegations[index]?.summary?.trim() || "";
    if (summary) return summary;
  }
  for (let index = room.lines.length - 1; index >= 0; index -= 1) {
    const line = room.lines[index];
    if (line?.role !== "delegation" || line.handoff === "consumed") continue;
    const summary = line.summary?.trim() || "";
    if (summary) return summary;
  }
  return "";
}

function lastText(room: GroupRoom, role: GroupLine["role"]): string {
  for (let index = room.lines.length - 1; index >= 0; index -= 1) {
    const line = room.lines[index];
    if (line?.role === role && line.text.trim()) return line.text.trim();
  }
  return "";
}

function isCancel(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return isUserCancelError(message);
}

function assistantPayloadFromMessage(message: UIMessage | undefined): GroupAssistantPayload {
  if (!message || message.role !== "assistant") return {};
  const payload: GroupAssistantPayload = {};
  if (Array.isArray(message.parts) && message.parts.length > 0) {
    payload.parts = message.parts;
  }
  const metadata =
    message.metadata && typeof message.metadata === "object"
      ? (message.metadata as { custom?: unknown })
      : null;
  const custom =
    metadata?.custom && typeof metadata.custom === "object"
      ? (metadata.custom as Record<string, unknown>)
      : null;
  if (!custom) return payload;
  const assistantCustom: NonNullable<GroupAssistantPayload["assistantCustom"]> = {};
  if ("agentUpSummary" in custom) assistantCustom.agentUpSummary = custom.agentUpSummary;
  if ("agentUpArtifacts" in custom) assistantCustom.agentUpArtifacts = custom.agentUpArtifacts;
  if (Object.keys(assistantCustom).length > 0) payload.assistantCustom = assistantCustom;
  return payload;
}

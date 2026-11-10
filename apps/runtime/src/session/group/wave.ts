import type {
  GroupAssistantPayload,
  GroupDelegationOutcome,
  GroupEffect,
  GroupLine,
  GroupMember,
  GroupPendingDelegation,
  GroupQueueItem,
  GroupRoom,
} from "./types.js";
import type { ModelAssignmentMode } from "../model/assignment.js";
import { GROUP_RECORD_VERSION } from "./types.js";
import { MEMBER_MAX, MEMBER_MIN } from "./member-limits.js";
import { GroupError } from "./types.js";

export { MEMBER_MAX, MEMBER_MIN } from "./member-limits.js";

export function createGroupRoom(input: {
  id: string;
  userId: string;
  title: string;
  members: GroupMember[];
  defaultHolderId?: string | null;
  sourceTeamId?: string | null;
}): GroupRoom {
  const members = normalizeMembers(input.members);
  const sourceTeamId =
    typeof input.sourceTeamId === "string" && input.sourceTeamId.trim()
      ? input.sourceTeamId.trim()
      : null;
  return {
    version: GROUP_RECORD_VERSION,
    id: input.id,
    userId: input.userId,
    title: input.title.trim() || members.map((member) => member.name).join("、"),
    members,
    lines: [],
    holderId: null,
    defaultHolderId: resolveDefaultHolderId(members, input.defaultHolderId),
    modelMode: "unified" satisfies ModelAssignmentMode,
    model: null,
    holderSpeaking: false,
    phase: "idle",
    taskIds: [],
    pendingDelegations: [],
    queue: [],
    ...(sourceTeamId ? { sourceTeamId } : {}),
  };
}

/**
 * 用户在群里说话。
 * 还没有执掌者、也没点到成员：默认执掌者开工（消息行 mentionIds 仍为空）。
 * 还没有执掌者、点到了成员：第一个成为执掌者。其余的人由他派活，不排队接班。
 * 一轮已结束：没点到别人就由留任的人接着开工；点到的第一个新人换上。
 * 一轮还在（正在说话或还有工作单）：话交给当前执掌者，不换人。
 */
export function postUserMessage(
  room: GroupRoom,
  input: { id: string; text: string; now: number },
): { room: GroupRoom; effect: GroupEffect } {
  const text = input.text.trim();
  if (!text) throw new GroupError("消息不能为空");
  const mentionIds = resolveMentions(room.members, text);
  const line: GroupLine = {
    id: input.id,
    at: input.now,
    role: "user",
    authorId: "user",
    text,
    mentionIds,
  };
  let next = append(room, line);

  if (!next.holderId) {
    // 无 @ 时用默认执掌者首启；有 @ 仍以第一个有效提及为准
    const first = mentionIds[0] ?? resolveDefaultHolderId(next.members, next.defaultHolderId);
    next = {
      ...next,
      holderId: first,
      holderSpeaking: true,
      phase: "holding",
      queue: [],
    };
    return { room: next, effect: startEffect(next, "start_holder") };
  }

  if (!roundOpen(next)) {
    const first = mentionIds[0];
    if (first && first !== next.holderId) {
      next = {
        ...next,
        holderId: first,
        holderSpeaking: true,
        phase: "holding",
        queue: [],
        lines: [
          ...next.lines,
          {
            id: `${input.id}:wave`,
            at: input.now,
            role: "system",
            authorId: "system",
            text: `本轮 · ${nameOf(next, first)}`,
            mentionIds: [first],
          },
        ],
      };
      return { room: next, effect: startEffect(next, "start_holder") };
    }
  }

  next = {
    ...next,
    holderSpeaking: true,
    phase: next.taskIds.length > 0 ? "task" : "holding",
  };
  return { room: next, effect: startEffect(next, "resume_holder") };
}

/** 正在说话，或还有工作单，这一轮就没结束。 */
function roundOpen(room: GroupRoom): boolean {
  return room.holderSpeaking || room.taskIds.length > 0;
}

/**
 * 改发一条用户消息：丢掉这一句和它之后的记录，再按新文本重新开口。
 * 这一句之前已经派出、且回复还留在记录里的工作单继续留着。
 */
export function replaceUserMessage(
  room: GroupRoom,
  input: { messageId: string; id: string; text: string; now: number },
): { room: GroupRoom; effect: GroupEffect; cancelledTaskIds: string[] } {
  const index = room.lines.findIndex((line) => line.id === input.messageId);
  const target = index >= 0 ? room.lines[index] : undefined;
  if (!target || target.role !== "user") throw new GroupError("消息不存在");
  const rewound = rewindBeforeUserLine(room, index);
  const posted = postUserMessage(rewound.room, { id: input.id, text: input.text, now: input.now });
  return { ...posted, cancelledTaskIds: rewound.cancelledTaskIds };
}

/**
 * 执掌者派出的工作单开始跑。同时只留一张在跑的单。
 * 执掌者还在说话时，子任务先记在 pending，界面排在直播气泡之后；说完再落到这条回复后面。
 */
export function noteTaskStarted(
  room: GroupRoom,
  taskId: string,
  options?: {
    keepSpeaking?: boolean;
    id?: string;
    now?: number;
    authorId?: string;
    authorName?: string;
    brief?: string;
  },
): GroupRoom {
  if (!room.holderId) throw new GroupError("没有执掌者");
  const id = taskId.trim();
  if (!id) throw new GroupError("任务不存在");
  if (room.taskIds.includes(id)) return room;
  const authorId = options?.authorId?.trim() || "";
  const item: GroupPendingDelegation = {
    id: options?.id?.trim() || `delegation-${id}`,
    at: options?.now ?? Date.now(),
    taskId: id,
    authorId,
    authorName: options?.authorName?.trim() || authorId || id,
    brief: options?.brief?.trim() || "",
    activity: "queued",
    handoff: "pending",
  };
  const speaking = options?.keepSpeaking === true ? room.holderSpeaking : false;
  const next: GroupRoom = {
    ...room,
    phase: "task",
    holderSpeaking: speaking,
    taskIds: [...room.taskIds, id],
  };
  if (speaking) return { ...next, pendingDelegations: [...room.pendingDelegations, item] };
  return { ...next, lines: [...room.lines, delegationLine(item)] };
}

/**
 * 这名成员在最近一条用户发言之后已经完成，执掌者还没把结果说出去。
 * 再派一次会让他把同一件事重做。失败或取消不挡，执掌者回复过之后也不挡。
 */
export function completedDelegationAwaitingReply(
  room: GroupRoom,
  agentId: string,
): { taskId: string; summary: string } | null {
  const id = agentId.trim();
  if (!id) return null;
  let lastUser = -1;
  for (let index = room.lines.length - 1; index >= 0; index -= 1) {
    if (room.lines[index]?.role === "user") {
      lastUser = index;
      break;
    }
  }
  const hits: { taskId: string; summary: string; at: number }[] = [];
  const consider = (item: {
    authorId: string;
    outcome?: GroupDelegationOutcome;
    handoff?: GroupPendingDelegation["handoff"];
    taskId: string;
    summary?: string;
    at: number;
  }): void => {
    if (item.authorId !== id || item.outcome !== "completed" || item.handoff === "consumed") return;
    const summary = item.summary?.trim() || "";
    if (!summary || !item.taskId) return;
    hits.push({ taskId: item.taskId, summary, at: item.at });
  };
  for (const line of room.lines.slice(lastUser + 1)) {
    if (line.role !== "delegation" || !line.taskId) continue;
    consider({ ...line, taskId: line.taskId });
  }
  for (const item of room.pendingDelegations) consider(item);
  hits.sort((left, right) => left.at - right.at);
  const latest = hits.at(-1);
  return latest ? { taskId: latest.taskId, summary: latest.summary } : null;
}

/**
 * 群任务终态摘要：专员正文 + complete_group_task 确认过的 Next step。
 * 未调用确认工具时不加 Next step 行，避免伪造专员交接意图。
 */
export function composeGroupHandbackSummary(input: {
  text: string;
  confirmed: boolean;
  nextStep?: string;
}): string {
  const body = input.text.trim();
  if (!input.confirmed) return body;
  const step = typeof input.nextStep === "string" ? input.nextStep.trim() : "";
  const line = step ? `Next step: ${step}` : "Next step: none.";
  return body ? `${body}\n\n${line}` : line;
}

/**
 * 交回执掌者的那一句。
 * 禁止把同一张已完成 brief 再派给同一人；若摘要含 Next step，由模型决定是否派下一岗或问用户。
 */
export function formatFinishedDelegationCue(summary: string): string {
  const trimmed = summary.trim();
  const hasNextStep = /(?:^|\n)Next step:/i.test(trimmed);
  return [
    "Group task finished. Specialist summary is below.",
    "Do not re-delegate the same finished brief to that same member.",
    hasNextStep
      ? "Read Next step: if it names further work for another member or a later stage, call delegate_to_agent for that next stage (or ask the user if you need a decision). If it is none / user handoff, summarize for the user and stop."
      : "If the overall user goal still needs another member or stage, delegate that work or ask the user; otherwise summarize and stop.",
    "",
    trimmed,
  ].join("\n");
}

/** 子会话拿到执行槽，从排队变成进行中。 */
export function noteTaskRunning(room: GroupRoom, taskId: string): GroupRoom {
  if (!room.taskIds.includes(taskId)) return room;
  return patchDelegation(room, taskId, { activity: "running" });
}

/**
 * 工作单终态。摘要写在子 Agent 那条消息上，并交回执掌者。
 * 执掌者正在说话时并进当前轮，不另开一轮。
 */
export function noteTaskFinished(
  room: GroupRoom,
  input: {
    id: string;
    taskId: string;
    summary: string;
    now: number;
    outcome?: GroupDelegationOutcome;
  },
): { room: GroupRoom; effect: GroupEffect } {
  if (!room.taskIds.includes(input.taskId)) throw new GroupError("任务不属于这间群");
  const taskIds = room.taskIds.filter((id) => id !== input.taskId);
  const summary = input.summary.trim() || "已交回";
  const next = patchDelegation(
    { ...room, taskIds },
    input.taskId,
    { summary, outcome: input.outcome ?? "completed" },
    input,
  );
  if (taskIds.length > 0) return { room: next, effect: { type: "stored" } };
  if (next.holderSpeaking) {
    return { room: { ...next, phase: "holding" }, effect: startEffect(next, "merge_holder") };
  }
  const speaking = { ...next, phase: "holding" as const, holderSpeaking: true };
  return { room: speaking, effect: startEffect(speaking, "resume_holder") };
}

/** 执掌者这轮说完。没有新工作单时，排队的下一位才接班。 */
export function finishHolderTurn(
  room: GroupRoom,
  input: {
    id: string;
    text: string;
    now: number;
    startedTaskId?: string;
  } & GroupAssistantPayload,
): { room: GroupRoom; effect: GroupEffect } {
  if (!room.holderId) throw new GroupError("没有执掌者");
  const reply = agentLine(room.holderId, input);
  const withReply = consumeSettled(placePending(append(room, reply), reply.id));
  if (input.startedTaskId) {
    return {
      room: noteTaskStarted({ ...withReply, holderSpeaking: false }, input.startedTaskId),
      effect: { type: "stored" },
    };
  }
  if (withReply.taskIds.length > 0) {
    return { room: { ...withReply, holderSpeaking: false, phase: "task" }, effect: { type: "stored" } };
  }
  return {
    room: { ...withReply, holderSpeaking: false, phase: "idle", queue: [] },
    effect: { type: "stored" },
  };
}

export function cancelQueued(room: GroupRoom, queueId: string): GroupRoom {
  const item = room.queue.find((entry) => entry.id === queueId);
  if (!item) throw new GroupError("排队不存在");
  return { ...room, queue: room.queue.filter((entry) => entry.id !== queueId) };
}

/** 停止本轮时丢掉尚未接班的排队。进行中的工作单由调用方另行取消。 */
export function clearQueue(room: GroupRoom): GroupRoom {
  return { ...room, queue: [] };
}

/**
 * 这一轮说完但不再接班：留下正文，执掌者仍在，排队保留。
 * 出错时用它，避免把下一位放出来。
 */
export function noteHolderReply(
  room: GroupRoom,
  input: { id: string; text: string; now: number } & GroupAssistantPayload,
): GroupRoom {
  const text = input.text.trim();
  if (!room.holderId || !text) return placePending({ ...room, holderSpeaking: false }, "");
  const reply = agentLine(room.holderId, { ...input, text });
  const placed = placePending(append(room, reply), reply.id);
  return {
    ...placed,
    holderSpeaking: false,
    phase: room.taskIds.length > 0 ? "task" : "holding",
  };
}

/**
 * 用户停止本轮。留下收尾，丢掉排队，取消进行中的单由调用方负责。
 * 这个人留任，不把别人放出来。
 */
export function haltHolderTurn(
  room: GroupRoom,
  input: { id: string; text: string; now: number } & GroupAssistantPayload,
): GroupRoom {
  const text = input.text.trim();
  const reply = room.holderId && text ? agentLine(room.holderId, { ...input, text }) : undefined;
  const withLine = reply ? append(room, reply) : room;
  const placed = placePending(withLine, reply?.id ?? "");
  const tasksLeft = room.taskIds.length > 0;
  return {
    ...placed,
    holderSpeaking: false,
    queue: [],
    phase: tasksLeft ? "task" : "idle",
    holderId: room.holderId,
  };
}

function agentLine(
  authorId: string,
  input: {
    id: string;
    text: string;
    now: number;
  } & GroupAssistantPayload,
): GroupLine {
  const text = input.text.trim();
  const line: GroupLine = {
    id: input.id,
    at: input.now,
    role: "agent",
    authorId,
    text,
    mentionIds: [],
  };
  if (input.parts && input.parts.length > 0) line.parts = input.parts;
  if (input.assistantCustom) line.assistantCustom = input.assistantCustom;
  return line;
}

/** 执掌者把下一个人记成排队，不另开一张进行中的工作单。 */
export function enqueueAgent(
  room: GroupRoom,
  input: { id: string; agentId: string; text: string },
): GroupRoom {
  if (!room.holderId) throw new GroupError("没有执掌者");
  if (!room.members.some((member) => member.agentId === input.agentId)) {
    throw new GroupError("不是群成员");
  }
  if (room.queue.some((item) => item.agentId === input.agentId)) return room;
  return {
    ...room,
    queue: [
      ...room.queue,
      { id: input.id, agentId: input.agentId, text: input.text, messageId: input.id },
    ],
  };
}

/**
 * 群里的后台任务结束。没有执掌者时只留下记录。
 * 执掌者空闲则重新开口；正在说则并进当前轮。
 */
export function noteExternalResult(
  room: GroupRoom,
  input: { id: string; text: string; now: number },
): { room: GroupRoom; effect: GroupEffect } {
  const text = input.text.trim();
  if (!text) throw new GroupError("消息不能为空");
  const next = append(room, {
    id: input.id,
    at: input.now,
    role: "system",
    authorId: "system",
    text,
    mentionIds: room.holderId ? [room.holderId] : [],
  });
  if (!next.holderId) return { room: next, effect: { type: "stored" } };
  if (next.holderSpeaking) return { room: next, effect: startEffect(next, "merge_holder") };
  const speaking: GroupRoom = {
    ...next,
    holderSpeaking: true,
    phase: next.taskIds.length > 0 ? "task" : "holding",
  };
  return { room: speaking, effect: startEffect(speaking, "resume_holder") };
}

/** 子会话只能看到派活正文，不能看到群记录。 */
export function briefForSub(text: string): string {
  return text.trim();
}

/** 接班者看见已经发出的对话，不含工具过程。 */
export function projectTranscript(room: GroupRoom): string {
  let resetIndex = -1;
  for (let index = room.lines.length - 1; index >= 0; index -= 1) {
    if (room.lines[index]?.id.startsWith("context-reset-")) {
      resetIndex = index;
      break;
    }
  }
  const visible = room.lines
    .slice(resetIndex >= 0 ? resetIndex + 1 : 0)
    .filter((line) => line.role !== "tool");
  if (visible.length === 0) return "";
  return visible
    .map((line) => {
      if (line.role === "delegation") {
        const summary = line.summary?.trim() || "";
        if (!summary) return "";
        const name = line.authorName?.trim() || nameOf(room, line.authorId);
        return `${name}：${summary}`;
      }
      const who =
        line.role === "user"
          ? "用户"
          : line.role === "handback"
            ? `交回 ${nameOf(room, line.authorId)}`
            : line.role === "system"
              ? "系统"
              : nameOf(room, line.authorId);
      return `${who}：${line.text}`;
    })
    .filter((line) => line.length > 0)
    .join("\n");
}

export function holderSessionRelative(groupId: string, agentId: string): string {
  return `.runtime/groups/${groupId}/holders/${agentId}/sessions`;
}

function delegationLine(item: GroupPendingDelegation): GroupLine {
  return {
    id: item.id,
    at: item.at,
    role: "delegation",
    authorId: item.authorId,
    authorName: item.authorName,
    text: item.summary ?? "",
    mentionIds: [],
    taskId: item.taskId,
    brief: item.brief,
    activity: item.activity,
    handoff: item.handoff,
    ...(item.outcome ? { outcome: item.outcome } : {}),
    ...(item.summary ? { summary: item.summary } : {}),
    ...(item.parentLineId ? { parentLineId: item.parentLineId } : {}),
  };
}

/** 直播结束后，把还挂在气泡后面的子任务写到这条回复之后。已有结果的视为这一轮已经汇总。 */
function placePending(room: GroupRoom, parentLineId: string): GroupRoom {
  if (room.pendingDelegations.length === 0) return room;
  const lines = [
    ...room.lines,
    ...room.pendingDelegations.map((item) =>
      delegationLine({
        ...item,
        parentLineId: item.parentLineId || parentLineId || undefined,
      }),
    ),
  ];
  return { ...room, lines, pendingDelegations: [] };
}

/** 执掌者这轮回复已经看见的子任务结果，不再显示「完成待汇总」。 */
function consumeSettled(room: GroupRoom): GroupRoom {
  return {
    ...room,
    lines: room.lines.map((line) =>
      line.role === "delegation" && line.outcome && line.handoff === "pending"
        ? { ...line, handoff: "consumed" }
        : line,
    ),
  };
}

function patchDelegation(
  room: GroupRoom,
  taskId: string,
  patch: Partial<Pick<GroupPendingDelegation, "activity" | "summary" | "outcome">>,
  created?: { id: string; now: number },
): GroupRoom {
  let found = false;
  const pendingDelegations = room.pendingDelegations.map((item) => {
    if (item.taskId !== taskId) return item;
    found = true;
    return { ...item, ...patch };
  });
  const lines = room.lines.map((line) => {
    if (line.role !== "delegation" || line.taskId !== taskId) return line;
    found = true;
    return {
      ...line,
      ...patch,
      text: patch.summary ?? line.text,
    };
  });
  if (found) return { ...room, pendingDelegations, lines };
  if (!created) return room;
  const item: GroupPendingDelegation = {
    id: created.id,
    at: created.now,
    taskId,
    authorId: "",
    authorName: taskId,
    brief: "",
    activity: "running",
    handoff: "pending",
    ...patch,
  };
  if (room.holderSpeaking) {
    return { ...room, lines, pendingDelegations: [...pendingDelegations, item] };
  }
  return { ...room, pendingDelegations, lines: [...lines, delegationLine(item)] };
}

function startEffect(room: GroupRoom, type: "start_holder" | "resume_holder" | "merge_holder"): GroupEffect {
  if (!room.holderId) throw new GroupError("没有执掌者");
  return { type, agentId: room.holderId, prompt: projectTranscript(room) };
}

function append(room: GroupRoom, line: GroupLine): GroupRoom {
  return { ...room, lines: [...room.lines, line] };
}

/** 回到这条用户消息写入之前的房间，供改发重新 post。 */
function rewindBeforeUserLine(
  room: GroupRoom,
  index: number,
): { room: GroupRoom; cancelledTaskIds: string[] } {
  const kept = room.lines.slice(0, index);
  const removed = room.lines.slice(index);
  const removedIds = new Set(removed.map((line) => line.id));
  const cutRemovesTurn = removed.some(
    (line) => line.role === "agent" || line.role === "handback" || line.role === "system",
  );
  const removedTaskIds = new Set(removed.flatMap((line) => (line.taskId ? [line.taskId] : [])));
  for (const item of room.pendingDelegations) removedTaskIds.add(item.taskId);
  let taskIds = room.taskIds.filter((id) => !removedTaskIds.has(id));
  if (cutRemovesTurn) taskIds = [];
  const cancelledTaskIds = room.taskIds.filter((id) => !taskIds.includes(id));
  let queue = room.queue.filter((item) => !removedIds.has(item.messageId));
  if (cutRemovesTurn) queue = queue.filter((item) => kept.some((line) => line.id === item.messageId));
  const control = replayControl(kept, room.members, taskIds, queue);
  return {
    cancelledTaskIds,
    room: {
      ...room,
      lines: kept,
      queue: control.queue,
      taskIds,
      pendingDelegations: [],
      holderId: control.holderId,
      holderSpeaking: false,
      phase: control.phase,
    },
  };
}

function replayControl(
  lines: readonly GroupLine[],
  members: readonly GroupMember[],
  taskIds: readonly string[],
  queue: GroupQueueItem[],
): { holderId: string | null; phase: GroupRoom["phase"]; queue: GroupQueueItem[] } {
  let holderId: string | null = null;
  let phase: GroupRoom["phase"] = "idle";
  let nextQueue = queue;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const next = lines[index + 1];
    if (line.role === "user") {
      const mentions = line.mentionIds.length > 0 ? line.mentionIds : resolveMentions(members, line.text);
      if (!holderId && mentions[0]) {
        holderId = mentions[0];
        phase = taskIds.length > 0 ? "task" : "holding";
      }
      continue;
    }
    if (line.role === "system" && line.mentionIds[0]) {
      holderId = line.mentionIds[0];
      phase = taskIds.length > 0 ? "task" : "holding";
      continue;
    }
    if (line.role === "handback") {
      phase = taskIds.length > 0 ? "task" : holderId ? "holding" : "idle";
      continue;
    }
    if (line.role !== "agent") continue;
    if (next?.role === "system") continue;
    if (taskIds.length > 0) {
      phase = "task";
      continue;
    }
    if (next?.role === "handback" || next?.role === "agent" || next?.role === "delegation") {
      phase = holderId ? "holding" : "idle";
      continue;
    }
    phase = "idle";
    nextQueue = [];
  }
  if (taskIds.length > 0 && holderId) phase = "task";
  return { holderId, phase, queue: nextQueue };
}

export function resolveMentions(members: readonly GroupMember[], text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/@([^\s@]+)/g)) {
    const token = match[1] ?? "";
    const member = members.find((item) => item.agentId === token || item.name === token);
    if (!member || found.includes(member.agentId)) continue;
    found.push(member.agentId);
  }
  return found;
}

function nameOf(room: GroupRoom, agentId: string): string {
  return room.members.find((member) => member.agentId === agentId)?.name ?? agentId;
}

export function normalizeMembers(members: GroupMember[]): GroupMember[] {
  if (members.length < MEMBER_MIN || members.length > MEMBER_MAX) {
    throw new GroupError(`群成员需要 ${MEMBER_MIN} 到 ${MEMBER_MAX} 人`);
  }
  const seen = new Set<string>();
  const next: GroupMember[] = [];
  for (const member of members) {
    const agentId = member.agentId.trim();
    const name = member.name.trim();
    if (!agentId || !name) throw new GroupError("成员无效");
    if (seen.has(agentId)) throw new GroupError("成员重复");
    seen.add(agentId);
    next.push({ agentId, name });
  }
  return next;
}

/** 默认执掌者须在成员内；缺省或非法时回落 members[0]。 */
export function resolveDefaultHolderId(
  members: readonly GroupMember[],
  preferred?: string | null,
): string {
  const first = members[0];
  if (!first) throw new GroupError(`群成员需要 ${MEMBER_MIN} 到 ${MEMBER_MAX} 人`);
  if (preferred && members.some((member) => member.agentId === preferred)) {
    return preferred;
  }
  return first.agentId;
}

/**
 * 空闲时替换成员名单：busy 拒绝；执掌者不在新名单则清空；排队滤掉已离群的人。
 * 默认执掌者被移出则回落；显式 preferredDefaultHolderId 可改默认（不切换当前 holderId）。
 * 不改 title / lines / taskIds（调用方须在无进行中任务时调用）。
 */
export function applyMemberChange(
  room: Pick<GroupRoom, "holderId" | "holderSpeaking" | "taskIds" | "queue" | "defaultHolderId">,
  members: GroupMember[],
  preferredDefaultHolderId?: string | null,
): {
  members: GroupMember[];
  holderId: string | null;
  queue: GroupQueueItem[];
  defaultHolderId: string;
} {
  if (room.holderSpeaking || room.taskIds.length > 0) {
    throw new GroupError("群正在进行中，无法改成员");
  }
  const nextMembers = normalizeMembers(members);
  const ids = new Set(nextMembers.map((member) => member.agentId));
  const holderId =
    room.holderId && ids.has(room.holderId) ? room.holderId : null;
  const queue = room.queue.filter((item) => ids.has(item.agentId));
  const defaultHolderId = resolveDefaultHolderId(
    nextMembers,
    preferredDefaultHolderId !== undefined ? preferredDefaultHolderId : room.defaultHolderId,
  );
  return { members: nextMembers, holderId, queue, defaultHolderId };
}

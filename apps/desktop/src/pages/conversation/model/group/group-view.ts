import type {
  GroupLine,
  GroupMember,
  GroupQueueItem,
  GroupRoom,
} from "../../../../shared/api/runtime/groups";

export type GroupRoomView = Partial<GroupRoom> & { id?: string };

export function roomMembers(room: GroupRoomView): GroupMember[] {
  return room.members ?? [];
}

export function visibleGroupLines(room: GroupRoomView): GroupLine[] {
  return (room.lines ?? []).filter((line) => line.role !== "tool");
}

export function roomQueue(room: GroupRoomView): GroupQueueItem[] {
  return room.queue ?? [];
}

export function roomTaskIds(room: GroupRoomView): string[] {
  return room.taskIds ?? [];
}

/** 已经挂在某条用户消息下的排队 id。 */
export function attachedQueueIds(lines: GroupLine[], queue: GroupQueueItem[]): Set<string> {
  const ids = new Set<string>();
  for (const line of lines) {
    if (line.role !== "user") continue;
    for (const item of queue) {
      if (item.messageId === line.id) ids.add(item.id);
    }
  }
  return ids;
}

export function looseQueue(queue: GroupQueueItem[], attached: ReadonlySet<string>): GroupQueueItem[] {
  return queue.filter((item) => !attached.has(item.id));
}

export function memberName(members: GroupMember[], authorId: string): string {
  return members.find((member) => member.agentId === authorId)?.name || authorId;
}

export function roomHolder(room: GroupRoomView): GroupMember | null {
  return roomMembers(room).find((member) => member.agentId === room.holderId) ?? null;
}

export type HolderPhase = "idle" | "speaking" | "waiting" | "closing";

export function holderPhase(room: GroupRoomView): HolderPhase {
  if (!roomHolder(room)) return "idle";
  if (room.holderSpeaking) return "speaking";
  if (roomTaskIds(room).length > 0) return "waiting";
  return "idle";
}

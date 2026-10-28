import path from "node:path";

import type { HitlExtensionContext } from "../hitl/origin.js";

export type ConversationVisitKind = "personal" | "local" | "recruited";

/** 一次可运行的会话。同一 Agent 的一对一、群执掌和委托子会话不是同一个身份。 */
export type ConversationRef =
  | { kind: "single"; userId: string; visitKind: ConversationVisitKind; agentId: string }
  | { kind: "group"; userId: string; groupId: string; holderAgentId: string }
  | { kind: "delegation"; userId: string; taskId: string; parent: ConversationRef };

export function singleConversation(input: {
  userId: string;
  agentId: string;
  visitKind: ConversationVisitKind;
}): ConversationRef {
  return { kind: "single", userId: input.userId, visitKind: input.visitKind, agentId: input.agentId };
}

export function groupConversation(input: {
  userId: string;
  groupId: string;
  holderAgentId: string;
}): ConversationRef {
  return {
    kind: "group",
    userId: input.userId,
    groupId: input.groupId,
    holderAgentId: input.holderAgentId,
  };
}

export function conversationKey(conversation: ConversationRef): string {
  switch (conversation.kind) {
    case "single":
      return `single/${conversation.userId}/${conversation.visitKind}/${conversation.agentId}`;
    case "group":
      return `group/${conversation.userId}/${conversation.groupId}/${conversation.holderAgentId}`;
    case "delegation":
      return `delegation/${conversation.userId}/${conversation.taskId}`;
  }
}

/** 现有落盘位置。不改目录，只让调用方不再各自拼路径。 */
export function conversationSessionDir(input: {
  userDataRoot: string;
  /** 一对一和委托子会话的 visit 根。群会话不使用。 */
  visitRoot?: string;
  conversation: ConversationRef;
}): string {
  const conversation = input.conversation;
  switch (conversation.kind) {
    case "single":
      return path.join(requireVisitRoot(input.visitRoot), "sessions");
    case "group":
      return path.join(
        input.userDataRoot,
        "users",
        conversation.userId,
        ".runtime",
        "groups",
        conversation.groupId,
        "holders",
        conversation.holderAgentId,
        "sessions",
      );
    case "delegation":
      return path.join(requireVisitRoot(input.visitRoot), ".runtime", "delegations", conversation.taskId, "sessions");
  }
}

function requireVisitRoot(visitRoot: string | undefined): string {
  if (!visitRoot) throw new Error("一对一和委托会话需要 visitRoot");
  return visitRoot;
}

/** 打开 Pi 会话时写入 HITL。群身份显式带走，不从 agentId 反推。 */
export function hitlContextFor(conversation: ConversationRef): HitlExtensionContext {
  if (conversation.kind === "single") return { origin: "visit" };
  if (conversation.kind === "group") return { origin: "visit", groupId: conversation.groupId };
  const parent = hitlContextFor(conversation.parent);
  return {
    origin: "delegation",
    taskId: conversation.taskId,
    ...(parent.parentAgentId
      ? { parentAgentId: parent.parentAgentId }
      : conversation.parent.kind === "single"
        ? { parentAgentId: conversation.parent.agentId }
        : conversation.parent.kind === "group"
          ? { parentAgentId: conversation.parent.holderAgentId }
          : {}),
    ...(parent.groupId ? { groupId: parent.groupId } : {}),
  };
}

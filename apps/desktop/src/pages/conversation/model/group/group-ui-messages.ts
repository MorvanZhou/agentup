import type { UIMessage } from "ai";

import type { GroupLine, GroupPendingDelegation, GroupQueueItem } from "../../../../shared/api/runtime/groups";
import type { GroupDelegationCard } from "./group-delegation";
import { tf } from "../../../../shared/model/ui/ui-locale";
import {
  attachedQueueIds,
  looseQueue,
  memberName,
  roomMembers,
  roomQueue,
  visibleGroupLines,
  type GroupRoomView,
} from "./group-view";

export type GroupUiQueueCard = { id: string; label: string };

export type GroupUiAuthor = { id: string; name: string; avatarUrl?: string; role?: string };

/** 当前会话名单上的名片字段；群记录本身不保存这些。 */
export type GroupUiProfile = { avatarUrl?: string; role?: string };

/** ConversationPage → GroupThread 的名片行；流式时父级常 map 出新数组。 */
export type GroupMemberRoleRow = {
  agentId: string;
  role: string;
  avatarUrl?: string;
};

/** memberRoles 数组 → agentId 名片表。 */
export function profilesByAgentFromMemberRoles(
  roles: ReadonlyArray<GroupMemberRoleRow> | null | undefined,
): Record<string, GroupUiProfile> {
  const map: Record<string, GroupUiProfile> = {};
  for (const profile of roles ?? []) {
    map[profile.agentId] = {
      ...(profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
      ...(profile.role ? { role: profile.role } : {}),
    };
  }
  return map;
}

/** 名片内容是否一致（忽略对象引用）。 */
export function sameAgentUiProfiles(
  a: Readonly<Record<string, GroupUiProfile>>,
  b: Readonly<Record<string, GroupUiProfile>>,
): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    const left = a[key];
    const right = b[key];
    if (!right) return false;
    if ((left?.avatarUrl ?? "") !== (right.avatarUrl ?? "")) return false;
    if ((left?.role ?? "") !== (right.role ?? "")) return false;
  }
  return true;
}

/**
 * 内容不变时复用旧 map。
 * 避免 liveMessage 每个 chunk 拖着父级新 memberRoles 重建整棵历史消息树。
 */
export function reuseAgentUiProfiles(
  previous: Readonly<Record<string, GroupUiProfile>> | undefined,
  next: Record<string, GroupUiProfile>,
): Record<string, GroupUiProfile> {
  if (previous && sameAgentUiProfiles(previous, next)) {
    return previous as Record<string, GroupUiProfile>;
  }
  return next;
}

export type GroupUiCustom = {
  groupLineRole?: GroupLine["role"] | "queue";
  author?: GroupUiAuthor;
  queue?: GroupUiQueueCard[];
  delegation?: GroupDelegationCard;
  agentUpSummary?: unknown;
  agentUpArtifacts?: unknown;
  agentUpDeliverables?: unknown;
  agentUpReplyModel?: unknown;
  agentUpPreview?: unknown;
};

function authorOf(
  agentId: string,
  members: ReturnType<typeof roomMembers>,
  profiles?: Readonly<Record<string, GroupUiProfile>>,
): GroupUiAuthor {
  const profile = profiles?.[agentId];
  return {
    id: agentId,
    name: memberName(members, agentId),
    ...(profile?.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
    ...(profile?.role ? { role: profile.role } : {}),
  };
}

function textMessage(
  id: string,
  role: "user" | "assistant" | "system",
  text: string,
  custom: GroupUiCustom,
): UIMessage {
  return {
    id,
    role,
    parts: [{ type: "text", text, state: "done" }],
    metadata: { custom },
  } as UIMessage;
}

/** 有落盘 parts 的 agent 行：保留过程 / 工具，并把 summary/artifacts 并进 custom。 */
function agentMessage(
  line: GroupLine,
  author: GroupUiAuthor,
): UIMessage {
  const custom: GroupUiCustom = {
    groupLineRole: "agent",
    author,
    ...(line.assistantCustom?.agentUpSummary !== undefined
      ? { agentUpSummary: line.assistantCustom.agentUpSummary }
      : {}),
    ...(line.assistantCustom?.agentUpArtifacts !== undefined
      ? { agentUpArtifacts: line.assistantCustom.agentUpArtifacts }
      : {}),
    ...(line.assistantCustom?.agentUpDeliverables !== undefined
      ? { agentUpDeliverables: line.assistantCustom.agentUpDeliverables }
      : {}),
    ...(line.assistantCustom?.agentUpReplyModel !== undefined
      ? { agentUpReplyModel: line.assistantCustom.agentUpReplyModel }
      : {}),
    ...(line.assistantCustom?.agentUpPreview !== undefined
      ? { agentUpPreview: line.assistantCustom.agentUpPreview }
      : {}),
  };
  if (Array.isArray(line.parts) && line.parts.length > 0) {
    return {
      id: line.id,
      role: "assistant",
      parts: line.parts as UIMessage["parts"],
      metadata: { custom },
    } as UIMessage;
  }
  return textMessage(line.id, "assistant", line.text, custom);
}

function delegationCard(
  source: GroupLine | GroupPendingDelegation,
  author: GroupUiAuthor,
): GroupDelegationCard {
  const name = ("authorName" in source && source.authorName?.trim()) || author.name;
  return {
    id: source.id,
    taskId: source.taskId ?? "",
    authorId: "authorId" in source ? source.authorId : author.id,
    authorName: name,
    ...(author.avatarUrl ? { avatarUrl: author.avatarUrl } : {}),
    ...(author.role ? { role: author.role } : {}),
    brief: source.brief?.trim() || "",
    summary: source.summary?.trim() || "",
    ...(source.userSummary?.trim() ? { userSummary: source.userSummary.trim() } : {}),
    activity: source.activity === "queued" ? "queued" : "running",
    handoff: source.handoff === "consumed" ? "consumed" : "pending",
    ...(source.outcome ? { outcome: source.outcome } : {}),
  };
}

function delegationMessage(line: GroupLine, author: GroupUiAuthor): UIMessage {
  const card = delegationCard(line, author);
  const named = { ...author, name: card.authorName };
  // assistant-ui 会把连续的 assistant 并成一条。委派卡若也是 assistant，
  // 会吞掉前面执掌者的发言，气泡改画成子 Agent 卡片，那句话就从对话里消失。
  return {
    id: line.id,
    role: "system",
    parts: [{ type: "text", text: card.summary || card.brief, state: "done" }],
    metadata: {
      custom: {
        groupLineRole: "delegation",
        author: named,
        delegation: card,
      },
    },
  } as UIMessage;
}

/** 执掌者还在直播时，这些卡片排在直播气泡之后。 */
export function pendingDelegationCards(
  items: readonly GroupPendingDelegation[] | undefined,
  members: ReturnType<typeof roomMembers>,
  profiles?: Readonly<Record<string, GroupUiProfile>>,
): GroupDelegationCard[] {
  return (items ?? []).map((item) => delegationCard(item, authorOf(item.authorId, members, profiles)));
}

function queueCards(items: GroupQueueItem[], members: ReturnType<typeof roomMembers>): GroupUiQueueCard[] {
  return items.map((item) => ({
    id: item.id,
    label: tf("groupQueueCard", { name: memberName(members, item.agentId) }),
  }));
}

/** 直播中的执掌者气泡带上名字，和已经落盘的发言同一套作者信息。 */
export function withHolderAuthor(message: UIMessage, author: GroupUiAuthor): UIMessage {
  const metadata =
    message.metadata && typeof message.metadata === "object" ? message.metadata : {};
  const custom =
    "custom" in metadata && metadata.custom && typeof metadata.custom === "object"
      ? (metadata.custom as Record<string, unknown>)
      : {};
  return {
    ...message,
    metadata: {
      ...metadata,
      custom: {
        ...custom,
        groupLineRole: "agent",
        author: {
          id: author.id,
          name: author.name,
          ...(author.avatarUrl ? { avatarUrl: author.avatarUrl } : {}),
          ...(author.role ? { role: author.role } : {}),
        },
      },
    },
  };
}

/** 执掌者已开工、首个 stream chunk 未到时的占位气泡 id（不进落盘）。 */
export const GROUP_HOLDER_PENDING_LIVE_ID = "group-holder-pending";

/** 空 parts + streaming：AssistantMessage 左下角「工作中」，避免 1–2s 空白。 */
export function holderPendingLiveMessage(author: GroupUiAuthor): UIMessage {
  return withHolderAuthor(
    {
      id: GROUP_HOLDER_PENDING_LIVE_ID,
      role: "assistant",
      parts: [],
    } as UIMessage,
    author,
  );
}

/** 用户气泡纯文本，用来对上乐观发送与落盘行。 */
export function uiMessagePlainText(message: UIMessage): string {
  if (!Array.isArray(message.parts)) return "";
  return message.parts
    .map((part) => (part.type === "text" && typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

/**
 * 群聊助手「重新生成」：ExternalThread onReload 给的是助手前一条 id，
 * 往前找到最近用户行，原样走 edit（rewind + 重发），与编辑重发同一条 API。
 */
export function resolveGroupReloadEdit(
  messages: readonly UIMessage[],
  parentId: string | null,
): { messageId: string; text: string } | null {
  let index =
    parentId == null
      ? messages.length - 1
      : messages.findIndex((message) => message.id === parentId);
  if (index < 0) index = messages.length - 1;
  for (let i = index; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message || message.role !== "user") continue;
    const text = uiMessagePlainText(message);
    if (!text) return null;
    return { messageId: message.id, text };
  }
  return null;
}

/**
 * 群聊 wake 旁路：有 live 用真流；speaking 尚无 chunk 用占位；
 * pendingUserText 在 POST 返回前先亮用户气泡。
 */
export function resolveGroupWakeLive(input: {
  speaking: boolean;
  liveMessage: UIMessage | null;
  author: GroupUiAuthor | null;
  pendingUserText: string;
}): { streaming: boolean; message: UIMessage | null; userText: string } {
  const pendingUserText = input.pendingUserText.trim();
  const author = input.author;
  let message: UIMessage | null = null;
  if (input.liveMessage) {
    message = author ? withHolderAuthor(input.liveMessage, author) : input.liveMessage;
  } else if (input.speaking && author) {
    message = holderPendingLiveMessage(author);
  }
  return {
    streaming: input.speaking && Boolean(message),
    message,
    userText: pendingUserText,
  };
}

/** 可见群记录 → UIMessage。工具行不进入；未挂到用户消息的排队卡单独成条。 */
export function groupLinesToUiMessages(
  room: GroupRoomView,
  profiles?: Readonly<Record<string, GroupUiProfile>>,
): UIMessage[] {
  const members = roomMembers(room);
  const lines = visibleGroupLines(room);
  const queue = roomQueue(room);
  const attached = attachedQueueIds(lines, queue);
  const messages: UIMessage[] = [];

  for (const line of lines) {
    if (line.role === "system") {
      if (line.id.startsWith("context-reset-")) {
        messages.push(textMessage(line.id, "system", line.text, {}));
        continue;
      }
      messages.push(textMessage(line.id, "system", line.text, { groupLineRole: "system" }));
      continue;
    }
    if (line.role === "handback") {
      const author = authorOf(line.authorId, members, profiles);
      const label = tf("groupHandback", { name: author.name });
      messages.push(
        textMessage(line.id, "system", line.text ? `${label} · ${line.text}` : label, {
          groupLineRole: "handback",
          author,
        }),
      );
      continue;
    }
    if (line.role === "delegation") {
      messages.push(delegationMessage(line, authorOf(line.authorId, members, profiles)));
      continue;
    }
    if (line.role === "agent") {
      messages.push(agentMessage(line, authorOf(line.authorId, members, profiles)));
      continue;
    }
    const lineQueue = line.role === "user" ? queue.filter((item) => item.messageId === line.id) : [];
    messages.push(
      textMessage(line.id, "user", line.text, {
        groupLineRole: line.role,
        author: authorOf(line.authorId, members, profiles),
        ...(lineQueue.length > 0 ? { queue: queueCards(lineQueue, members) } : {}),
      }),
    );
  }

  for (const item of looseQueue(queue, attached)) {
    const cards = queueCards([item], members);
    messages.push(
      textMessage(`queue-${item.id}`, "system", cards[0]?.label ?? "", {
        groupLineRole: "queue",
        queue: cards,
      }),
    );
  }
  return messages;
}

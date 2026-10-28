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

export type GroupUiCustom = {
  groupLineRole?: GroupLine["role"] | "queue";
  author?: GroupUiAuthor;
  queue?: GroupUiQueueCard[];
  delegation?: GroupDelegationCard;
  agentUpSummary?: unknown;
  agentUpArtifacts?: unknown;
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

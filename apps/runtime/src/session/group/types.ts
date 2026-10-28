import type { UIMessage } from "ai";

/** 群是独立会话。任一时刻只有一个执掌者；工作单是他派出的任务。 */

export type GroupPhase = "idle" | "holding" | "task";

export type GroupMember = {
  agentId: string;
  name: string;
};

export type GroupLineRole = "user" | "agent" | "system" | "handback" | "tool" | "delegation";

/** 子 Agent 还在槽位里，或已经开始执行。等待用户时由界面按 HITL 另算。 */
export type GroupDelegationActivity = "queued" | "running";

export type GroupDelegationOutcome = "completed" | "failed" | "cancelled";

/** pending：子 Agent 已有结果，执掌者还没汇总。 */
export type GroupHandoff = "pending" | "consumed";

/** 执掌者这句还没落盘时，子任务先记在这里，界面排在直播气泡之后。 */
export type GroupPendingDelegation = {
  id: string;
  at: number;
  taskId: string;
  authorId: string;
  authorName: string;
  brief: string;
  activity: GroupDelegationActivity;
  handoff: GroupHandoff;
  outcome?: GroupDelegationOutcome;
  summary?: string;
  parentLineId?: string;
};

export const GROUP_RECORD_VERSION = 3;

/** 从 holder 会话投影出的副产物元数据；与群用的 author / groupLineRole 分开存。 */
export type GroupAssistantCustom = {
  agentUpSummary?: unknown;
  agentUpArtifacts?: unknown;
};

export type GroupLine = {
  id: string;
  at: number;
  role: GroupLineRole;
  authorId: string;
  text: string;
  mentionIds: string[];
  taskId?: string;
  queueId?: string;
  /** 子 Agent 展示名快照。名片改名后历史消息仍可读。 */
  authorName?: string;
  brief?: string;
  activity?: GroupDelegationActivity;
  handoff?: GroupHandoff;
  outcome?: GroupDelegationOutcome;
  summary?: string;
  parentLineId?: string;
  /** 执掌者气泡完整 parts（过程 / 工具 / 正文）；旧行没有。 */
  parts?: UIMessage["parts"];
  assistantCustom?: GroupAssistantCustom;
};

/** 回合收尾时挂到 agent 行的可选副产物。 */
export type GroupAssistantPayload = {
  parts?: UIMessage["parts"];
  assistantCustom?: GroupAssistantCustom;
};

export type GroupQueueItem = {
  id: string;
  agentId: string;
  text: string;
  messageId: string;
};

export type GroupRoom = {
  /** 不匹配就丢弃。群记录还在开发，不保留旧形状。 */
  version: typeof GROUP_RECORD_VERSION;
  id: string;
  userId: string;
  title: string;
  members: GroupMember[];
  lines: GroupLine[];
  holderId: string | null;
  /** 执掌者会话正在处理用户刚说的话。 */
  holderSpeaking: boolean;
  phase: GroupPhase;
  taskIds: string[];
  /** 执掌者气泡还在直播时，子任务先排在它后面，落盘后再写入 lines。 */
  pendingDelegations: GroupPendingDelegation[];
  queue: GroupQueueItem[];
};

export type GroupEffect =
  | { type: "stored" }
  | { type: "start_holder"; agentId: string; prompt: string }
  | { type: "resume_holder"; agentId: string; prompt: string }
  | { type: "merge_holder"; agentId: string; prompt: string };

export class GroupError extends Error {}

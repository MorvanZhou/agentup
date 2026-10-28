import type { Component, ComputedRef, InjectionKey, Ref } from "vue";
import { computed, inject } from "vue";

/** 单聊默认开模型、附件、改发和建议。Skill 入口先关掉，以后再开。 */
export type ChatSurfaceCapabilities = {
  modelPicker: boolean;
  skills: boolean;
  attachments: boolean;
  /** reference：上传落盘并插入 @ATTACHMENTS，适用于群聊。 */
  attachmentMode: "inline" | "reference";
  editResend: boolean;
  suggestions: boolean;
  /** 群成员可作为 @ 提及；附件落到被提及成员或当前执掌者的目录。 */
  mentions: ReadonlyArray<{ id: string; name: string; role?: string; avatarUrl?: string }>;
  /** 未 @ 时继续使用当前执掌者的资源；空表示必须先 @。 */
  defaultResourceAgentId: string;
  /** 空字符串时 Composer 用单聊占位文案。 */
  placeholder: string;
  /** 群附件写入共享工作区；单聊为空。 */
  groupId?: string;
};

const full: ChatSurfaceCapabilities = {
  modelPicker: true,
  skills: false,
  attachments: true,
  attachmentMode: "inline",
  editResend: true,
  suggestions: true,
  mentions: [],
  defaultResourceAgentId: "",
  placeholder: "",
};

export const chatSurfaceKey = Symbol("chatSurface") as InjectionKey<
  Ref<ChatSurfaceCapabilities> | ComputedRef<ChatSurfaceCapabilities>
>;

/** 单聊不单独 provide，沿用这份完整能力。 */
const defaultSurface = computed(() => full);

export function injectChatSurface(): ComputedRef<ChatSurfaceCapabilities> {
  const value = inject(chatSurfaceKey, defaultSurface);
  return computed(() => ({ ...full, ...value.value }));
}

export function groupChatCapabilities(input: {
  placeholder: string;
  members: ReadonlyArray<{ id: string; name: string; role?: string; avatarUrl?: string }>;
  defaultResourceAgentId: string;
  groupId: string;
}): ChatSurfaceCapabilities {
  return {
    modelPicker: true,
    skills: false,
    attachments: true,
    attachmentMode: "reference",
    editResend: true,
    suggestions: false,
    mentions: input.members,
    defaultResourceAgentId: input.defaultResourceAgentId,
    placeholder: input.placeholder,
    groupId: input.groupId,
  };
}

/**
 * Composer 模型下拉绑哪一个 Pi session。
 * 单聊就是当前线程；群里优先当前执掌者，空闲时跟草稿里的 @，否则用第一位成员，
 * 这样选择会写进即将开工的那个人的会话模型（群回合也读这份）。
 */
export function sessionModelAgentId(input: {
  threadAgentId: string;
  memberIds: readonly string[];
  holderId: string;
  draftMentionId: string;
}): string {
  if (input.memberIds.length === 0) return input.threadAgentId;
  if (input.holderId) return input.holderId;
  return input.draftMentionId || input.memberIds[0] || "";
}

/**
 * 附件 / Skill 等资源落到哪一个 agent 目录。
 * 单聊必须回落到线程 agent（勿因空的 defaultResourceAgentId 把入口关掉）；
 * 群里优先草稿 @，否则执掌者；两者皆空则入口应隐藏。
 */
export function composerResourceAgentId(input: {
  threadAgentId: string;
  memberIds: readonly string[];
  holderId: string;
  draftMentionId: string;
}): string {
  if (input.memberIds.length === 0) return input.threadAgentId;
  return input.draftMentionId || input.holderId;
}

/** 工具条附件入口：能力开且已有可落盘的 agent。 */
export function composerShowAttachments(
  attachmentsEnabled: boolean,
  resourceAgentId: string,
): boolean {
  return attachmentsEnabled && Boolean(resourceAgentId);
}

/** 系统 / 交回 / 未挂上的排队卡 / 子 Agent 任务卡。用户和助手气泡走各自组件。 */
export type ChatSurfaceKind = "system" | "handback" | "queue" | "delegation";

export function chatSurfaceKind(metadata: unknown): ChatSurfaceKind | null {
  if (!metadata || typeof metadata !== "object") return null;
  const custom = (metadata as { custom?: { groupLineRole?: unknown } }).custom;
  const role = custom?.groupLineRole;
  if (role === "system" || role === "handback" || role === "queue" || role === "delegation") return role;
  return null;
}

export function chatMessageAuthor(
  metadata: unknown,
): { name: string; avatarUrl?: string; role?: string } | null {
  if (!metadata || typeof metadata !== "object") return null;
  const author = (
    metadata as {
      custom?: { author?: { name?: unknown; avatarUrl?: unknown; role?: unknown } };
    }
  ).custom?.author;
  if (!author || typeof author.name !== "string" || !author.name) return null;
  return {
    name: author.name,
    avatarUrl: typeof author.avatarUrl === "string" ? author.avatarUrl : undefined,
    role: typeof author.role === "string" && author.role ? author.role : undefined,
  };
}

/** 用户气泡底部的场景插槽（群排队卡）。不提供时单聊不渲染。 */
export const chatMessageFooterKey = Symbol("chatMessageFooter") as InjectionKey<Component>;

export function injectChatMessageFooter(): Component | null {
  return inject(chatMessageFooterKey, null);
}

/** 群里子任务还在跑时，输入框按单聊互斥：空→停，有字→发。 */
export const chatWaveBusyKey = Symbol("chatWaveBusy") as InjectionKey<Ref<boolean> | ComputedRef<boolean>>;

export function injectChatWaveBusy(): ComputedRef<boolean> {
  const value = inject(chatWaveBusyKey, null);
  return computed(() => value?.value === true);
}

/** 直播气泡之后的子任务卡。不提供时单聊不渲染。 */
export const chatDelegationTrailKey = Symbol("chatDelegationTrail") as InjectionKey<Component>;

export function injectChatDelegationTrail(): Component | null {
  return inject(chatDelegationTrailKey, null);
}

/** 已落盘的子任务消息。不提供时退回普通助手气泡。 */
export const chatDelegationMessageKey = Symbol("chatDelegationMessage") as InjectionKey<Component>;

export function injectChatDelegationMessage(): Component | null {
  return inject(chatDelegationMessageKey, null);
}

export const chatQueueCancelKey = Symbol("chatQueueCancel") as InjectionKey<(queueId: string) => void>;

export const chatQueueBusyKey = Symbol("chatQueueBusy") as InjectionKey<Ref<boolean> | ComputedRef<boolean>>;

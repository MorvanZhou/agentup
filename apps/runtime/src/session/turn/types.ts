import type { ImageContent } from "@earendil-works/pi-ai";
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";

import type { ModelConfig } from "../../config/load.js";
import type { Visit } from "../../package/sync.js";
import type { ExternalAgentQuery } from "../model/agent-sdk.js";

export type VisitChatsWakeDeps = {
  resolveVisit: (
    userId: string,
    agentId: string,
    kind: Visit["kind"],
  ) => Visit | null | Promise<Visit | null>;
  resolveModel: (visit: Visit) => ModelConfig;
};

export type PromptRewind = {
  /** Pi user entry id（历史消息 id）；优先。 */
  messageId?: string;
  /** 当前会话分支上、从 0 起的 user turn 下标；messageId 对不上时回退。 */
  userTurnOrdinal?: number;
};

export type PromptOptions = {
  expandPromptTemplates?: boolean;
  images?: ImageContent[];
};

export interface PromptSession {
  subscribe(listener: (event: AgentSessionEvent) => void): () => void;
  prompt(text: string, options?: PromptOptions): Promise<void>;
  /** 注入下一轮 LLM 上下文（不写进用户原文）；见 Pi deliverAs nextTurn。 */
  sendCustomMessage?: AgentSession["sendCustomMessage"];
  /**
   * Pi 原生 steer：把新消息插到"当前工具批次跑完、下一次 LLM 调用之前"，保留已做的工作
   * （.cursor/skills/agentup-sdk-adapter/references/follow-up.md）。只有 API / Pi 原生接入会用到；SDK 接入没有它，走 followUp 队列。
   */
  steer?: AgentSession["steer"];
  /**
   * 本地 Agent App 的直连事件流；存在时绕开 Pi agent loop，保留 SDK 工具过程与结果。
   * signal：Composer 停止须在 startTurn 冷启期间就能 abort（勿等起流返回后再挂）。
   */
  externalQuery?: (prompt: string, signal?: AbortSignal) => Promise<ExternalAgentQuery>;
  /** 中断当前 turn，并等到会话空闲。 */
  abort(): Promise<void>;
  dispose(): void;
  navigateTree?(
    targetId: string,
    options?: { summarize?: boolean },
  ): Promise<{ editorText?: string; cancelled: boolean }>;
  sessionManager?: AgentSession["sessionManager"];
  resourceLoader?: AgentSession["resourceLoader"];
}

export class ChatBusy extends Error {
  constructor() {
    super("正在回复");
  }
}

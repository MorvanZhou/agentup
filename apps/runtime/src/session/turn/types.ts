import type { ImageContent } from "@earendil-works/pi-ai";
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";

import type { ModelConfig } from "../../config/load.js";
import type { Visit } from "../../package/sync.js";

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

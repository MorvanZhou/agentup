import path from "node:path";

import type { ImageContent } from "@earendil-works/pi-ai";
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { createUIMessageStream, type UIMessageChunk } from "ai";

import type { ModelConfig } from "../config/load.js";
import type { UiLocale } from "../i18n/locale.js";
import type { Visit } from "../package/sync.js";
import { ApprovalBroker } from "./approval.js";
import {
  materializePromptImages,
  type PromptAttachment,
} from "./attachments.js";
import {
  discoverRecruitedAgents,
  formatDiscoveredAgentsContext,
  RELEVANT_AGENTS_CUSTOM_TYPE,
  type DelegationService,
} from "./delegation/index.js";
import { expandSkillReferences } from "./expand-skills.js";
import { PiUIMessageProjector } from "./frames.js";
import {
  isModelServiceUnavailable,
  isUserCancelError,
  modelUnavailableNotice,
} from "./model-unavailable.js";
import { openSession } from "./open.js";
import { AskUserBroker } from "./tools/index.js";

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

export async function openPromptSession(
  visit: Visit,
  model: ModelConfig,
  approvals?: ApprovalBroker,
  askUser?: AskUserBroker,
  delegation?: DelegationService,
): Promise<PromptSession> {
  const opened = await openSession(visit, model, approvals, askUser, delegation);
  return opened.session;
}

type Slot = {
  digest: string;
  /** templateId::modelId；换模型时重建 Slot。 */
  modelKey: string;
  session: PromptSession;
  busy: boolean;
  stale: boolean;
  /** 当前 turn 的 finally 完成后 resolve；供 abort 等待 busy 真正解开。 */
  turnDone?: Promise<void>;
  resolveTurn?: () => void;
};

function slotModelKey(model: ModelConfig): string {
  return `${model.templateId}::${model.modelId}`;
}

export class VisitChats {
  private readonly sessions = new Map<string, Slot>();

  constructor(
    private readonly open: (visit: Visit, model: ModelConfig) => Promise<PromptSession> = openPromptSession,
    private readonly approvals?: ApprovalBroker,
    private readonly askUser?: AskUserBroker,
    private readonly delegation?: DelegationService,
  ) {}

  busy(userId: string, agentId: string, kind: Visit["kind"] = "recruited"): boolean {
    return this.sessions.get(visitKey(userId, agentId, kind))?.busy === true;
  }

  /** 当前用户下主会话正在跑 turn 的 agentId（侧栏 working）。 */
  busyAgentIds(userId: string): string[] {
    const ids: string[] = [];
    for (const [key, slot] of this.sessions) {
      if (!slot.busy) continue;
      const [uid, , agentId] = key.split("/");
      if (uid === userId && agentId) ids.push(agentId);
    }
    return ids;
  }

  /**
   * 用户停止 / 清上下文：中断 Pi 当前 turn，并等到 busy 解开。
   * 空闲时为 no-op。
   */
  async abort(userId: string, agentId: string, kind: Visit["kind"] = "recruited"): Promise<void> {
    const key = visitKey(userId, agentId, kind);
    const current = this.sessions.get(key);
    if (!current?.busy) return;
    await current.session.abort();
    if (current.turnDone) await current.turnDone;
  }

  release(userId: string, agentId: string, kind: Visit["kind"] = "recruited"): void {
    const key = visitKey(userId, agentId, kind);
    const current = this.sessions.get(key);
    if (!current) return;
    if (current.busy) throw new ChatBusy();
    this.disposeKey(key);
  }

  /** 私人助理资料 / skills / MCP / AGENTS.md 变更后只作废私人助理会话。 */
  invalidatePersonalAssistant(userId: string): void {
    this.invalidate(userId, "personal-assistant", "personal");
  }

  /** 作废指定 Visit 的内存会话（忙则标 stale）。 */
  invalidate(userId: string, agentId: string, kind: Visit["kind"] = "recruited"): void {
    const target = visitKey(userId, agentId, kind);
    const current = this.sessions.get(target);
    if (!current) return;
    if (current.busy) {
      current.stale = true;
      return;
    }
    this.disposeKey(target);
  }

  async promptStream(
    visit: Visit,
    model: ModelConfig,
    text: string,
    signal?: AbortSignal,
    rewind?: PromptRewind,
    attachments: readonly PromptAttachment[] = [],
    locale?: UiLocale | string | null,
  ) {
    const key = visitKey(visit.userId, visit.agentId, visit.kind);
    const nextModelKey = slotModelKey(model);
    let current = this.sessions.get(key);
    if (
      current &&
      (current.digest !== visit.packageDigest || current.stale || current.modelKey !== nextModelKey)
    ) {
      if (current.busy) throw new ChatBusy();
      this.disposeKey(key);
      current = undefined;
    }
    if (current?.busy) throw new ChatBusy();
    if (!current) {
      current = {
        digest: visit.packageDigest,
        modelKey: nextModelKey,
        session: await this.open(visit, model),
        busy: false,
        stale: false,
      };
      this.sessions.set(key, current);
    }
    const slot = current;
    slot.busy = true;
    slot.turnDone = new Promise<void>((resolve) => {
      slot.resolveTurn = resolve;
    });
    return createUIMessageStream({
      execute: async ({ writer }) => {
        const projector = new PiUIMessageProjector();
        const write = (chunks: UIMessageChunk[]) => {
          for (const chunk of chunks) writer.write(chunk);
        };
        let lastModelError = "";
        let sawAssistantText = false;
        const unsubscribe = slot.session.subscribe((event) => {
          trackModelFailure(event, (error) => {
            lastModelError = error;
          });
          if (
            event.type === "message_update" &&
            event.assistantMessageEvent.type === "text_delta" &&
            typeof event.assistantMessageEvent.delta === "string" &&
            event.assistantMessageEvent.delta.length > 0
          ) {
            sawAssistantText = true;
          }
          write(projector.project(event));
        });
        const unsubscribeApproval = this.approvals?.subscribe((request) => {
          if (request.userId !== visit.userId) return;
          if (
            request.agentId !== visit.agentId &&
            !this.delegation?.isNestedUnder(visit.userId, visit.agentId, request.agentId)
          ) {
            return;
          }
          write(
            projector.approval({
              id: request.id,
              toolCallId: request.toolCallId,
              toolName: request.toolName,
              args: request.args,
            }),
          );
        });
        const unsubscribeAskUser = this.askUser?.subscribe((request) => {
          if (request.userId !== visit.userId) return;
          if (
            request.agentId !== visit.agentId &&
            !this.delegation?.isNestedUnder(visit.userId, visit.agentId, request.agentId)
          ) {
            return;
          }
          write(
            projector.askUser({
              id: request.id,
              toolCallId: request.toolCallId,
              questions: request.questions,
            }),
          );
        });
        // 委托 started：只写 transient 元数据，过程走 /delegations/:id/stream 旁路。
        const unsubscribeDelegationStarted = this.delegation?.subscribeStarted((event) => {
          if (event.userId !== visit.userId || event.fromAgentId !== visit.agentId) return;
          write(
            projector.delegationStarted({
              taskId: event.taskId,
              toolCallId: event.toolCallId,
              toAgentId: event.toAgentId,
              toAgentName: event.toAgentName,
              brief: event.brief,
              wait: event.wait,
            }),
          );
        });
        const onAbort = () => {
          void slot.session.abort().catch(() => undefined);
        };
        if (signal?.aborted) onAbort();
        else signal?.addEventListener("abort", onAbort, { once: true });
        try {
          await rewindSession(slot.session, rewind);
          const cwd = path.join(visit.root, "cwd");
          // 非图片已在 Composer 插入时落盘，正文含 @ATTACHMENTS/...；此处只处理图片 vision。
          const images = materializePromptImages(cwd, attachments);
          const promptText = text.trim();
          if (!promptText && images.length === 0) throw new Error("消息为空");
          // 任意位置的 `/name`|/skill:name` 由 harness 展开，避免依赖 Pi 仅识别行首 `/skill:`。
          const skills = slot.session.resourceLoader?.getSkills().skills ?? [];
          const expanded = expandSkillReferences(promptText || "(图片附件)", skills);
          // 每轮检索已招募专家，经 nextTurn custom message 注入模型上下文（不污染用户落盘原文）。
          if (this.delegation && slot.session.sendCustomMessage) {
            try {
              const roster = await this.delegation.listRecruited(visit.userId);
              const others = roster.filter((agent) => agent.agentId !== visit.agentId);
              const discovered = discoverRecruitedAgents(others, promptText);
              const block = formatDiscoveredAgentsContext(discovered);
              if (block) {
                await slot.session.sendCustomMessage(
                  {
                    customType: RELEVANT_AGENTS_CUSTOM_TYPE,
                    content: block,
                    display: false,
                  },
                  { deliverAs: "nextTurn" },
                );
              }
            } catch {
              // 发现失败不阻断对话；模型仍可主动 list_recruited_agents。
            }
          }
          await slot.session.prompt(expanded, {
            expandPromptTemplates: false,
            ...(images.length > 0 ? { images } : {}),
          });
          if (
            !sawAssistantText &&
            lastModelError &&
            isModelServiceUnavailable(lastModelError)
          ) {
            const notice = modelUnavailableNotice(locale);
            write(projector.modelUnavailable(notice));
            write(projector.finish());
          } else {
            write(projector.finish());
          }
        } catch (error) {
          const raw = error instanceof Error && error.message ? error.message : "对话失败";
          if (isModelServiceUnavailable(raw) && !isUserCancelError(raw)) {
            const notice = modelUnavailableNotice(locale);
            if (!sawAssistantText) write(projector.modelUnavailable(notice));
            write(projector.finish(notice));
          } else {
            write(projector.finish(raw));
          }
        } finally {
          // busy 跟 Pi prompt 对齐，不跟 HTTP 消费者断开（onEnd/cancel）对齐；
          // 停止时由 signal / VisitChats.abort 调用 session.abort()，再在这里清 busy。
          signal?.removeEventListener("abort", onAbort);
          unsubscribeDelegationStarted?.();
          unsubscribeAskUser?.();
          unsubscribeApproval?.();
          unsubscribe();
          slot.busy = false;
          slot.resolveTurn?.();
          slot.resolveTurn = undefined;
          slot.turnDone = undefined;
          if (slot.stale) this.disposeKey(key);
        }
      },
    });
  }

  private disposeKey(key: string): void {
    const current = this.sessions.get(key);
    if (!current) return;
    current.session.dispose();
    this.sessions.delete(key);
    const [userId, , agentId] = key.split("/");
    if (userId && agentId) this.approvals?.clearSessionAllow(userId, agentId);
  }
}

/** 从 Pi 事件里收集最近一次模型失败文案（含 auto-retry）。 */
function trackModelFailure(
  event: AgentSessionEvent,
  setError: (message: string) => void,
): void {
  if (event.type === "auto_retry_start" && event.errorMessage) {
    setError(event.errorMessage);
    return;
  }
  if (event.type === "auto_retry_end") {
    if (!event.success && event.finalError) setError(event.finalError);
    return;
  }
  if (event.type !== "entry_appended") return;
  const entry = event.entry;
  if (entry.type !== "message") return;
  const message = entry.message as { role?: string; errorMessage?: unknown };
  if (message.role !== "assistant") return;
  if (typeof message.errorMessage === "string" && message.errorMessage.trim()) {
    setError(message.errorMessage.trim());
  }
}

function visitKey(userId: string, agentId: string, kind: Visit["kind"] = "recruited"): string {
  const bucket = kind === "personal" ? "personal" : kind === "local" ? "local" : "recruited";
  return `${userId}/${bucket}/${agentId}`;
}

/** 编辑旧 user message 重发前：navigateTree 回退对话，checkpoint 扩展顺带还原文件。 */
async function rewindSession(session: PromptSession, rewind?: PromptRewind): Promise<void> {
  if (!rewind) return;
  const targetId = resolveRewindEntryId(session, rewind);
  if (!targetId || typeof session.navigateTree !== "function") return;
  const result = await session.navigateTree(targetId);
  if (result.cancelled) throw new Error("已取消回退对话");
}

function resolveRewindEntryId(session: PromptSession, rewind: PromptRewind): string | undefined {
  const manager = session.sessionManager;
  if (!manager) return undefined;

  if (rewind.messageId) {
    const entry = manager.getEntry(rewind.messageId);
    if (entry?.type === "message" && entry.message.role === "user") return entry.id;
  }

  if (typeof rewind.userTurnOrdinal !== "number" || rewind.userTurnOrdinal < 0) return undefined;
  const users = manager.getBranch().filter(
    (entry) => entry.type === "message" && entry.message.role === "user",
  );
  return users[rewind.userTurnOrdinal]?.id;
}

import fs from "node:fs";
import path from "node:path";

import type { ModelConfig } from "../../config/load.js";
import { t } from "../../i18n/index.js";
import type { Visit } from "../../package/sync.js";
import { groupConversation, type ConversationRef } from "../core/conversation-ref.js";
import { readLastAssistantAt } from "../history/history.js";
import type { ApprovalBroker } from "../hitl/approval/index.js";
import type { ShellHangBroker } from "../hitl/shell-hang/index.js";
import { expandSkillReferences } from "../skills/expand.js";
import type { AskUserBroker } from "../tools/index.js";
import { customMessageDelivery } from "../turn/custom-message-delivery.js";
import { userDataRootFromVisit } from "../context/user-data-root.js";
import { compactTurnOptions, maybeCompactApiSession } from "../model/agent-sdk.js";
import { runExternalSessionTurn } from "../turn/external-turn.js";
import { createSdkInterruptQueue, linkTurnSignal } from "../turn/sdk-interrupt.js";
import { runObservedTurn } from "../turn/turn-runner.js";
import type { PromptSession } from "../turn/types.js";
import type { GroupTurnDriver, GroupTurnHandle } from "./turns.js";

const GROUP_CUE = "agentup.group_cue";

export type HolderSessionOpener = (
  visit: Visit,
  model: ModelConfig,
  sessionDir: string,
  conversation: ConversationRef,
) => Promise<PromptSession>;

/**
 * 用成员自己的人格、技能和 cwd 开一轮，会话文件放在群的 holders 目录。
 * 调用方传入的 sessionDir 决定落点，这里不再改回一对一 sessions/。
 *
 * 中途用户句：
 * - Pi：原生 `steer`（当前工具批次后、下一次 LLM 前；与一对一 / 委托同形）
 *   禁止 `deliverAs: nextTurn`——holder 本轮只有一次 `prompt()`，dispose 前 nextTurn 永不 flush
 * - SDK：打断当前 external 轮 + Host 重拼续轮（与委托 SDK steer 同形）
 */
export function createHolderTurnDriver(deps: {
  resolveVisit: (userId: string, agentId: string) => Visit | null | Promise<Visit | null>;
  resolveModel: (visit: Visit, scope: { userId: string; groupId: string }) => ModelConfig;
  open: HolderSessionOpener;
  approvals?: ApprovalBroker;
  askUser?: AskUserBroker;
  shellHang?: ShellHangBroker;
}): GroupTurnDriver {
  return {
    async start(input) {
      const visit = await deps.resolveVisit(input.userId, input.agentId);
      if (!visit) throw new Error(t("group.holderUnopenable"));
      fs.mkdirSync(input.sessionDir, { recursive: true });
      const conversation = groupConversation({
        userId: input.userId,
        groupId: input.groupId,
        holderAgentId: input.agentId,
      });
      const model = deps.resolveModel(visit, { userId: input.userId, groupId: input.groupId });
      const session = await deps.open(visit, model, input.sessionDir, conversation);
      const stopController = new AbortController();
      const abortTurn = () => stopController.abort();
      if (input.signal.aborted) abortTurn();
      else input.signal.addEventListener("abort", abortTurn, { once: true });

      const isExternal = Boolean(session.externalQuery);
      const compact = isExternal
        ? compactTurnOptions({
            userDataRoot: userDataRootFromVisit(visit),
            prefer: model,
            signal: stopController.signal,
          })
        : undefined;
      const sdkCues: string[] = [];
      let turnGate = new AbortController();
      const enqueueSdkCue = createSdkInterruptQueue({
        notes: sdkCues,
        interrupt: () => turnGate.abort(),
      });

      const handle: GroupTurnHandle = {
        async inject(cue) {
          const body = cue.trim();
          if (!body) return;
          if (isExternal) {
            // 账本仍记 cue，续轮 externalPromptFromSession 能看见；同时打断正在跑的厂商 agent
            if (session.sendCustomMessage) {
              await session.sendCustomMessage(
                { customType: GROUP_CUE, content: body, display: false },
                customMessageDelivery(session),
              );
            }
            await enqueueSdkCue(body);
            return;
          }
          // API / Pi：与 VisitChats.steer / 委托 bindSteer 同形
          if (session.steer) {
            const disposition = await session.steer(body);
            if (disposition !== "queued" && disposition !== "handled") {
              throw new Error("group inject steer was not queued");
            }
            return;
          }
          // 无 steer 的兜底：streaming 时默认 deliverAs 即 steer，勿用 nextTurn
          if (!session.sendCustomMessage) return;
          await session.sendCustomMessage(
            { customType: GROUP_CUE, content: body, display: false },
            { deliverAs: "steer" },
          );
        },
        abort: async () => {
          stopController.abort();
          await session.abort();
        },
      };

      try {
        input.onReady(handle);
        if (input.signal.aborted || stopController.signal.aborted) throw new Error("aborted");
        const skills = session.resourceLoader?.getSkills?.().skills ?? [];
        const prompt = input.prompt.trim();
        if (!prompt) throw new Error(t("chat.emptyAssistantResult"));
        const expanded = expandSkillReferences(prompt, skills);

        if (!isExternal) {
          await maybeCompactApiSession({
            session,
            userText: expanded,
            userDataRoot: userDataRootFromVisit(visit),
            model,
            signal: stopController.signal,
          });
          const { visibleText } = await runObservedTurn({
            session,
            signal: input.signal,
            write: input.onChunk,
            errorPolicy: "propagate",
            hitl: {
              accept: (request) => request.userId === input.userId && request.groupId === input.groupId,
              approvals: deps.approvals,
              askUser: deps.askUser,
              shellHang: deps.shellHang,
            },
            run: () => session.prompt(expanded, { expandPromptTemplates: false }),
          });
          let message;
          try {
            message =
              (await readLastAssistantAt(path.join(visit.root, "cwd"), input.sessionDir)) ?? undefined;
          } catch {
            // 投影失败时仍交回正文；桌面回落为纯文本气泡。
          }
          return { text: visibleText.trim(), ...(message ? { message } : {}) };
        }

        // SDK：可被中途 inject 打断并续轮
        let activePrompt = expanded;
        const visibleParts: string[] = [];
        for (;;) {
          if (turnGate.signal.aborted) turnGate = new AbortController();
          const turnSignal = linkTurnSignal(stopController.signal, turnGate.signal);
          let lastExternal: Awaited<ReturnType<typeof runExternalSessionTurn>> = null;
          try {
            lastExternal = await runExternalSessionTurn({
              session,
              text: activePrompt,
              userText: activePrompt,
              signal: turnSignal,
              write: input.onChunk,
              errorPolicy: "propagate",
              hitl: {
                accept: (request) =>
                  request.userId === input.userId && request.groupId === input.groupId,
                ...(deps.approvals ? { approvals: deps.approvals } : {}),
                ...(deps.askUser ? { askUser: deps.askUser } : {}),
              },
              ...(compact ?? {}),
            });
          } finally {
            turnSignal.dispose();
          }

          const part = lastExternal?.visibleText.trim() || "";
          if (part) visibleParts.push(part);

          if (stopController.signal.aborted || input.signal.aborted) {
            break;
          }
          if (sdkCues.length > 0) {
            // 打断时 writeBack 跳过：原 prompt 可能未落盘，续轮须 Host 重拼（同委托 SDK steer）
            const notes = sdkCues.splice(0).join("\n");
            activePrompt = ["## Original turn", expanded, "", "## Inserted while you were working", notes].join(
              "\n",
            );
            continue;
          }
          break;
        }

        const text = visibleParts.join("\n").trim();
        let message;
        try {
          message =
            (await readLastAssistantAt(path.join(visit.root, "cwd"), input.sessionDir)) ?? undefined;
        } catch {
          // 投影失败时仍交回正文
        }
        return { text, ...(message ? { message } : {}) };
      } finally {
        input.signal.removeEventListener("abort", abortTurn);
        try {
          session.dispose();
        } catch {
          // 会话已经关掉。
        }
      }
    },
  };
}

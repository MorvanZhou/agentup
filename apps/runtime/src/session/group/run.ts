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
 */
export function createHolderTurnDriver(deps: {
  resolveVisit: (userId: string, agentId: string) => Visit | null | Promise<Visit | null>;
  resolveModel: (visit: Visit) => ModelConfig;
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
      const session = await deps.open(visit, deps.resolveModel(visit), input.sessionDir, conversation);
      const handle: GroupTurnHandle = {
        async inject(cue) {
          if (!session.sendCustomMessage) return;
          await session.sendCustomMessage(
            { customType: GROUP_CUE, content: cue, display: false },
            { deliverAs: "nextTurn" },
          );
        },
        abort: () => session.abort(),
      };
      try {
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
          run: async () => {
            input.onReady(handle);
            if (input.signal.aborted) throw new Error("aborted");
            const skills = session.resourceLoader?.getSkills?.().skills ?? [];
            const prompt = input.prompt.trim();
            if (!prompt) throw new Error(t("chat.emptyAssistantResult"));
            await session.prompt(expandSkillReferences(prompt, skills), { expandPromptTemplates: false });
          },
        });
        let message;
        try {
          message =
            (await readLastAssistantAt(path.join(visit.root, "cwd"), input.sessionDir)) ?? undefined;
        } catch {
          // 投影失败时仍交回正文；桌面回落为纯文本气泡。
        }
        return { text: visibleText.trim(), ...(message ? { message } : {}) };
      } finally {
        try {
          session.dispose();
        } catch {
          // 会话已经关掉。
        }
      }
    },
  };
}

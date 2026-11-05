/**
 * Rewind / 编辑重发 × 压缩边界（agent-context-compaction.md §4.4）：
 * navigateTree / SessionManager.branch 切到目标 turn 后，descendant（含 compaction）
 * 脱离 active branch → 可喂视图丢边界、恢复该点前原文；不禁止跨界。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { SessionManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import {
  CONTEXT_COMPACTION_CUSTOM_TYPE,
  CONTEXT_COMPACTION_PREFIX,
  feedMessagesFromBranch,
  transcriptToPrompt,
} from "../src/session/external/sdk/host/prompt.js";
import { externalPromptFromSession } from "../src/session/turn/external-turn.js";
import { resolveRewindEntryId, rewindSession } from "../src/session/turn/helpers.js";

const assistantUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function assistant(text: string, timestamp: number) {
  return {
    role: "assistant" as const,
    content: [{ type: "text" as const, text }],
    api: "openai-completions",
    provider: "test",
    model: "m",
    usage: assistantUsage,
    stopReason: "stop" as const,
    timestamp,
  };
}

function tempSession(): SessionManager {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-compact-rewind-"));
  return SessionManager.inMemory(root);
}

describe("compact × rewind", () => {
  it("Pi compaction：回退到边界前 user → 可喂视图丢摘要、恢复旧原文", () => {
    const manager = tempSession();
    const u1 = manager.appendMessage({ role: "user", content: "旧话应恢复", timestamp: 1 });
    manager.appendMessage(assistant("旧答", 2));
    const kept = manager.appendMessage({ role: "user", content: "保留尾巴", timestamp: 3 });
    manager.appendCompaction("摘要：已压旧话", kept, 900);
    manager.appendMessage({ role: "user", content: "压缩后新句", timestamp: 4 });

    const withBoundary = transcriptToPrompt(
      feedMessagesFromBranch(manager.getBranch(), "本轮"),
    );
    expect(withBoundary).toContain(`${CONTEXT_COMPACTION_PREFIX}摘要：已压旧话`);
    expect(withBoundary).not.toContain("旧话应恢复");
    expect(withBoundary).toContain("压缩后新句");

    // 编辑重发：leaf 切到边界前 user（与 navigateTree 同效）
    manager.branch(u1);
    const afterRewind = transcriptToPrompt(
      feedMessagesFromBranch(manager.getBranch(), "改写后重发"),
    );
    expect(afterRewind).not.toContain(CONTEXT_COMPACTION_PREFIX);
    expect(afterRewind).not.toContain("摘要：已压旧话");
    expect(afterRewind).toContain("旧话应恢复");
    expect(afterRewind).not.toContain("压缩后新句");
    expect(afterRewind).toContain("改写后重发");

    // API/Pi 可喂 messages 同样丢边界
    const projected = manager.buildSessionProjection().messages;
    expect(projected.some((m) => (m as { role?: string }).role === "compactionSummary")).toBe(
      false,
    );
    expect(
      projected.some(
        (m) =>
          (m as { role?: string }).role === "user" &&
          (m as { content?: unknown }).content === "旧话应恢复",
      ),
    ).toBe(true);
  });

  it("Pi compaction：回退到 firstKept 之后仍保留边界", () => {
    const manager = tempSession();
    manager.appendMessage({ role: "user", content: "旧话应仍被摘要替换", timestamp: 1 });
    manager.appendMessage(assistant("旧答", 2));
    const kept = manager.appendMessage({ role: "user", content: "保留尾巴", timestamp: 3 });
    manager.appendCompaction("摘要：已压旧话", kept, 900);
    const after = manager.appendMessage({ role: "user", content: "压缩后新句", timestamp: 4 });

    manager.branch(after);
    const prompt = transcriptToPrompt(feedMessagesFromBranch(manager.getBranch(), "继续"));
    expect(prompt).toContain(`${CONTEXT_COMPACTION_PREFIX}摘要：已压旧话`);
    expect(prompt).toContain("保留尾巴");
    expect(prompt).toContain("压缩后新句");
    expect(prompt).not.toContain("旧话应仍被摘要替换");
  });

  it("SDK custom_message 边界：回退到边界前丢摘要", () => {
    const manager = tempSession();
    const u1 = manager.appendMessage({ role: "user", content: "SDK旧话", timestamp: 1 });
    manager.appendMessage(assistant("旧答", 2));
    manager.appendCustomMessageEntry(
      CONTEXT_COMPACTION_CUSTOM_TYPE,
      "SDK摘要要点",
      false,
    );
    manager.appendMessage({ role: "user", content: "SDK新句", timestamp: 3 });

    expect(
      transcriptToPrompt(feedMessagesFromBranch(manager.getBranch(), "x")),
    ).toContain(`${CONTEXT_COMPACTION_PREFIX}SDK摘要要点`);

    manager.branch(u1);
    const prompt = transcriptToPrompt(feedMessagesFromBranch(manager.getBranch(), "重发"));
    expect(prompt).not.toContain("SDK摘要要点");
    expect(prompt).toContain("SDK旧话");
    expect(prompt).not.toContain("SDK新句");
  });

  it("resolveRewindEntryId：messageId 仍能定位边界前 user；rewindSession 调 navigateTree", async () => {
    const manager = tempSession();
    const u1 = manager.appendMessage({ role: "user", content: "可编辑旧句", timestamp: 1 });
    manager.appendMessage(assistant("答", 2));
    const kept = manager.appendMessage({ role: "user", content: "尾巴", timestamp: 3 });
    manager.appendCompaction("摘要", kept, 10);
    manager.appendMessage({ role: "user", content: "新", timestamp: 4 });

    const session = {
      sessionManager: manager,
      navigateTree: async (targetId: string) => {
        manager.branch(targetId);
        return { cancelled: false };
      },
    };

    expect(resolveRewindEntryId(session, { messageId: u1 })).toBe(u1);
    // 当前 leaf 在边界后：ordinal 0 仍是路径上的第一个 user（边界前）
    expect(resolveRewindEntryId(session, { userTurnOrdinal: 0 })).toBe(u1);

    await rewindSession(session, { messageId: u1 });
    expect(manager.getLeafId()).toBe(u1);
    expect(manager.getBranch().some((e) => e.type === "compaction")).toBe(false);
  });

  it("群 holder 留任：cue + 压缩边界拼装含摘要、不含被替换段", () => {
    // 留任增量 cue 作本轮 userText；holder branch 已有 SDK 边界
    const prompt = externalPromptFromSession(
      {
        sessionManager: {
          getBranch: () => [
            { id: "old", type: "message", message: { role: "user", content: "旧工具私货应丢", timestamp: 1 } },
            {
              id: "c1",
              type: "custom_message",
              customType: CONTEXT_COMPACTION_CUSTOM_TYPE,
              content: "执掌摘要：在做寻路",
              display: false,
              timestamp: 2,
            },
            { id: "tail", type: "message", message: { role: "user", content: "上次公开一句", timestamp: 3 } },
          ],
        },
      },
      "用户：改成 A* 寻路",
    );
    expect(prompt).toContain(`${CONTEXT_COMPACTION_PREFIX}执掌摘要：在做寻路`);
    expect(prompt).toContain("上次公开一句");
    expect(prompt).toContain("用户：改成 A* 寻路");
    expect(prompt).not.toContain("旧工具私货应丢");
  });
});

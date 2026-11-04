import { describe, expect, it } from "vitest";

import {
  isLatestAssistantMessage,
  shouldShowAssistantReload,
} from "../../src/pages/conversation/model/message/assistant-reload";
import {
  resolveGroupReloadEdit,
  type GroupUiCustom,
} from "../../src/pages/conversation/model/group/group-ui-messages";
import type { UIMessage } from "ai";

function msg(
  id: string,
  role: "user" | "assistant" | "system",
  text = "",
): UIMessage {
  return {
    id,
    role,
    parts: text ? [{ type: "text", text }] : [],
  };
}

describe("isLatestAssistantMessage", () => {
  it("is true only for the last assistant in the thread", () => {
    const messages = [
      msg("u1", "user", "hi"),
      msg("a1", "assistant", "one"),
      msg("u2", "user", "again"),
      msg("a2", "assistant", "two"),
      msg("sys", "system", "note"),
    ];
    expect(isLatestAssistantMessage(messages, "a2")).toBe(true);
    expect(isLatestAssistantMessage(messages, "a1")).toBe(false);
    expect(isLatestAssistantMessage(messages, "u2")).toBe(false);
  });

  it("ignores trailing non-assistant rows after the last reply", () => {
    const messages = [
      msg("u1", "user", "hi"),
      msg("a1", "assistant", "done"),
      msg("hb", "system", "交回"),
    ];
    expect(isLatestAssistantMessage(messages, "a1")).toBe(true);
  });
});

describe("shouldShowAssistantReload", () => {
  const settled = [
    msg("u1", "user", "hi"),
    msg("a1", "assistant", "done"),
  ];

  it("shows on the latest settled assistant when idle", () => {
    expect(
      shouldShowAssistantReload({
        canReload: true,
        messageId: "a1",
        messages: settled,
        threadRunning: false,
        messageRunning: false,
        wakeLiveActive: false,
      }),
    ).toBe(true);
  });

  it("hides while a new turn is running or wake-live is active", () => {
    const base = {
      canReload: true,
      messageId: "a1",
      messages: settled,
      messageRunning: false,
    };
    expect(
      shouldShowAssistantReload({ ...base, threadRunning: true, wakeLiveActive: false }),
    ).toBe(false);
    expect(
      shouldShowAssistantReload({ ...base, threadRunning: false, wakeLiveActive: true }),
    ).toBe(false);
    expect(
      shouldShowAssistantReload({
        ...base,
        threadRunning: false,
        wakeLiveActive: false,
        messageRunning: true,
      }),
    ).toBe(false);
  });
});

describe("resolveGroupReloadEdit", () => {
  it("walks back from parentId past handback/delegation to the user turn", () => {
    const messages: UIMessage[] = [
      msg("u1", "user", "@产品经理 做登录"),
      msg("a1", "assistant", "好的"),
      {
        id: "hb",
        role: "system",
        parts: [{ type: "text", text: "交回" }],
        metadata: { custom: { groupLineRole: "handback" } satisfies GroupUiCustom },
      },
    ];
    // 重试 a1 时 parent 是 u1
    expect(resolveGroupReloadEdit(messages, "u1")).toEqual({
      messageId: "u1",
      text: "@产品经理 做登录",
    });
    // 若 parent 误指 handback（中间插了行），仍应找到用户
    expect(resolveGroupReloadEdit(messages, "hb")).toEqual({
      messageId: "u1",
      text: "@产品经理 做登录",
    });
  });

  it("returns null when there is no preceding user text", () => {
    expect(resolveGroupReloadEdit([msg("a1", "assistant", "lonely")], null)).toBeNull();
    expect(resolveGroupReloadEdit([msg("u1", "user", "   "), msg("a1", "assistant", "x")], "u1")).toBeNull();
  });
});

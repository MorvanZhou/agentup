import { describe, expect, it } from "vitest";

import {
  composerResourceAgentId,
  composerShowAttachments,
  groupChatCapabilities,
  sessionModelAgentId,
} from "../../src/pages/conversation/model/thread/chat-surface";

describe("group model picker", () => {
  it("shows the same session model picker as a single thread", () => {
    expect(
      groupChatCapabilities({
        placeholder: "",
        members: [{ id: "pm", name: "产品" }],
        defaultResourceAgentId: "",
      }).modelPicker,
    ).toBe(true);
  });

  it("lets a group user message be edited like a single thread", () => {
    expect(
      groupChatCapabilities({
        placeholder: "",
        members: [{ id: "pm", name: "产品" }],
        defaultResourceAgentId: "",
      }).editResend,
    ).toBe(true);
  });
});

describe("sessionModelAgentId", () => {
  it("uses the thread agent when the composer has no members", () => {
    expect(
      sessionModelAgentId({
        threadAgentId: "solo",
        memberIds: [],
        holderId: "",
        draftMentionId: "",
      }),
    ).toBe("solo");
  });

  it("uses the current holder while a round is open", () => {
    expect(
      sessionModelAgentId({
        threadAgentId: "",
        memberIds: ["pm", "design"],
        holderId: "pm",
        draftMentionId: "design",
      }),
    ).toBe("pm");
  });

  it("uses the drafted mention when the room is idle", () => {
    expect(
      sessionModelAgentId({
        threadAgentId: "",
        memberIds: ["pm", "design"],
        holderId: "",
        draftMentionId: "design",
      }),
    ).toBe("design");
  });

  it("falls back to the first member when nobody is addressed yet", () => {
    expect(
      sessionModelAgentId({
        threadAgentId: "",
        memberIds: ["pm", "design"],
        holderId: "",
        draftMentionId: "",
      }),
    ).toBe("pm");
  });
});

describe("composerResourceAgentId", () => {
  it("falls back to the thread agent in a single chat even when holder is empty", () => {
    // 回归：扩群聊门控时勿因 defaultResourceAgentId="" 关掉单聊附件
    const id = composerResourceAgentId({
      threadAgentId: "solo",
      memberIds: [],
      holderId: "",
      draftMentionId: "",
    });
    expect(id).toBe("solo");
    expect(composerShowAttachments(true, id)).toBe(true);
  });

  it("prefers the drafted mention over the holder in a group", () => {
    expect(
      composerResourceAgentId({
        threadAgentId: "",
        memberIds: ["pm", "design"],
        holderId: "pm",
        draftMentionId: "design",
      }),
    ).toBe("design");
  });

  it("uses the holder when the group draft has no mention", () => {
    expect(
      composerResourceAgentId({
        threadAgentId: "",
        memberIds: ["pm", "design"],
        holderId: "pm",
        draftMentionId: "",
      }),
    ).toBe("pm");
  });

  it("hides attachments when a group has neither mention nor holder", () => {
    const id = composerResourceAgentId({
      threadAgentId: "",
      memberIds: ["pm", "design"],
      holderId: "",
      draftMentionId: "",
    });
    expect(id).toBe("");
    expect(composerShowAttachments(true, id)).toBe(false);
  });
});

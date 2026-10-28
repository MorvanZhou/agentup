import { describe, expect, it } from "vitest";

import { groupDelegationPhase } from "../../src/pages/conversation/model/group/group-delegation";
import {
  groupLinesToUiMessages,
  pendingDelegationCards,
  withHolderAuthor,
} from "../../src/pages/conversation/model/group/group-ui-messages";
import { AISDKMessageConverter } from "../../src/pages/conversation/model/thread/ui-to-thread-messages";

const room = {
  id: "g1",
  members: [
    { agentId: "pm", name: "产品经理" },
    { agentId: "design", name: "设计师" },
  ],
  lines: [
    { id: "l1", role: "system" as const, authorId: "", text: "本轮 · 产品经理", at: 1 },
    { id: "l2", role: "user" as const, authorId: "user", text: "@产品经理 做登录", at: 2 },
    { id: "l3", role: "agent" as const, authorId: "pm", text: "好的", at: 3 },
    { id: "l4", role: "handback" as const, authorId: "pm", text: "登录页好了", at: 4 },
    { id: "l5", role: "tool" as const, authorId: "dev", text: "tool:read", at: 5 },
  ],
  queue: [
    { id: "q-attached", agentId: "design", text: "挂上", messageId: "l2" },
    { id: "q-loose", agentId: "design", text: "松开", messageId: "missing" },
  ],
};

describe("groupLinesToUiMessages", () => {
  it("projects visible lines and keeps tool lines out", () => {
    const messages = groupLinesToUiMessages(room);
    expect(messages.map((message) => message.id)).toEqual([
      "l1",
      "l2",
      "l3",
      "l4",
      "queue-q-loose",
    ]);
    expect(JSON.stringify(messages)).not.toContain("tool:read");

    const agent = messages[2];
    expect(agent?.role).toBe("assistant");
    expect(agent?.metadata).toMatchObject({
      custom: { groupLineRole: "agent", author: { id: "pm", name: "产品经理" } },
    });

    const user = messages[1];
    expect(user?.metadata).toMatchObject({
      custom: {
        queue: [{ id: "q-attached", label: "本轮结束后交给 设计师" }],
      },
    });

    const handback = messages[3];
    expect(handback?.role).toBe("system");
    expect(handback?.parts).toEqual([
      { type: "text", text: "交回给 产品经理 · 登录页好了", state: "done" },
    ]);

    const loose = messages[4];
    expect(loose?.metadata).toMatchObject({
      custom: { groupLineRole: "queue", queue: [{ id: "q-loose" }] },
    });
  });

  it("stamps roster avatar and role onto agent authors", () => {
    const messages = groupLinesToUiMessages(room, {
      pm: { avatarUrl: "pm.webp", role: "产品负责人" },
    });
    const agent = messages.find((message) => message.id === "l3");
    expect(agent?.metadata).toMatchObject({
      custom: {
        groupLineRole: "agent",
        author: {
          id: "pm",
          name: "产品经理",
          avatarUrl: "pm.webp",
          role: "产品负责人",
        },
      },
    });
  });

  it("stamps the live holder onto the in-progress message", () => {
    const live = withHolderAuthor(
      { id: "live", role: "assistant", parts: [{ type: "text", text: "正在画迷宫" }] },
      { id: "pm", name: "产品经理", avatarUrl: "pm.webp", role: "产品负责人" },
    );
    expect(live.metadata).toMatchObject({
      custom: {
        groupLineRole: "agent",
        author: {
          id: "pm",
          name: "产品经理",
          avatarUrl: "pm.webp",
          role: "产品负责人",
        },
      },
    });
  });

  it("keeps stored agent parts and summary/artifacts custom for byproducts", () => {
    const messages = groupLinesToUiMessages({
      ...room,
      lines: [
        {
          id: "rich",
          role: "agent" as const,
          authorId: "pm",
          text: "好的",
          at: 1,
          parts: [
            { type: "text", text: "先看需求" },
            {
              type: "dynamic-tool",
              toolCallId: "t1",
              toolName: "read",
              state: "output-available",
              input: {},
              output: "ok",
            },
            { type: "text", text: "好的" },
          ],
          assistantCustom: {
            agentUpSummary: { textPartIndex: 1 },
            agentUpArtifacts: { files: [{ path: "ARTIFACT/a.md", kind: "added" }] },
          },
        },
      ],
      queue: [],
    });
    const agent = messages[0];
    expect(agent?.role).toBe("assistant");
    expect(agent?.parts).toHaveLength(3);
    expect(agent?.parts?.[1]).toMatchObject({ type: "dynamic-tool", toolName: "read" });
    expect(agent?.metadata).toMatchObject({
      custom: {
        groupLineRole: "agent",
        author: { id: "pm", name: "产品经理" },
        agentUpSummary: { textPartIndex: 1 },
        agentUpArtifacts: { files: [{ path: "ARTIFACT/a.md", kind: "added" }] },
      },
    });
  });

  it("renders a sub-agent as its own assistant card and keeps the summary", () => {
    const messages = groupLinesToUiMessages(
      {
        ...room,
        lines: [
          {
            id: "d1",
            role: "delegation" as const,
            authorId: "design",
            authorName: "设计师",
            text: "",
            at: 6,
            taskId: "task-design",
            brief: "做登录页",
            summary: "登录页已完成",
            activity: "running" as const,
            handoff: "pending" as const,
            outcome: "completed" as const,
          },
        ],
        queue: [],
      },
      { design: { avatarUrl: "design.webp", role: "视觉" } },
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.metadata).toMatchObject({
      custom: {
        groupLineRole: "delegation",
        author: { id: "design", name: "设计师", avatarUrl: "design.webp", role: "视觉" },
        delegation: {
          taskId: "task-design",
          summary: "登录页已完成",
          handoff: "pending",
        },
      },
    });
    expect(JSON.stringify(messages[0])).not.toContain("tool:");
    expect(
      groupDelegationPhase(
        { activity: "running", handoff: "pending", outcome: "completed" },
        false,
      ),
    ).toBe("pending_summary");
    expect(groupDelegationPhase({ activity: "queued", handoff: "pending" }, true)).toBe("waiting");
  });

  it("does not fold the holder utterance into the following delegation card", () => {
    const messages = groupLinesToUiMessages({
      ...room,
      lines: [
        { id: "u1", role: "user" as const, authorId: "user", text: "@产品经理 好，继续", at: 1 },
        {
          id: "holder",
          role: "agent" as const,
          authorId: "pm",
          text: "已把 brief 发给设计师开工了",
          at: 2,
          parts: [
            { type: "text", text: "已把 brief 发给设计师开工了", state: "done" },
            {
              type: "dynamic-tool",
              toolName: "delegate_to_agent",
              toolCallId: "call-1",
              state: "output-available",
              input: { agent_id: "design" },
              output: "started",
            },
          ],
        },
        {
          id: "d1",
          role: "delegation" as const,
          authorId: "design",
          authorName: "设计师",
          text: "",
          at: 3,
          taskId: "task-design",
          brief: "做登录页",
          activity: "running" as const,
          handoff: "pending" as const,
        },
        {
          id: "after",
          role: "agent" as const,
          authorId: "pm",
          text: "用户已取消刚才的操作",
          at: 4,
        },
      ],
      queue: [],
    });
    const thread = AISDKMessageConverter.toThreadMessages(messages, false);
    expect(thread.map((message) => message.id)).toEqual(["u1", "holder", "d1", "after"]);
    const holder = thread.find((message) => message.id === "holder");
    expect(holder?.role).toBe("assistant");
    expect(JSON.stringify(holder)).toContain("已把 brief 发给设计师开工了");
    expect(holder?.metadata).toMatchObject({ custom: { groupLineRole: "agent" } });
    expect(thread.find((message) => message.id === "d1")?.metadata).toMatchObject({
      custom: { groupLineRole: "delegation" },
    });
  });

  it("keeps in-flight sub-agents behind the live holder bubble", () => {
    const cards = pendingDelegationCards(
      [
        {
          id: "p1",
          at: 2,
          taskId: "task-design",
          authorId: "design",
          authorName: "设计师",
          brief: "做登录页",
          activity: "queued",
          handoff: "pending",
        },
      ],
      room.members ?? [],
      { design: { avatarUrl: "design.webp" } },
    );
    expect(cards).toEqual([
      expect.objectContaining({
        id: "p1",
        authorName: "设计师",
        avatarUrl: "design.webp",
        activity: "queued",
        brief: "做登录页",
      }),
    ]);
  });

  it("falls back to a plain text bubble when agent parts are missing", () => {
    const messages = groupLinesToUiMessages(room);
    const agent = messages.find((message) => message.id === "l3");
    expect(agent?.parts).toEqual([{ type: "text", text: "好的", state: "done" }]);
  });
});

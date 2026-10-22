import { describe, expect, it } from "vitest";

import {
  shortenDisplayTarget,
  summarizeApproval,
} from "../../src/pages/conversation/model/approval-summary";

describe("shortenDisplayTarget", () => {
  it("把命令里的绝对路径收成文件名，保留参数", () => {
    expect(
      shortenDisplayTarget(
        'node /Users/me/.agentup/users/u1/agents/a1/cwd/.pi/skills/check-world-clock/scripts/check-world-clock.mjs "北京"',
      ),
    ).toBe('node check-world-clock.mjs "北京"');
  });

  it("相对路径只展示文件名", () => {
    expect(shortenDisplayTarget("notes/todo.md")).toBe("todo.md");
  });
});

describe("summarizeApproval", () => {
  it("把命令审批整理成简短文案，并提供三级允许范围", () => {
    const summary = summarizeApproval({
      id: "a1",
      toolCallId: "c1",
      toolName: "bash",
      args: { command: "node weather.mjs" },
    });
    expect(summary.command).toBe(true);
    expect(summary.kind).toBe("command");
    expect(summary.title).toBe("要在电脑上运行操作");
    expect(summary.target).toBe("node weather.mjs");
    expect(summary.scopes.map((item) => item.scope)).toEqual(["once", "session", "agent"]);
  });

  it("命令审批展示文件名而非绝对路径", () => {
    const summary = summarizeApproval({
      id: "a1b",
      toolCallId: "c1b",
      toolName: "bash",
      args: {
        command:
          "node /Users/me/.agentup/users/u1/agents/a1/cwd/.pi/skills/check/scripts/check.mjs",
      },
    });
    expect(summary.target).toBe("node check.mjs");
  });

  it("把写文件审批整理成单次确认", () => {
    const summary = summarizeApproval({
      id: "a2",
      toolCallId: "c2",
      toolName: "write",
      args: { path: "notes/todo.md" },
    });
    expect(summary.command).toBe(false);
    expect(summary.kind).toBe("write");
    expect(summary.target).toBe("todo.md");
    expect(summary.scopes).toEqual([]);
    expect(summary.description).toContain("这一次");
  });

  it("其他工具给出通用说明", () => {
    const summary = summarizeApproval({
      id: "a3",
      toolCallId: "c3",
      toolName: "custom_tool",
      args: {},
    });
    expect(summary.kind).toBe("tool");
    expect(summary.target).toBe("custom_tool");
  });

  it("把 web_fetch 审批整理成网络访问说明", () => {
    const summary = summarizeApproval({
      id: "a4",
      toolCallId: "c4",
      toolName: "web_fetch",
      args: { url: "https://example.com/docs" },
    });
    expect(summary.kind).toBe("tool");
    expect(summary.title).toBe("要访问网络地址");
    expect(summary.target).toBe("https://example.com/docs");
    expect(summary.scopes).toEqual([]);
    expect(summary.description).toContain("这一次");
  });

  it("把 web_search 审批整理成搜索说明", () => {
    const summary = summarizeApproval({
      id: "a5",
      toolCallId: "c5",
      toolName: "web_search",
      args: { query: "agent tools" },
    });
    expect(summary.kind).toBe("tool");
    expect(summary.title).toBe("要搜索网络");
    expect(summary.target).toBe("agent tools");
    expect(summary.scopes).toEqual([]);
  });

  it("委托审批：标题用 Agent 名称，目标只写要帮的事", () => {
    const summary = summarizeApproval({
      id: "a6",
      toolCallId: "c6",
      toolName: "delegate_to_agent",
      args: {
        agent_id: "weather",
        agent_name: "天气助手",
        brief: "查一下北京明天天气",
      },
    });
    expect(summary.kind).toBe("tool");
    expect(summary.title).toBe("想请 Agent「天气助手」帮忙");
    expect(summary.target).toBe("查一下北京明天天气");
    expect(summary.target).not.toContain("weather");
    expect(summary.scopes.map((item) => item.scope)).toEqual(["once", "session", "agent"]);
    expect(summary.scopes.find((item) => item.scope === "agent")?.label).toBe("可调任何人");
  });

  it("委托审批缺少名称时标题不暴露 id", () => {
    const summary = summarizeApproval({
      id: "a7",
      toolCallId: "c7",
      toolName: "delegate_to_agent",
      args: { agent_id: "weather", brief: "查天气" },
    });
    expect(summary.title).toBe("想请其他 Agent 帮忙");
    expect(summary.target).toBe("查天气");
    expect(summary.title).not.toContain("weather");
  });
});

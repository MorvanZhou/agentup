import { describe, expect, it } from "vitest";

import { extractAssistAgents } from "../../src/pages/conversation/model/message/message-assistants";

describe("extractAssistAgents", () => {
  it("收录成功、进行中与失败的 delegate_to_agent，并按首次出现去重", () => {
    const assists = extractAssistAgents([
      {
        type: "tool-call",
        toolName: "agent_search",
        toolCallId: "l1",
        result: "ok",
      },
      {
        type: "tool-call",
        toolName: "delegate_to_agent",
        toolCallId: "d1",
        args: { agent_id: "weather", brief: "查天气" },
        result:
          "Delegation completed.\ntask_id: task-weather-1\nagent: 天气助手 (weather)\nresult:\n明天晴",
      },
      {
        type: "tool-call",
        toolName: "delegate_to_agent",
        toolCallId: "d2",
        args: { agent_id: "weather", brief: "再查" },
        result: "Delegation completed.\nresult:\n多云",
      },
      {
        type: "tool-call",
        toolName: "delegate_to_agent",
        toolCallId: "d3",
        args: { agent_id: "doctor", brief: "问诊" },
      },
      {
        type: "tool-call",
        toolName: "delegate_to_agent",
        toolCallId: "d4",
        args: { agent_id: "broken", brief: "失败" },
        result: "Delegation failed.\nerror: boom",
        isError: true,
      },
    ]);
    expect(assists.map((item) => item.agentId)).toEqual(["weather", "doctor", "broken"]);
    expect(assists[0]).toMatchObject({
      agentId: "weather",
      nameHint: "天气助手",
      brief: "查天气",
      reply: "明天晴",
      status: "completed",
      taskId: "task-weather-1",
    });
    expect(assists[1]?.status).toBe("running");
    expect(assists[2]).toMatchObject({
      agentId: "broken",
      status: "failed",
    });
  });

  it("进行中失败后标记为 failed", () => {
    const running = extractAssistAgents([
      {
        type: "tool-call",
        toolName: "delegate_to_agent",
        toolCallId: "d1",
        args: { agent_id: "weather", brief: "查" },
      },
    ]);
    expect(running).toHaveLength(1);
    const failed = extractAssistAgents([
      {
        type: "tool-call",
        toolName: "delegate_to_agent",
        toolCallId: "d1",
        args: { agent_id: "weather", brief: "查" },
        result: "Error: 用户拒绝了这次工具调用",
        isError: true,
      },
    ]);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.status).toBe("failed");
  });

  it("异步 started 标记 asyncDispatched，不把说明文当 reply，状态仍为 completed", () => {
    const assists = extractAssistAgents([
      {
        type: "tool-call",
        toolName: "delegate_to_agent",
        toolCallId: "d-async",
        args: { agent_id: "coder", brief: "写补丁" },
        result:
          "Delegation started (async).\n" +
          "task_id: task-async-1\n" +
          "agent: 编码助手 (coder)\n" +
          "Use check_delegation with this task_id later, or wait for a session notification when it finishes.",
      },
    ]);
    expect(assists).toHaveLength(1);
    expect(assists[0]).toMatchObject({
      agentId: "coder",
      nameHint: "编码助手",
      brief: "写补丁",
      reply: "",
      status: "completed",
      asyncDispatched: true,
      taskId: "task-async-1",
    });
  });

  it("透传工具 part 的墙钟 timing，升级状态时保留 startedAt", () => {
    const running = extractAssistAgents([
      {
        type: "tool-call",
        toolName: "delegate_to_agent",
        toolCallId: "d1",
        args: { agent_id: "weather", brief: "查" },
        timing: { startedAt: 1_000 },
      },
    ]);
    expect(running[0]).toMatchObject({
      status: "running",
      startedAt: 1_000,
    });

    const done = extractAssistAgents([
      {
        type: "tool-call",
        toolName: "delegate_to_agent",
        toolCallId: "d1",
        args: { agent_id: "weather", brief: "查" },
        timing: { startedAt: 1_000, completedAt: 4_500 },
        result:
          "Delegation completed.\ntask_id: task-1\nagent: 天气助手 (weather)\nresult:\nok",
      },
    ]);
    expect(done[0]).toMatchObject({
      status: "completed",
      startedAt: 1_000,
      completedAt: 4_500,
    });
  });
});

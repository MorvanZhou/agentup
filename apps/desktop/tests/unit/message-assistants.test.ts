import { describe, expect, it } from "vitest";

import { extractAssistAgents } from "../../src/pages/conversation/model/message-assistants";

describe("extractAssistAgents", () => {
  it("收录成功、进行中与失败的 delegate_to_agent，并按首次出现去重", () => {
    const assists = extractAssistAgents([
      {
        type: "tool-call",
        toolName: "list_recruited_agents",
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
});

import { expect, it, vi } from "vitest";

import { attention } from "../../src/shared/api/runtime/chat.js";
import type { RuntimeHttp } from "../../src/shared/api/runtime/http.js";

it("parses busy_turns phase and sources from attention", async () => {
  const http = {
    request: vi.fn(async () => ({
      busy_agent_ids: ["personal-assistant"],
      busy_turns: [
        {
          agent_id: "personal-assistant",
          phase: "wake",
          sources: [
            {
              name: "前端",
              status: "completed",
              agent_id: "loc-fe",
              kind: "delegation",
            },
          ],
        },
      ],
      approvals: [],
      ask_users: [],
    })),
  } as unknown as RuntimeHttp;

  const snap = await attention(http, "tok", "u1");
  expect(snap.busyAgentIds).toEqual(["personal-assistant"]);
  expect(snap.busyTurns).toEqual([
    {
      agentId: "personal-assistant",
      phase: "wake",
      sources: [
        {
          name: "前端",
          status: "completed",
          agentId: "loc-fe",
          kind: "delegation",
        },
      ],
    },
  ]);
});

it("defaults missing busy_turns to empty and phase to prompt", async () => {
  const http = {
    request: vi.fn(async () => ({
      busy_agent_ids: ["a1"],
      busy_turns: [{ agent_id: "a1", phase: "other", sources: "bad" }],
      approvals: [],
      ask_users: [],
    })),
  } as unknown as RuntimeHttp;

  const snap = await attention(http, "tok", "u1");
  expect(snap.busyTurns).toEqual([{ agentId: "a1", phase: "prompt", sources: [] }]);
});

it("parses group_id on HITL attention rows", async () => {
  const http = {
    request: vi.fn(async () => ({
      busy_agent_ids: [],
      busy_turns: [],
      approvals: [
        {
          id: "ap-1",
          agent_id: "remy",
          tool_call_id: "tc-ap",
          tool_name: "bash",
          args: { command: "ls" },
          group_id: "group-dev",
        },
      ],
      ask_users: [
        {
          id: "ask-1",
          agent_id: "remy",
          tool_call_id: "tc-ask",
          questions: [
            {
              question: "交付形态？",
              options: [{ title: "网页" }],
              allowMultiple: false,
            },
          ],
          group_id: "group-dev",
        },
      ],
      shell_hangs: [
        {
          id: "hang-1",
          agent_id: "remy",
          tool_call_id: "tc-hang",
          tool_name: "bash",
          command: "npm test",
          elapsed_ms: 4000,
          group_id: "group-dev",
        },
      ],
    })),
  } as unknown as RuntimeHttp;

  const snap = await attention(http, "tok", "u1");
  expect(snap.approvals[0]?.groupId).toBe("group-dev");
  expect(snap.askUsers[0]?.groupId).toBe("group-dev");
  expect(snap.shellHangs[0]?.groupId).toBe("group-dev");
});

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

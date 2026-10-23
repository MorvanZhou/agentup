import { expect, it } from "vitest";

import { wakeSourcesFromDetails } from "../src/session/turn/busy-turn.js";

it("extracts delegation sources from wake details", () => {
  const sources = wakeSourcesFromDetails({
    items: [
      {
        customType: "agentup.delegation_result",
        taskId: "t1",
        toAgentId: "loc-fe",
        toAgentName: "前端",
        status: "completed",
      },
      {
        customType: "agentup.delegation_result",
        toAgentId: "loc-be",
        toAgentName: "后端",
        status: "completed",
      },
    ],
  });
  expect(sources).toEqual([
    {
      name: "前端",
      status: "completed",
      agentId: "loc-fe",
      kind: "delegation",
    },
    {
      name: "后端",
      status: "completed",
      agentId: "loc-be",
      kind: "delegation",
    },
  ]);
});

it("returns empty for malformed details", () => {
  expect(wakeSourcesFromDetails(null)).toEqual([]);
  expect(wakeSourcesFromDetails({})).toEqual([]);
});

import { expect, it } from "vitest";

import { asyncWorkingAgentIds } from "../../src/pages/conversation/model/sidebar/async-fleet-working.js";

it("does not mark delegation endpoints as replying", () => {
  expect(
    asyncWorkingAgentIds({
      delegations: [
        { fromAgentId: "pa", toAgentId: "fe", wait: false, status: "running" },
        { fromAgentId: "pa", toAgentId: "qa", wait: true, status: "running" },
        { fromAgentId: "other", toAgentId: "be", wait: false, status: "completed" },
      ],
    }),
  ).toEqual([]);
});

it("collects agentId of running background jobs", () => {
  expect(
    asyncWorkingAgentIds({
      backgroundJobs: [
        { agentId: "weather", status: "running" },
        { agentId: "weather", status: "completed" },
        { agentId: "", status: "running" },
      ],
    }),
  ).toEqual(["weather"]);
});

it("dedupes across delegations and background jobs", () => {
  const ids = asyncWorkingAgentIds({
    delegations: [{ fromAgentId: "pa", wait: false, status: "running" }],
    backgroundJobs: [
      { agentId: "pa", status: "running" },
      { agentId: "coder", status: "running" },
    ],
  });
  expect(ids.sort()).toEqual(["coder", "pa"]);
});

it("treats missing background status as running and still ignores delegations", () => {
  expect(
    asyncWorkingAgentIds({
      delegations: [{ fromAgentId: "a", toAgentId: "fe", wait: false }],
      backgroundJobs: [{ agentId: "b" }],
    }),
  ).toEqual(["b"]);
});

it("returns empty when nothing is async-running", () => {
  expect(asyncWorkingAgentIds({})).toEqual([]);
  expect(
    asyncWorkingAgentIds({
      delegations: [{ fromAgentId: "a", wait: true, status: "running" }],
      backgroundJobs: [{ agentId: "b", status: "failed" }],
    }),
  ).toEqual([]);
});

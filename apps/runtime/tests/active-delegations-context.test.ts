import { describe, expect, it } from "vitest";

import { formatActiveDelegationsContext } from "../src/session/delegation/active-context.js";
import type { DelegationTask } from "../src/session/delegation/types.js";

function task(
  partial: Partial<DelegationTask> &
    Pick<DelegationTask, "id" | "status" | "toAgentId" | "toAgentName" | "brief">,
): DelegationTask {
  return {
    userId: "u1",
    fromAgentId: "parent",
    createdAt: 1,
    updatedAt: 1,
    wait: false,
    seen: false,
    notified: false,
    ...partial,
  };
}

describe("formatActiveDelegationsContext", () => {
  it("returns empty when there are no active tasks", () => {
    expect(formatActiveDelegationsContext([])).toBe("");
    expect(
      formatActiveDelegationsContext([
        task({
          id: "done-1",
          status: "completed",
          toAgentId: "cody",
          toAgentName: "Cody",
          brief: "maze",
        }),
        task({
          id: "fail-1",
          status: "failed",
          toAgentId: "cody",
          toAgentName: "Cody",
          brief: "maze",
        }),
        task({
          id: "cancel-1",
          status: "cancelled",
          toAgentId: "cody",
          toAgentName: "Cody",
          brief: "maze",
        }),
      ]),
    ).toBe("");
  });

  it("lists running and pending_auth tasks with anti-dup guidance", () => {
    const text = formatActiveDelegationsContext([
      task({
        id: "t-run",
        status: "running",
        toAgentId: "cody",
        toAgentName: "Cody",
        brief: "实现走迷宫小游戏，按已确认需求直接落地",
      }),
      task({
        id: "t-auth",
        status: "pending_auth",
        toAgentId: "qa",
        toAgentName: "QA",
        brief: "review maze",
      }),
      task({
        id: "t-done",
        status: "completed",
        toAgentId: "pm",
        toAgentName: "PM",
        brief: "old",
      }),
    ]);

    expect(text).toContain("# Active delegations");
    expect(text).toContain("check_delegation");
    expect(text).toContain("Do not re-delegate");
    expect(text).toContain("steer_delegation");
    expect(text).toContain("resolve_delegation_update");
    expect(text).toContain("do not take over that specialist's work yourself");
    expect(text).toContain("t-run");

    expect(text).toContain("running");
    expect(text).toContain("Cody");
    expect(text).toContain("t-auth");
    expect(text).toContain("pending_auth");
    expect(text).not.toContain("t-done");
  });

  it("truncates long briefs and caps listed tasks", () => {
    const long = "x".repeat(200);
    const many = Array.from({ length: 12 }, (_, index) =>
      task({
        id: `t-${index}`,
        status: "running",
        toAgentId: `a-${index}`,
        toAgentName: `A${index}`,
        brief: index === 0 ? long : `brief-${index}`,
      }),
    );
    const text = formatActiveDelegationsContext(many);
    expect(text).toContain("…");
    expect(text).not.toContain(long);
    expect(text).toContain("(More active");
    expect(text.match(/^- task_id:/gm)?.length).toBe(8);
  });
});

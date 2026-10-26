import { expect, it } from "vitest";

import {
  delegationBannerLines,
  delegationElapsedLabel,
  delegationPresence,
} from "../../src/pages/conversation/model/sidebar/delegation-presence.js";

const minute = 60_000;

it("keeps async running delegations and ignores sync, pending, and finished work", () => {
  const presence = delegationPresence([
    {
      id: "run",
      fromAgentId: "pm",
      toAgentId: "fe",
      brief: "改登录页",
      wait: false,
      status: "running",
      createdAt: 10,
    },
    {
      id: "sync",
      fromAgentId: "pm",
      toAgentId: "qa",
      brief: "短任务",
      wait: true,
      status: "running",
      createdAt: 11,
    },
    {
      id: "auth",
      fromAgentId: "pm",
      toAgentId: "fe",
      brief: "等批准",
      wait: false,
      status: "pending_auth",
      createdAt: 12,
    },
    {
      id: "done",
      fromAgentId: "pm",
      toAgentId: "be",
      brief: "已完成",
      wait: false,
      status: "completed",
      createdAt: 13,
    },
  ]);

  expect(presence.incoming.fe).toEqual([
    { id: "run", fromAgentId: "pm", brief: "改登录页", createdAt: 10 },
  ]);
  expect(presence.incoming.qa).toBeUndefined();
  expect(presence.dispatchedCount).toEqual({ pm: 1 });
});

it("counts dispatched people once and stacks multiple tasks on the specialist", () => {
  const presence = delegationPresence([
    {
      id: "a",
      fromAgentId: "pm",
      toAgentId: "fe",
      brief: "第一件",
      wait: false,
      status: "running",
      createdAt: 1,
    },
    {
      id: "b",
      fromAgentId: "pm",
      toAgentId: "fe",
      brief: "第二件",
      wait: false,
      status: "running",
      createdAt: 2,
    },
    {
      id: "c",
      fromAgentId: "pm",
      toAgentId: "qa",
      brief: "第三件",
      wait: false,
      createdAt: 3,
    },
    { id: "dup", fromAgentId: "pm", toAgentId: "qa", brief: "重复", wait: false, createdAt: 4 },
    { id: "dup", fromAgentId: "pm", toAgentId: "qa", brief: "重复", wait: false, createdAt: 5 },
  ]);

  expect(presence.dispatchedCount.pm).toBe(2);
  expect(presence.incoming.fe?.map((task) => task.id)).toEqual(["a", "b"]);
  expect(presence.incoming.qa?.map((task) => task.id)).toEqual(["c", "dup"]);
});

it("drops tasks that have no id or no endpoints", () => {
  expect(
    delegationPresence([
      { id: "", fromAgentId: "pm", toAgentId: "fe", wait: false, status: "running" },
      { id: "x", fromAgentId: " ", toAgentId: "fe", wait: false, status: "running" },
      { id: "y", fromAgentId: "pm", toAgentId: "", wait: false, status: "running" },
    ]),
  ).toEqual({ dispatchedCount: {}, incoming: {} });
});

it("formats how long a delegation has been running", () => {
  const now = 30 * 24 * 60 * 60 * 1000;
  expect(delegationElapsedLabel(0, now)).toBe("刚刚开始");
  expect(delegationElapsedLabel(now + 1000, now)).toBe("刚刚开始");
  expect(delegationElapsedLabel(now - 30_000, now)).toBe("刚刚开始");
  expect(delegationElapsedLabel(now - minute, now)).toBe("已进行 1 分钟");
  expect(delegationElapsedLabel(now - 3 * minute, now)).toBe("已进行 3 分钟");
  expect(delegationElapsedLabel(now - 2 * 60 * minute, now)).toBe("已进行 2 小时");
  expect(delegationElapsedLabel(now - 26 * 60 * minute, now)).toBe("已进行 1 天");
});

it("builds banner lines with the assigner name, brief, and elapsed time", () => {
  const now = 10 * minute;
  expect(
    delegationBannerLines({
      tasks: [
        { id: "a", fromAgentId: "pm", brief: "  改登录页  ", createdAt: now - 3 * minute },
        { id: "b", fromAgentId: "missing", brief: "   ", createdAt: 0 },
      ],
      resolveName: (id) => (id === "pm" ? "产品经理" : ""),
      now,
    }),
  ).toEqual([
    {
      id: "a",
      fromAgentId: "pm",
      fromName: "产品经理",
      brief: "改登录页",
      elapsed: "已进行 3 分钟",
    },
    {
      id: "b",
      fromAgentId: "missing",
      fromName: "",
      brief: "",
      elapsed: "刚刚开始",
    },
  ]);
});

import { expect, it } from "vitest";

import {
  AsyncWakeBroker,
  formatWakeContent,
  type AsyncWakeItem,
  type AsyncWakeRunner,
} from "../src/session/wake/index.js";

function item(
  partial: Partial<AsyncWakeItem> & Pick<AsyncWakeItem, "id" | "urgency" | "body">,
): AsyncWakeItem {
  return {
    userId: "u",
    agentId: "a",
    kind: "personal",
    markDelivered: () => undefined,
    ...partial,
  };
}

it("formats wake envelope for the model", () => {
  const text = formatWakeContent([
    item({ id: "1", urgency: "batch", body: "【委托完成】ok" }),
    item({ id: "2", urgency: "batch", body: "【后台任务完成】done" }),
  ]);
  expect(text).toContain("【异步结果通知】");
  expect(text).toContain("【委托完成】ok");
  expect(text).toContain("对用户不可见");
});

it("batches success wakes after debounce when idle", async () => {
  const calls: Parameters<AsyncWakeRunner>[0][] = [];
  const runWake: AsyncWakeRunner = async (input) => {
    calls.push(input);
  };
  const broker = new AsyncWakeBroker(runWake, () => false, 30);
  const delivered: string[] = [];
  broker.enqueue(
    item({
      id: "a",
      urgency: "batch",
      body: "one",
      markDelivered: () => delivered.push("a"),
    }),
  );
  broker.enqueue(
    item({
      id: "b",
      urgency: "batch",
      body: "two",
      markDelivered: () => delivered.push("b"),
    }),
  );
  expect(calls).toHaveLength(0);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(calls).toHaveLength(1);
  expect(calls[0]!.content).toContain("one");
  expect(calls[0]!.content).toContain("two");
  expect(delivered.sort()).toEqual(["a", "b"]);
});

it("waits while busy then drains on idle", async () => {
  let busy = true;
  const calls: Parameters<AsyncWakeRunner>[0][] = [];
  const runWake: AsyncWakeRunner = async (input) => {
    calls.push(input);
  };
  const broker = new AsyncWakeBroker(runWake, () => busy, 10);
  broker.enqueue(item({ id: "x", urgency: "immediate", body: "ready" }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(calls).toHaveLength(0);
  busy = false;
  broker.onParentIdle("u", "a", "personal");
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(calls).toHaveLength(1);
});

it("takePending cancels idle wake and hands items to user turn", async () => {
  const calls: Parameters<AsyncWakeRunner>[0][] = [];
  const runWake: AsyncWakeRunner = async (input) => {
    calls.push(input);
  };
  const broker = new AsyncWakeBroker(runWake, () => false, 200);
  broker.enqueue(item({ id: "q", urgency: "batch", body: "pending" }));
  const taken = broker.takePending("u", "a", "personal");
  expect(taken).toHaveLength(1);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(calls).toHaveLength(0);
});

/**
 * 取消异步 → wake 被用户发言/409 abort 打断后，不得立刻自动再开一轮 wake，
 * 否则与重试 prompt 抢 busy，会话半截卡死。应等 onParentIdle 或 takePending。
 */
it("does not auto-redrain after wake failure; holds until onParentIdle", async () => {
  let shouldFail = true;
  let calls = 0;
  const delivered: string[] = [];
  const runWake: AsyncWakeRunner = async () => {
    calls += 1;
    if (shouldFail) throw new Error("aborted");
  };
  const broker = new AsyncWakeBroker(runWake, () => false, 10);
  broker.enqueue(
    item({
      id: "cancel-1",
      urgency: "immediate",
      body: "【委托已取消】",
      markDelivered: () => delivered.push("cancel-1"),
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(calls).toBe(1);
  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(calls).toBe(1);
  expect(delivered).toEqual([]);

  shouldFail = false;
  broker.onParentIdle("u", "a", "personal");
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(calls).toBe(2);
  expect(delivered).toEqual(["cancel-1"]);
});

it("after wake failure takePending still receives requeued items for user turn", async () => {
  const runWake: AsyncWakeRunner = async () => {
    throw new Error("aborted");
  };
  const broker = new AsyncWakeBroker(runWake, () => false, 10);
  broker.enqueue(item({ id: "c", urgency: "immediate", body: "cancelled" }));
  await new Promise((resolve) => setTimeout(resolve, 30));
  const taken = broker.takePending("u", "a", "personal");
  expect(taken.map((entry) => entry.id)).toEqual(["c"]);
  await new Promise((resolve) => setTimeout(resolve, 30));
});

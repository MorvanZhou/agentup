import { expect, it } from "vitest";

import {
  FollowUpQueue,
  FollowUpQueueFull,
  MAX_FOLLOW_UPS,
} from "../src/session/turn/follow-up-queue.js";

/** 固定时钟与 id：顺序断言不依赖真实时间与随机数。 */
function queue(max = MAX_FOLLOW_UPS): FollowUpQueue {
  let seq = 0;
  return new FollowUpQueue({ max, now: () => 1_700_000_000_000 + seq, id: () => `fu-${++seq}` });
}

it("入队按 FIFO 排队，list 是副本", () => {
  const q = queue();
  q.enqueue("先说的");
  q.enqueue("后说的");

  expect(q.list().map((item) => item.text)).toEqual(["先说的", "后说的"]);
  expect(q.size).toBe(2);

  const snapshot = q.list();
  q.enqueue("第三条");
  // 之前拿到的快照不应被后续入队影响
  expect(snapshot).toHaveLength(2);
});

it("空文本不入队", () => {
  const q = queue();
  expect(() => q.enqueue("   ")).toThrow();
  expect(q.size).toBe(0);
});

it(`达到上限 ${MAX_FOLLOW_UPS} 后拒绝入队且队列不变`, () => {
  const q = queue();
  for (let index = 0; index < MAX_FOLLOW_UPS; index += 1) q.enqueue(`第 ${index} 条`);

  expect(() => q.enqueue("多余的一条")).toThrow(FollowUpQueueFull);
  expect(q.size).toBe(MAX_FOLLOW_UPS);
  expect(q.list().some((item) => item.text === "多余的一条")).toBe(false);
});

it("编辑未发送的条目文案", () => {
  const q = queue();
  const first = q.enqueue("打错的字");

  const updated = q.update(first.id, "改好的字");
  expect(updated?.text).toBe("改好的字");
  expect(updated?.id).toBe(first.id);
  expect(q.list()[0]?.text).toBe("改好的字");
});

it("编辑不存在的条目返回 null，编辑成空文本被拒", () => {
  const q = queue();
  const item = q.enqueue("原文");

  expect(q.update("不存在的 id", "新文案")).toBeNull();
  expect(() => q.update(item.id, "  ")).toThrow();
  expect(q.list()[0]?.text).toBe("原文");
});

it("删除单条", () => {
  const q = queue();
  const first = q.enqueue("第一条");
  q.enqueue("第二条");

  expect(q.remove(first.id)).toBe(true);
  expect(q.list().map((item) => item.text)).toEqual(["第二条"]);
  expect(q.remove(first.id)).toBe(false);
});

it("置顶把条目挪到最前，其余顺序不变", () => {
  const q = queue();
  q.enqueue("一");
  const second = q.enqueue("二");
  q.enqueue("三");

  expect(q.promote(second.id)).toBe(true);
  expect(q.list().map((item) => item.text)).toEqual(["二", "一", "三"]);
  expect(q.promote("不存在的 id")).toBe(false);
});

it("shift 逐条消费，空队列返回 undefined", () => {
  const q = queue();
  q.enqueue("一");
  q.enqueue("二");

  expect(q.shift()?.text).toBe("一");
  expect(q.size).toBe(1);
  expect(q.shift()?.text).toBe("二");
  expect(q.shift()).toBeUndefined();
});

it("消费失败放回时保持原顺序，并排在期间新增内容之前", () => {
  const q = queue();
  q.enqueue("一");
  q.enqueue("二");
  const taken = q.drainAll();
  q.enqueue("后来");

  q.restoreFront(taken);

  expect(q.list().map((item) => item.text)).toEqual(["一", "二", "后来"]);
});

it("清空返回被丢弃的条数", () => {
  const q = queue();
  q.enqueue("一");
  q.enqueue("二");

  expect(q.clear()).toBe(2);
  expect(q.size).toBe(0);
});

it("自定义上限生效（群 / 委托可给不同的值）", () => {
  const q = queue(2);
  q.enqueue("一");
  q.enqueue("二");
  expect(() => q.enqueue("三")).toThrow(FollowUpQueueFull);
});

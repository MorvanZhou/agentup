import { expect, it } from "vitest";

import { DelegationProgressHub } from "../src/session/delegation/progress.js";

it("replays buffered chunks to late subscribers then closes", async () => {
  const hub = new DelegationProgressHub();
  const taskId = "task-1";
  hub.write(taskId, [
    { type: "start", messageId: "m1" },
    { type: "text-start", id: "t1" },
  ]);
  hub.write(taskId, [{ type: "text-delta", id: "t1", delta: "hi" }]);

  const seen: string[] = [];
  const { closed, unsubscribe } = hub.subscribe(taskId, (chunk) => {
    seen.push(chunk.type);
  });
  expect(closed).toBe(false);
  expect(seen).toEqual(["start", "text-start", "text-delta"]);

  hub.write(taskId, [{ type: "text-end", id: "t1" }]);
  expect(seen).toContain("text-end");

  hub.finish(taskId);
  unsubscribe();

  const late: string[] = [];
  const again = hub.subscribe(taskId, (chunk) => {
    late.push(chunk.type);
  });
  expect(again.closed).toBe(true);
  expect(late).toEqual(["start", "text-start", "text-delta", "text-end"]);
});

it("emits started events to subscribers", () => {
  const hub = new DelegationProgressHub();
  const events: string[] = [];
  const stop = hub.subscribeStarted((event) => {
    events.push(event.taskId);
  });
  hub.emitStarted({
    taskId: "t1",
    userId: "u",
    fromAgentId: "personal-assistant",
    toAgentId: "weather",
    toAgentName: "天气",
    brief: "查",
    wait: true,
  });
  expect(events).toEqual(["t1"]);
  stop();
});

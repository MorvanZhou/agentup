import { expect, it } from "vitest";

import { TurnStreamHub } from "../src/session/turn/turn-stream-hub.js";

it("replays buffer to late subscribers and closes", () => {
  const hub = new TurnStreamHub();
  const key = TurnStreamHub.key("u1", "pa");
  hub.begin(key);
  hub.write(key, [{ type: "start", messageId: "m1" } as never]);
  const seen: string[] = [];
  const { closed } = hub.subscribe(key, (chunk) => {
    seen.push(String((chunk as { type?: string }).type ?? ""));
  });
  expect(closed).toBe(false);
  expect(seen).toEqual(["start"]);
  hub.write(key, [{ type: "text-delta", id: "t", delta: "hi" } as never]);
  expect(seen).toEqual(["start", "text-delta"]);
  hub.finish(key);
  expect(hub.isOpen(key)).toBe(false);
  const late: string[] = [];
  const again = hub.subscribe(key, (chunk) => {
    late.push(String((chunk as { type?: string }).type ?? ""));
  });
  expect(again.closed).toBe(true);
  expect(late).toEqual(["start", "text-delta"]);
});

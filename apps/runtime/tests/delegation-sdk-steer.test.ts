import { describe, expect, it } from "vitest";

import {
  createSdkDelegationSteerer,
  linkTurnSignal,
} from "../src/session/delegation/run.js";

describe("SDK 委托 steer", () => {
  it("入队 note 并打断本轮，而不是 silent no-op", async () => {
    const notes: string[] = [];
    let interrupted = 0;
    const steer = createSdkDelegationSteerer({
      notes,
      interrupt: () => {
        interrupted += 1;
      },
    });
    await steer("改成 A* 寻路");
    expect(notes).toEqual(["改成 A* 寻路"]);
    expect(interrupted).toBe(1);
  });

  it("turn signal 打断不会污染用户取消 signal", () => {
    const user = new AbortController();
    const turn = new AbortController();
    const linked = linkTurnSignal(user.signal, turn.signal);
    turn.abort();
    expect(linked.aborted).toBe(true);
    expect(user.signal.aborted).toBe(false);
    linked.dispose();
  });

  it("用户取消会一并打断本轮", () => {
    const user = new AbortController();
    const turn = new AbortController();
    const linked = linkTurnSignal(user.signal, turn.signal);
    user.abort();
    expect(linked.aborted).toBe(true);
    linked.dispose();
  });
});

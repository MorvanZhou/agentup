import { createRequire } from "node:module";
import { expect, it, vi } from "vitest";

import type { AttentionSnapshot } from "../../src/shared/api/runtime/chat";
import {
  freshHitlBanners,
  hitlBannerCopy,
  replyBannerCopy,
  suppressBecauseViewing,
} from "../../src/app/native/system-banner";

const { normalizeBannerTarget, showSystemBanner } = createRequire(import.meta.url)(
  "../../electron/system-banner.cjs",
) as {
  normalizeBannerTarget: (value: unknown) => { kind: "agent" | "group"; id: string } | null;
  showSystemBanner: (
    payload: unknown,
    deps: {
      Notification?: new (options: { title: string; body: string }) => {
        on: (event: string, listener: () => void) => void;
        show: () => void;
      };
      isSupported?: () => boolean;
      onClick?: (target: { kind: string; id: string }) => void;
    },
  ) => boolean;
};

function snap(partial: Partial<AttentionSnapshot> = {}): AttentionSnapshot {
  return {
    busyAgentIds: [],
    busyTurns: [],
    approvals: [],
    askUsers: [],
    shellHangs: [],
    ...partial,
  };
}

it("suppresses a banner only while that conversation is focused", () => {
  const target = { kind: "agent" as const, id: "weather" };
  expect(suppressBecauseViewing(true, target, target)).toBe(true);
  expect(suppressBecauseViewing(false, target, target)).toBe(false);
  expect(suppressBecauseViewing(true, { kind: "group", id: "g1" }, target)).toBe(false);
  expect(suppressBecauseViewing(true, null, target)).toBe(false);
});

it("seeds the first attention snapshot and announces only later items", () => {
  const first = freshHitlBanners(null, snap({
    approvals: [{ id: "a1", agentId: "weather", toolCallId: "t", toolName: "bash", args: {} }],
  }));
  expect(first.fresh).toEqual([]);
  expect(first.known.has("approval:a1")).toBe(true);

  const next = freshHitlBanners(first.known, snap({
    approvals: [{ id: "a1", agentId: "weather", toolCallId: "t", toolName: "bash", args: {} }],
    askUsers: [{
      id: "q1",
      agentId: "pm",
      groupId: "g1",
      toolCallId: "t2",
      questions: [],
      askedByName: "设计",
    }],
    shellHangs: [{
      id: "s1",
      agentId: "ops",
      toolCallId: "t3",
      toolName: "bash",
      command: "sleep",
      elapsedMs: 1000,
    }],
  }));
  expect(next.fresh.map((item) => item.key)).toEqual(["ask:q1", "shell:s1"]);
  expect(next.fresh[0]?.target).toEqual({ kind: "group", id: "g1" });
  expect(next.fresh[1]?.target).toEqual({ kind: "agent", id: "ops" });

  const again = freshHitlBanners(next.known, snap({
    askUsers: [{
      id: "q1",
      agentId: "pm",
      groupId: "g1",
      toolCallId: "t2",
      questions: [],
    }],
  }));
  expect(again.fresh).toEqual([]);
});

it("uses the agent or group name as the banner title", () => {
  expect(replyBannerCopy("天气", "  明天有雨\n带伞  ")).toEqual({
    title: "天气",
    body: "明天有雨 带伞",
  });
  expect(replyBannerCopy("天气", "   ")).toEqual({
    title: "天气",
    body: "有新回复",
  });
  expect(
    replyBannerCopy(
      "小A",
      "你好！有什么我可以帮你的吗？（提醒：如果接下来要派活给专员，我会先按规则做一次 agent_search 确认人选，再协调处理。）",
    ).body,
  ).toBe("你好！有什么我可以帮你的吗？（提醒：如…");
  expect(hitlBannerCopy("天气", {
    key: "approval:a1",
    kind: "approval",
    target: { kind: "agent", id: "weather" },
  }).body).toBe("等待你的批准");
  expect(hitlBannerCopy("产品群", {
    key: "ask:q1",
    kind: "ask",
    target: { kind: "group", id: "g1" },
    askedByName: "设计",
  }).body).toBe("「设计」等待你的回答");
  expect(hitlBannerCopy("运维", {
    key: "shell:s1",
    kind: "shell",
    target: { kind: "agent", id: "ops" },
  }).body).toBe("有一条命令需要你处理");
});

it("rejects a banner target that is not an agent or group id", () => {
  expect(normalizeBannerTarget(null)).toBeNull();
  expect(normalizeBannerTarget({ kind: "file", id: "x" })).toBeNull();
  expect(normalizeBannerTarget({ kind: "agent", id: "  " })).toBeNull();
  expect(normalizeBannerTarget({ kind: "group", id: "g1" })).toEqual({ kind: "group", id: "g1" });
});

it("shows a system banner and focuses the conversation on click", () => {
  const show = vi.fn();
  const on = vi.fn();
  const onClick = vi.fn();
  class FakeNotification {
    static shown = 0;
    constructor(public options: { title: string; body: string }) {}
    on(event: string, listener: () => void) {
      on(event);
      if (event === "click") listener();
    }
    show() {
      show();
    }
  }
  expect(
    showSystemBanner(
      { title: "天气", body: "明天有雨", target: { kind: "agent", id: "weather" } },
      { Notification: FakeNotification, isSupported: () => true, onClick },
    ),
  ).toBe(true);
  expect(show).toHaveBeenCalledOnce();
  expect(onClick).toHaveBeenCalledWith({ kind: "agent", id: "weather" });
});

it("skips the banner when the system cannot show one", () => {
  const onClick = vi.fn();
  expect(
    showSystemBanner(
      { title: "天气", body: "明天有雨", target: { kind: "agent", id: "weather" } },
      { isSupported: () => false, onClick },
    ),
  ).toBe(false);
  expect(onClick).not.toHaveBeenCalled();
  expect(showSystemBanner({ title: "  ", body: "x", target: { kind: "agent", id: "a" } }, {})).toBe(false);
});

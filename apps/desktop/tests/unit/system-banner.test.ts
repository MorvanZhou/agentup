import { createRequire } from "node:module";
import { expect, it, vi } from "vitest";

import type { AttentionSnapshot } from "../../src/shared/api/runtime/chat";
import {
  freshHitlBanners,
  hitlBannerCopy,
  replyBannerCopy,
  suppressBecauseViewing,
} from "../../src/app/native/system-banner";

const {
  buildWindowsToastXml,
  flashTaskbarAttention,
  normalizeBannerTarget,
  parseNoticeDeepLink,
  showSystemBanner,
} = createRequire(import.meta.url)("../../electron/system-banner.cjs") as {
  buildWindowsToastXml: (input: unknown) => string;
  flashTaskbarAttention: (deps: {
    platform?: string;
    getWindows?: () => Array<{
      isDestroyed?: () => boolean;
      isFocused?: () => boolean;
      once?: (event: string, listener: () => void) => void;
      flashFrame?: (value: boolean) => void;
    }>;
  }) => number;
  normalizeBannerTarget: (value: unknown) => { kind: "agent" | "group"; id: string } | null;
  parseNoticeDeepLink: (url: unknown) => { kind: "agent" | "group"; id: string } | null;
  showSystemBanner: (
    payload: unknown,
    deps: {
      platform?: string;
      Notification?: new (options: Record<string, unknown>) => {
        on: (event: string, listener: () => void) => void;
        show: () => void;
      };
      isSupported?: () => boolean;
      onClick?: (target: { kind: string; id: string }) => void;
      flashTaskbar?: () => void;
      icon?: string;
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

it("builds a Windows toast with an open-chat button that deep-links the conversation", () => {
  const xml = buildWindowsToastXml({
    title: "小A",
    body: "你好",
    actionLabel: "打开对话",
    target: { kind: "agent", id: "weather" },
    icon: "C:\\AgentUp\\icon.ico",
  });
  expect(xml).toContain('activationType="protocol"');
  expect(xml).toContain("agentup://notice?kind=agent&amp;id=weather");
  expect(xml).toContain('content="打开对话"');
  expect(xml).toContain("<text>小A</text>");
  expect(xml).toContain("<text>你好</text>");
  expect(xml).toContain("file:///C:/AgentUp/icon.ico");
  expect(buildWindowsToastXml({ title: "x", body: "y", actionLabel: "", target: { kind: "agent", id: "a" } })).toBe(
    "",
  );
});

it("parses notice deep links from Windows toast activation", () => {
  expect(parseNoticeDeepLink("agentup://notice?kind=agent&id=weather")).toEqual({
    kind: "agent",
    id: "weather",
  });
  expect(parseNoticeDeepLink("agentup://notice?kind=group&id=g1")).toEqual({
    kind: "group",
    id: "g1",
  });
  expect(parseNoticeDeepLink("agentup://open")).toBeNull();
  expect(parseNoticeDeepLink("https://example.com")).toBeNull();
});

it("flashes only unfocused Windows windows and clears on focus", () => {
  const focused = { isFocused: () => true, flashFrame: vi.fn(), once: vi.fn() };
  const background = {
    isFocused: () => false,
    flashFrame: vi.fn(),
    once: vi.fn((event: string, listener: () => void) => {
      if (event === "focus") listener();
    }),
  };
  expect(
    flashTaskbarAttention({
      platform: "win32",
      getWindows: () => [focused, background],
    }),
  ).toBe(1);
  expect(focused.flashFrame).not.toHaveBeenCalled();
  expect(background.flashFrame).toHaveBeenCalledWith(true);
  expect(background.flashFrame).toHaveBeenCalledWith(false);
  expect(flashTaskbarAttention({ platform: "darwin", getWindows: () => [background] })).toBe(0);
});

it("shows a system banner and focuses the conversation on click", () => {
  const show = vi.fn();
  const on = vi.fn();
  const onClick = vi.fn();
  const flashTaskbar = vi.fn();
  class FakeNotification {
    options: Record<string, unknown>;
    constructor(options: Record<string, unknown>) {
      this.options = options;
    }
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
      {
        title: "天气",
        body: "明天有雨",
        actionLabel: "打开对话",
        target: { kind: "agent", id: "weather" },
      },
      {
        platform: "darwin",
        Notification: FakeNotification,
        isSupported: () => true,
        onClick,
        flashTaskbar,
      },
    ),
  ).toBe(true);
  expect(show).toHaveBeenCalledOnce();
  expect(onClick).toHaveBeenCalledWith({ kind: "agent", id: "weather" });
  expect(flashTaskbar).toHaveBeenCalledOnce();
});

it("uses toastXml with an action button on Windows", () => {
  const shown: Array<Record<string, unknown>> = [];
  class FakeNotification {
    constructor(options: Record<string, unknown>) {
      shown.push(options);
    }
    on() {}
    show() {}
  }
  expect(
    showSystemBanner(
      {
        title: "天气",
        body: "明天有雨",
        actionLabel: "打开对话",
        target: { kind: "agent", id: "weather" },
      },
      { platform: "win32", Notification: FakeNotification, isSupported: () => true },
    ),
  ).toBe(true);
  expect(String(shown[0]?.toastXml)).toContain('content="打开对话"');
  expect(String(shown[0]?.toastXml)).toContain("agentup://notice?kind=agent&amp;id=weather");
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

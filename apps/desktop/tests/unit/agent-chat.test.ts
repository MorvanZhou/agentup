import type { UIMessage } from "ai";
import { afterEach, expect, it, vi } from "vitest";

import { useAgentChat } from "../../src/pages/conversation/composables/useAgentChat.js";
import { DesktopApi } from "../../src/shared/api/runtime/index.js";
import { setToastOpen, toastState } from "../../src/shared/model/ui/toast.js";

afterEach(() => {
  setToastOpen(false);
  vi.useRealTimers();
});

const sample: UIMessage[] = [
  { id: "user-0", role: "user", parts: [{ type: "text", text: "上海？" }] },
];

it("forget clears cache so the next load refetches history", async () => {
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ messages: sample }))
    .mockResolvedValueOnce(Response.json({ messages: [] }));
  const chat = useAgentChat(new DesktopApi("http://runtime", fetchImpl));

  await chat.load("weather", "token", "patient-a");
  expect(chat.histories.value.weather).toMatchObject(sample);
  expect(chat.isLoaded("weather", "patient-a")).toBe(true);

  await chat.load("weather", "token", "patient-a");
  expect(fetchImpl).toHaveBeenCalledTimes(1);

  chat.forget("weather");
  expect(chat.histories.value.weather).toBeUndefined();
  expect(chat.isLoaded("weather", "patient-a")).toBe(false);

  await chat.load("weather", "token", "patient-a");
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(chat.histories.value.weather).toEqual([]);
});

it("clearHistory deletes remote history and reloads empty cache", async () => {
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ messages: sample }))
    .mockResolvedValueOnce(Response.json({ cleared: true }))
    .mockResolvedValueOnce(Response.json({ messages: [] }));
  const chat = useAgentChat(new DesktopApi("http://runtime", fetchImpl));

  await chat.load("weather", "token", "patient-a");
  expect(chat.histories.value.weather).toMatchObject(sample);

  await chat.clearHistory("weather", "token", "patient-a");
  expect(fetchImpl).toHaveBeenNthCalledWith(
    2,
    "http://runtime/agents/weather/history?user_id=patient-a",
    expect.objectContaining({ method: "DELETE" }),
  );
  expect(chat.histories.value.weather).toEqual([]);
});

it("setApproval keeps a single slot per approval id across agents", () => {
  const chat = useAgentChat(new DesktopApi("http://runtime", vi.fn()));
  const approval = {
    id: "appr-shared",
    toolCallId: "call-1",
    toolName: "bash",
    args: { command: "pwd" },
  };
  chat.setApproval("weather", approval);
  chat.setApproval("personal-assistant", approval);
  expect(chat.approvals.value.weather).toBeUndefined();
  expect(chat.approvals.value["personal-assistant"]).toMatchObject(approval);
});

it("decide clears the approval id from every agent slot", async () => {
  const fetchImpl = vi.fn().mockResolvedValueOnce(Response.json({ decided: true }));
  const chat = useAgentChat(new DesktopApi("http://runtime", fetchImpl));
  const approval = {
    id: "appr-1",
    toolCallId: "call-1",
    toolName: "bash",
    args: { command: "pwd" },
  };
  // 模拟旧路径双写后 decide 仍应清干净。
  chat.approvals.value = {
    weather: approval,
    "personal-assistant": approval,
  };
  await chat.decide("personal-assistant", "token", true, "once");
  expect(chat.approvals.value.weather).toBeUndefined();
  expect(chat.approvals.value["personal-assistant"]).toBeUndefined();
});

it("ingestUnseenAsync silent-acks sync wait tasks without toasting", async () => {
  const acks: string[] = [];
  const fetchImpl = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    const path = String(url);
    if (path.includes("/ack") && init?.method === "POST") {
      const id = path.match(/delegations\/([^/]+)\/ack/)?.[1] ?? "";
      acks.push(decodeURIComponent(id));
      return Response.json({ id, seen: true, notified: true });
    }
    return Response.json({ messages: [] });
  });
  const chat = useAgentChat(new DesktopApi("http://runtime", fetchImpl));
  await chat.ingestUnseenAsync(
    "token",
    "patient-a",
    [
      {
        id: "sync-1",
        fromAgentId: "personal-assistant",
        toAgentId: "weather",
        toAgentName: "Weaty",
        brief: "查天气",
        status: "completed",
        wait: true,
        resultSummary: "晴",
        error: null,
        seen: false,
        notified: false,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "async-pending",
        fromAgentId: "personal-assistant",
        toAgentId: "weather",
        toAgentName: "Weaty",
        brief: "再查",
        status: "completed",
        wait: false,
        resultSummary: "雨",
        error: null,
        seen: false,
        notified: false,
        createdAt: 2,
        updatedAt: 2,
      },
    ],
    [],
  );

  expect(acks).toEqual(["sync-1"]);
  expect(toastState.open).toBe(false);
});

it("ingestUnseenAsync silent-acks group tasks without toast or private unread", async () => {
  const acks: string[] = [];
  const turnEnds: Array<{ agentId: string; preview: string }> = [];
  const fetchImpl = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    const path = String(url);
    if (path.includes("/ack") && init?.method === "POST") {
      const id = path.match(/delegations\/([^/]+)\/ack/)?.[1] ?? "";
      acks.push(decodeURIComponent(id));
      return Response.json({ id, seen: true, notified: true });
    }
    return Response.json({ messages: [] });
  });
  const chat = useAgentChat(new DesktopApi("http://runtime", fetchImpl), {
    onTurnEnd: (agentId, preview) => turnEnds.push({ agentId, preview }),
  });
  await chat.ingestUnseenAsync(
    "token",
    "patient-a",
    [
      {
        id: "group-cancel-1",
        fromAgentId: "remy",
        toAgentId: "cody",
        toAgentName: "Cody",
        brief: "任务：做一个『科技感网页背景』",
        status: "cancelled",
        wait: false,
        groupId: "group-dev",
        resultSummary: "已取消",
        error: null,
        seen: false,
        notified: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    [],
  );

  expect(acks).toEqual(["group-cancel-1"]);
  expect(toastState.open).toBe(false);
  expect(turnEnds).toEqual([]);
});

it("ingestUnseenAsync toasts and acks only after async notified", async () => {
  const acks: string[] = [];
  const fetchImpl = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    const path = String(url);
    if (path.includes("/ack") && init?.method === "POST") {
      const id = path.match(/delegations\/([^/]+)\/ack/)?.[1] ?? "";
      acks.push(decodeURIComponent(id));
      return Response.json({ id, seen: true, notified: true });
    }
    if (path.includes("/history")) {
      return Response.json({
        messages: [
          {
            id: "a1",
            role: "assistant",
            parts: [{ type: "text", text: "深圳今天晴。" }],
          },
        ],
      });
    }
    return Response.json({});
  });
  const chat = useAgentChat(new DesktopApi("http://runtime", fetchImpl));
  await chat.ingestUnseenAsync(
    "token",
    "patient-a",
    [
      {
        id: "async-done",
        fromAgentId: "personal-assistant",
        toAgentId: "weather",
        toAgentName: "Weaty",
        brief: "查天气",
        status: "completed",
        wait: false,
        resultSummary: "晴",
        error: null,
        seen: false,
        notified: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    [],
  );

  expect(acks).toEqual(["async-done"]);
  expect(toastState.open).toBe(true);
  expect(toastState.message).toContain("Weaty");
});

it("clearContext and clearHistory drop pending askUser and approval", async () => {
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ messages: sample }))
    .mockResolvedValueOnce(Response.json({ cleared: true }))
    .mockResolvedValueOnce(Response.json({ messages: [] }))
    .mockResolvedValueOnce(Response.json({ cleared: true }))
    .mockResolvedValueOnce(Response.json({ messages: [] }));
  const chat = useAgentChat(new DesktopApi("http://runtime", fetchImpl));
  await chat.load("weather", "token", "patient-a");
  chat.setAskUser("weather", {
    id: "ask-1",
    toolCallId: "call-1",
    questions: [{ question: "？", options: [{ title: "A" }], allowMultiple: false }],
  });
  chat.setApproval("weather", {
    id: "appr-1",
    toolCallId: "call-2",
    toolName: "bash",
    args: { command: "ls" },
  });

  await chat.clearContext("weather", "token", "patient-a");
  expect(chat.askUsers.value.weather).toBeUndefined();
  expect(chat.approvals.value.weather).toBeUndefined();

  chat.setAskUser("weather", {
    id: "ask-2",
    toolCallId: "call-3",
    questions: [{ question: "？", options: [{ title: "A" }], allowMultiple: false }],
  });
  await chat.clearHistory("weather", "token", "patient-a");
  expect(chat.askUsers.value.weather).toBeUndefined();
});


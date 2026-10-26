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

it("watchDelegations silent-acks sync wait tasks without toasting", async () => {
  vi.useFakeTimers();
  const acks: string[] = [];
  const fetchImpl = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    const path = String(url);
    if (path.includes("/delegations?") && !path.includes("/ack")) {
      return Response.json({
        tasks: [
          {
            id: "sync-1",
            from_agent_id: "personal-assistant",
            to_agent_id: "weather",
            to_agent_name: "Weaty",
            brief: "查天气",
            status: "completed",
            wait: true,
            result_summary: "晴",
            error: null,
            seen: false,
            notified: false,
            created_at: 1,
            updated_at: 1,
          },
          {
            id: "async-pending",
            from_agent_id: "personal-assistant",
            to_agent_id: "weather",
            to_agent_name: "Weaty",
            brief: "再查",
            status: "completed",
            wait: false,
            result_summary: "雨",
            error: null,
            seen: false,
            notified: false,
            created_at: 2,
            updated_at: 2,
          },
        ],
      });
    }
    if (path.includes("/background-jobs?")) {
      return Response.json({ jobs: [] });
    }
    if (path.includes("/ack") && init?.method === "POST") {
      const id = path.match(/delegations\/([^/]+)\/ack/)?.[1] ?? "";
      acks.push(decodeURIComponent(id));
      return Response.json({ id, seen: true, notified: true });
    }
    return Response.json({ messages: [] });
  });
  const chat = useAgentChat(new DesktopApi("http://runtime", fetchImpl));
  chat.watchDelegations("personal-assistant", "token", "patient-a");
  await vi.advanceTimersByTimeAsync(0);
  await Promise.resolve();
  await Promise.resolve();

  expect(acks).toEqual(["sync-1"]);
  expect(toastState.open).toBe(false);

  chat.stopDelegationWatch();
});

it("watchDelegations toasts and acks only after async notified", async () => {
  vi.useFakeTimers();
  const acks: string[] = [];
  const fetchImpl = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    const path = String(url);
    if (path.includes("/delegations?") && !path.includes("/ack")) {
      return Response.json({
        tasks: [
          {
            id: "async-done",
            from_agent_id: "personal-assistant",
            to_agent_id: "weather",
            to_agent_name: "Weaty",
            brief: "查天气",
            status: "completed",
            wait: false,
            result_summary: "晴",
            error: null,
            seen: false,
            notified: true,
            created_at: 1,
            updated_at: 1,
          },
        ],
      });
    }
    if (path.includes("/background-jobs?")) {
      return Response.json({ jobs: [] });
    }
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
  chat.watchDelegations("personal-assistant", "token", "patient-a");
  await vi.advanceTimersByTimeAsync(0);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  expect(acks).toEqual(["async-done"]);
  expect(toastState.open).toBe(true);
  expect(toastState.message).toContain("Weaty");

  chat.stopDelegationWatch();
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


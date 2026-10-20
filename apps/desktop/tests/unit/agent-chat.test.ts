import type { UIMessage } from "ai";
import { expect, it, vi } from "vitest";

import { useAgentChat } from "../../src/pages/conversation/composables/useAgentChat.js";
import { DesktopApi } from "../../src/shared/api/runtime/index.js";

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


import { expect, it, vi } from "vitest";

import { DesktopApi } from "../../src/shared/api/runtime/index.js";
import {
  isContextResetMessage,
  lastMessagePreview,
  lastUserText,
  parseHistory,
} from "../../src/shared/model/chat/chat.js";

it("loads UIMessage history from the local runtime", async () => {
  const fetchImpl = vi.fn(async () =>
    Response.json({
      messages: [
        { id: "user-0", role: "user", parts: [{ type: "text", text: "上海？" }] },
        {
          id: "assistant-1",
          role: "assistant",
          parts: [
            {
              type: "dynamic-tool",
              toolCallId: "call-1",
              toolName: "bash",
              state: "output-available",
              input: { command: "node x" },
              output: "{}",
            },
            { type: "text", text: "晴", state: "done" },
          ],
        },
      ],
    }),
  );
  const history = await new DesktopApi("http://runtime", fetchImpl).history("token", "weather", "patient a");
  expect(fetchImpl).toHaveBeenCalledWith(
    "http://runtime/agents/weather/history?user_id=patient%20a",
    expect.objectContaining({ method: "GET", headers: { authorization: "Bearer token" } }),
  );
  expect(history).toMatchObject([
    { role: "user", parts: [{ type: "text", text: "上海？" }] },
    {
      role: "assistant",
      parts: [
        { type: "dynamic-tool", toolName: "bash", state: "output-available", output: "{}" },
        { type: "text", text: "晴" },
      ],
    },
  ]);
  expect(lastUserText(history)).toBe("上海？");

  const broken = vi.fn(async () => Response.json({ messages: [{ id: 1 }] }));
  await expect(new DesktopApi("http://runtime", broken).history("token", "weather", "patient-a")).rejects.toThrow(
    "聊天记录无效",
  );
});

it("rejects flat legacy history shapes", () => {
  expect(() =>
    parseHistory([{ id: "user-0", role: "user", text: "hi", reasoning: "", tools: [] }]),
  ).toThrow("聊天记录无效");
});

it("clears model context via the local runtime", async () => {
  const fetchImpl = vi.fn(async () => Response.json({ cleared: true }));
  await new DesktopApi("http://runtime", fetchImpl).clearContext("token", "weather", "patient a");
  expect(fetchImpl).toHaveBeenCalledWith(
    "http://runtime/agents/weather/context",
    expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ authorization: "Bearer token" }),
      body: JSON.stringify({ user_id: "patient a" }),
    }),
  );
});

it("clears chat history via the local runtime", async () => {
  const fetchImpl = vi.fn(async () => Response.json({ cleared: true }));
  await new DesktopApi("http://runtime", fetchImpl).clearHistory("token", "weather", "patient a");
  expect(fetchImpl).toHaveBeenCalledWith(
    "http://runtime/agents/weather/history?user_id=patient%20a",
    expect.objectContaining({
      method: "DELETE",
      headers: expect.objectContaining({ authorization: "Bearer token" }),
    }),
  );
});

it("recognizes context-reset markers from history", () => {
  const history = parseHistory([
    {
      id: "context-reset-1",
      role: "system",
      parts: [{ type: "text", text: "已开始新对话，之后不再带入此前上下文" }],
      metadata: { custom: { agentUpKind: "context-reset" } },
    },
  ]);
  expect(isContextResetMessage(history[0]!)).toBe(true);
  expect(isContextResetMessage({ role: "system", id: "context-reset-pending" })).toBe(true);
  expect(isContextResetMessage({ role: "assistant", id: "assistant-1" })).toBe(false);
});

it("accepts file parts in history messages", () => {
  const history = parseHistory([
    {
      id: "user-0",
      role: "user",
      parts: [
        { type: "text", text: "看图" },
        {
          type: "file",
          mediaType: "image/png",
          url: "data:image/png;base64,abc",
          filename: "a.png",
        },
      ],
    },
  ]);
  expect(history[0]?.parts).toEqual([
    { type: "text", text: "看图" },
    {
      type: "file",
      mediaType: "image/png",
      url: "data:image/png;base64,abc",
      filename: "a.png",
    },
  ]);
});

it("builds a single-line preview from the latest message text", () => {
  const history = parseHistory([
    { id: "user-0", role: "user", parts: [{ type: "text", text: "你好" }] },
    {
      id: "assistant-1",
      role: "assistant",
      parts: [{ type: "text", text: "  今天\n天气不错  " }],
    },
  ]);
  expect(lastMessagePreview(history)).toBe("今天 天气不错");

  const afterReset = parseHistory([
    { id: "user-0", role: "user", parts: [{ type: "text", text: "旧消息" }] },
    {
      id: "context-reset-1",
      role: "system",
      parts: [{ type: "text", text: "已开始新对话，之后不再带入此前上下文" }],
      metadata: { custom: { agentUpKind: "context-reset" } },
    },
  ]);
  expect(lastMessagePreview(afterReset)).toBe("旧消息");
});

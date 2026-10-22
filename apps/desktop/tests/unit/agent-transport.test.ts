import { expect, it } from "vitest";
import type { UIMessage } from "ai";

import { createAgentUpTransport } from "../../src/shared/api/agent-transport";
import { agentUpEntryId, userTurnOrdinalAfterReset } from "../../src/shared/model/chat";

it("counts user turns after the latest context reset", () => {
  const messages = [
    user("旧问"),
    assistant("旧答"),
    {
      id: "context-reset-1",
      role: "system" as const,
      parts: [{ type: "text" as const, text: "已开始新对话" }],
      metadata: { custom: { agentUpKind: "context-reset" } },
    },
    user("新问"),
    assistant("新答"),
    user("再问"),
  ];
  expect(userTurnOrdinalAfterReset(messages)).toBe(1);
});

it("reads agentUpEntryId from metadata.custom", () => {
  expect(
    agentUpEntryId({
      id: "x",
      role: "user",
      parts: [],
      metadata: { custom: { agentUpEntryId: "entry-9" } },
    }),
  ).toBe("entry-9");
});

it("sends rewind fields when editing a prior user message with messageId", async () => {
  let body: Record<string, unknown> | undefined;
  const transport = createAgentUpTransport({
    baseUrl: "http://127.0.0.1:9",
    token: "t",
    userId: "u1",
    agentId: "weather",
    fetchImpl: (async (_input, init) => {
      body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return new Response("{}", { status: 200 });
    }) as typeof fetch,
  });

  const messages: UIMessage[] = [
    {
      id: "entry-a",
      role: "user",
      parts: [{ type: "text", text: "改过的问题" }],
      metadata: { custom: { agentUpEntryId: "entry-a" } },
    },
  ];

  await transport.sendMessages({
    trigger: "submit-message",
    chatId: "weather",
    messageId: "entry-a",
    messages,
    abortSignal: new AbortController().signal,
  });

  expect(body).toMatchObject({
    user_id: "u1",
    text: "改过的问题",
    rewind_message_id: "entry-a",
    user_turn_ordinal: 0,
  });
});

it("sends user_turn_ordinal without messageId (assistant-ui onEdit path)", async () => {
  let body: Record<string, unknown> | undefined;
  const transport = createAgentUpTransport({
    baseUrl: "http://127.0.0.1:9",
    token: "t",
    userId: "u1",
    agentId: "weather",
    fetchImpl: (async (_input, init) => {
      body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return new Response("{}", { status: 200 });
    }) as typeof fetch,
  });

  // onEdit：截到父消息后追加新 user，不带 messageId；ordinal 仍指向被编辑的 turn。
  await transport.sendMessages({
    trigger: "submit-message",
    chatId: "weather",
    messageId: undefined,
    messages: [user("改过的问题")],
    abortSignal: new AbortController().signal,
  });

  expect(body).toEqual({
    user_id: "u1",
    text: "改过的问题",
    user_turn_ordinal: 0,
  });
});

it("still sends ordinal on a fresh follow-up submit (runtime no-ops if entry missing)", async () => {
  let body: Record<string, unknown> | undefined;
  const transport = createAgentUpTransport({
    baseUrl: "http://127.0.0.1:9",
    token: "t",
    userId: "u1",
    agentId: "weather",
    fetchImpl: (async (_input, init) => {
      body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return new Response("{}", { status: 200 });
    }) as typeof fetch,
  });

  await transport.sendMessages({
    trigger: "submit-message",
    chatId: "weather",
    messageId: undefined,
    messages: [user("先问"), assistant("先答"), user("再问")],
    abortSignal: new AbortController().signal,
  });

  expect(body).toEqual({
    user_id: "u1",
    text: "再问",
    user_turn_ordinal: 1,
  });
});

it("regenerate-message also sends rewind ordinal for the last user turn", async () => {
  let body: Record<string, unknown> | undefined;
  const transport = createAgentUpTransport({
    baseUrl: "http://127.0.0.1:9",
    token: "t",
    userId: "u1",
    agentId: "weather",
    fetchImpl: (async (_input, init) => {
      body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return new Response("{}", { status: 200 });
    }) as typeof fetch,
  });

  await transport.sendMessages({
    trigger: "regenerate-message",
    chatId: "weather",
    messageId: "assistant-1",
    messages: [
      {
        id: "entry-user-1",
        role: "user",
        parts: [{ type: "text", text: "随便画一个信息图" }],
        metadata: { custom: { agentUpEntryId: "entry-user-1" } },
      },
    ],
    abortSignal: new AbortController().signal,
  });

  expect(body).toMatchObject({
    user_id: "u1",
    text: "随便画一个信息图",
    user_turn_ordinal: 0,
    rewind_message_id: "entry-user-1",
  });
});

it("on 409 aborts busy turn then retries prompt once", async () => {
  const calls: string[] = [];
  let promptAttempts = 0;
  const transport = createAgentUpTransport({
    baseUrl: "http://127.0.0.1:9",
    token: "t",
    userId: "u1",
    agentId: "personal-assistant",
    fetchImpl: (async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/personal-assistant/abort")) {
        return new Response(JSON.stringify({ aborted: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      promptAttempts += 1;
      if (promptAttempts === 1) {
        return new Response(JSON.stringify({ error: "正在回复" }), {
          status: 409,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("{}", { status: 200 });
    }) as typeof fetch,
  });

  await transport.sendMessages({
    trigger: "submit-message",
    chatId: "personal-assistant",
    messageId: undefined,
    messages: [user("再发")],
    abortSignal: new AbortController().signal,
  });

  expect(promptAttempts).toBe(2);
  expect(calls.some((url) => url.endsWith("/personal-assistant/abort"))).toBe(true);
});

it("does not render raw JSON when prompt stays busy after retry", async () => {
  const transport = createAgentUpTransport({
    baseUrl: "http://127.0.0.1:9",
    token: "t",
    userId: "u1",
    agentId: "weather",
    fetchImpl: (async (input) => {
      const url = String(input);
      if (url.endsWith("/abort")) {
        return new Response(JSON.stringify({ aborted: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "正在回复" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
  });

  await expect(
    transport.sendMessages({
      trigger: "submit-message",
      chatId: "weather",
      messageId: undefined,
      messages: [user("再发")],
      abortSignal: new AbortController().signal,
    }),
  ).rejects.toThrow("正在回复");
});

it("sends image attachments as base64; file refs stay in text only", async () => {
  let body: Record<string, unknown> | undefined;
  const transport = createAgentUpTransport({
    baseUrl: "http://127.0.0.1:9",
    token: "t",
    userId: "u1",
    agentId: "personal-assistant",
    fetchImpl: (async (_input, init) => {
      body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return new Response("{}", { status: 200 });
    }) as typeof fetch,
  });
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");

  await transport.sendMessages({
    trigger: "submit-message",
    chatId: "personal-assistant",
    messageId: undefined,
    messages: [
      {
        id: "u-img",
        role: "user",
        parts: [
          {
            type: "text",
            text: "看这个 @ATTACHMENTS/id1/note.txt 和这张图",
          },
          {
            type: "file",
            mediaType: "image/png",
            url: `data:image/png;base64,${png}`,
            filename: "shot.png",
          },
          {
            type: "file",
            mediaType: "text/plain",
            url: "data:text/plain;base64,YQ==",
            filename: "note.txt",
          },
        ],
      },
    ],
    abortSignal: new AbortController().signal,
  });

  expect(body).toMatchObject({
    user_id: "u1",
    text: "看这个 @ATTACHMENTS/id1/note.txt 和这张图",
    attachments: [{ name: "shot.png", media_type: "image/png", data_base64: png }],
    user_turn_ordinal: 0,
  });
  expect(body?.attachments).toHaveLength(1);
});

function user(text: string): UIMessage {
  return { id: `u-${text}`, role: "user", parts: [{ type: "text", text }] };
}

function assistant(text: string): UIMessage {
  return { id: `a-${text}`, role: "assistant", parts: [{ type: "text", text }] };
}

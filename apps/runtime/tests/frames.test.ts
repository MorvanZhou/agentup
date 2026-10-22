import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

import { expect, it } from "vitest";

import { PiUIMessageProjector } from "../src/session/history/frames.js";

it("projects streaming text, reasoning, and tool calls as UIMessage chunks", () => {
  const projector = new PiUIMessageProjector();
  const chunks = [
    event({ type: "message_start", message: { role: "assistant" } }),
    event({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "先看" } }),
    event({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "你好" } }),
    event({ type: "tool_execution_start", toolCallId: "call-1", toolName: "read", args: { path: "note" } }),
    event({
      type: "tool_execution_end",
      toolCallId: "call-1",
      toolName: "read",
      result: { content: [{ type: "text", text: "病历" }] },
      isError: false,
    }),
  ].flatMap((item) => projector.project(item));
  chunks.push(...projector.finish());

  expect(chunks.map((chunk) => chunk.type)).toEqual([
    "start",
    "start-step",
    "reasoning-start",
    "reasoning-delta",
    "reasoning-end",
    "text-start",
    "text-delta",
    "text-end",
    "tool-input-available",
    "tool-output-available",
    "message-metadata",
    "finish-step",
    "finish",
  ]);
  expect(chunks).toMatchObject([
    { type: "start", messageMetadata: { custom: { agentUpCreatedAt: expect.any(String) } } },
    { type: "start-step" },
    { type: "reasoning-start" },
    { type: "reasoning-delta", delta: "先看" },
    { type: "reasoning-end" },
    { type: "text-start" },
    { type: "text-delta", delta: "你好" },
    { type: "text-end" },
    { type: "tool-input-available", toolCallId: "call-1", toolName: "read", input: { path: "note" }, dynamic: true },
    { type: "tool-output-available", toolCallId: "call-1", output: "病历", dynamic: true },
    {
      type: "message-metadata",
      messageMetadata: { custom: { agentUpSummary: { textPartIndex: 0 } } },
    },
    { type: "finish-step" },
    { type: "finish" },
  ]);
});

it("emits approval data without duplicating tool input", () => {
  const projector = new PiUIMessageProjector();
  const approval = projector.approval({
    id: "approval-1",
    toolCallId: "call-1",
    toolName: "bash",
    args: { command: "ls" },
  });
  const start = projector.project(
    event({ type: "tool_execution_start", toolCallId: "call-1", toolName: "bash", args: { command: "ls" } }),
  );
  expect(approval.map((chunk) => chunk.type)).toEqual([
    "start",
    "start-step",
    "tool-input-available",
    "data-agentup-approval",
  ]);
  expect(approval[0]).toMatchObject({
    type: "start",
    messageMetadata: { custom: { agentUpCreatedAt: expect.any(String) } },
  });
  expect(start).toEqual([]);
});

it("projects streaming toolcall args before execution", () => {
  const projector = new PiUIMessageProjector();
  const partial = {
    content: [{ type: "toolCall", id: "call-ask", name: "ask_user", arguments: {} }],
  };
  const chunks = [
    event({ type: "message_start", message: { role: "assistant" } }),
    event({
      type: "message_update",
      assistantMessageEvent: { type: "toolcall_start", contentIndex: 0, partial },
    }),
    event({
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_delta",
        contentIndex: 0,
        delta: '{"questions":[{"question":"用哪个',
        partial,
      },
    }),
    event({
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_end",
        contentIndex: 0,
        toolCall: {
          type: "toolCall",
          id: "call-ask",
          name: "ask_user",
          arguments: { questions: [{ question: "用哪个数据库？" }] },
        },
        partial,
      },
    }),
    event({
      type: "tool_execution_start",
      toolCallId: "call-ask",
      toolName: "ask_user",
      args: { questions: [{ question: "用哪个数据库？" }] },
    }),
  ].flatMap((item) => projector.project(item));

  expect(chunks.map((chunk) => chunk.type)).toEqual([
    "start",
    "start-step",
    "tool-input-start",
    "tool-input-delta",
    "tool-input-available",
  ]);
  expect(chunks).toMatchObject([
    { type: "start" },
    { type: "start-step" },
    { type: "tool-input-start", toolCallId: "call-ask", toolName: "ask_user", dynamic: true },
    {
      type: "tool-input-delta",
      toolCallId: "call-ask",
      inputTextDelta: '{"questions":[{"question":"用哪个',
    },
    {
      type: "tool-input-available",
      toolCallId: "call-ask",
      toolName: "ask_user",
      input: { questions: [{ question: "用哪个数据库？" }] },
      dynamic: true,
    },
  ]);
});

it("buffers toolcall deltas until id/name arrive (OpenAI-style)", () => {
  const projector = new PiUIMessageProjector();
  const empty = { content: [{ type: "toolCall", id: "", name: "", arguments: {} }] };
  const named = { content: [{ type: "toolCall", id: "call-read", name: "read", arguments: {} }] };
  const chunks = [
    event({
      type: "message_update",
      assistantMessageEvent: { type: "toolcall_start", contentIndex: 0, partial: empty },
    }),
    event({
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_delta",
        contentIndex: 0,
        delta: '{"path":"',
        partial: empty,
      },
    }),
    event({
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_delta",
        contentIndex: 0,
        delta: 'note"}',
        partial: named,
      },
    }),
  ].flatMap((item) => projector.project(item));

  expect(chunks.map((chunk) => chunk.type)).toEqual([
    "start",
    "start-step",
    "tool-input-start",
    "tool-input-delta",
    "tool-input-delta",
  ]);
  expect(chunks).toMatchObject([
    { type: "start" },
    { type: "start-step" },
    { type: "tool-input-start", toolCallId: "call-read", toolName: "read", dynamic: true },
    { type: "tool-input-delta", toolCallId: "call-read", inputTextDelta: '{"path":"' },
    { type: "tool-input-delta", toolCallId: "call-read", inputTextDelta: 'note"}' },
  ]);
});

it("closes open text when toolcall starts before id/name arrive", () => {
  const projector = new PiUIMessageProjector();
  const empty = { content: [{ type: "toolCall", id: "", name: "", arguments: {} }] };
  const chunks = [
    event({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "先写" } }),
    event({
      type: "message_update",
      assistantMessageEvent: { type: "toolcall_start", contentIndex: 0, partial: empty },
    }),
  ].flatMap((item) => projector.project(item));

  expect(chunks.map((chunk) => chunk.type)).toEqual([
    "start",
    "start-step",
    "text-start",
    "text-delta",
    "text-end",
  ]);
});

it("streams preliminary tool output during execution updates", () => {
  const projector = new PiUIMessageProjector();
  const chunks = [
    event({ type: "tool_execution_start", toolCallId: "call-bash", toolName: "bash", args: { command: "ls" } }),
    event({
      type: "tool_execution_update",
      toolCallId: "call-bash",
      toolName: "bash",
      args: { command: "ls" },
      partialResult: { content: [{ type: "text", text: "a\n" }] },
    }),
    event({
      type: "tool_execution_update",
      toolCallId: "call-bash",
      toolName: "bash",
      args: { command: "ls" },
      partialResult: { content: [{ type: "text", text: "a\nb\n" }] },
    }),
    event({
      type: "tool_execution_end",
      toolCallId: "call-bash",
      toolName: "bash",
      result: { content: [{ type: "text", text: "a\nb\n" }] },
      isError: false,
    }),
  ].flatMap((item) => projector.project(item));

  expect(chunks.map((chunk) => chunk.type)).toEqual([
    "start",
    "start-step",
    "tool-input-available",
    "tool-output-available",
    "tool-output-available",
    "tool-output-available",
  ]);
  expect(chunks[3]).toMatchObject({
    type: "tool-output-available",
    toolCallId: "call-bash",
    output: "a\n",
    preliminary: true,
    dynamic: true,
  });
  expect(chunks[4]).toMatchObject({
    type: "tool-output-available",
    output: "a\nb\n",
    preliminary: true,
  });
  expect(chunks[5]).toMatchObject({
    type: "tool-output-available",
    output: "a\nb\n",
    dynamic: true,
  });
  expect(chunks[5]).not.toHaveProperty("preliminary", true);
});

it("emits ask_user data without duplicating tool input", () => {
  const projector = new PiUIMessageProjector();
  const ask = projector.askUser({
    id: "ask-1",
    toolCallId: "call-ask",
    questions: [
      {
        question: "用哪个数据库？",
        context: "单区服务",
        options: [{ title: "Postgres" }, { title: "SQLite" }],
        allowMultiple: false,
      },
    ],
  });
  const start = projector.project(
    event({
      type: "tool_execution_start",
      toolCallId: "call-ask",
      toolName: "ask_user",
      args: { questions: [{ question: "用哪个数据库？" }] },
    }),
  );
  expect(ask.map((chunk) => chunk.type)).toEqual([
    "start",
    "start-step",
    "tool-input-available",
    "data-agentup-ask-user",
  ]);
  expect(ask).toMatchObject([
    { type: "start" },
    { type: "start-step" },
    {
      type: "tool-input-available",
      toolCallId: "call-ask",
      toolName: "ask_user",
      input: {
        questions: [
          {
            question: "用哪个数据库？",
            context: "单区服务",
            allowMultiple: false,
          },
        ],
      },
    },
    {
      type: "data-agentup-ask-user",
      data: {
        id: "ask-1",
        questions: [{ question: "用哪个数据库？" }],
      },
      transient: true,
    },
  ]);
  expect(start).toEqual([]);
});

it("emits agentUpSummary from finish when no summary entry arrived", () => {
  const projector = new PiUIMessageProjector();
  const streamed = [
    event({ type: "message_start", message: { role: "assistant" } }),
    event({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "你好" } }),
  ].flatMap((item) => projector.project(item));
  const textStart = streamed.find((chunk) => chunk.type === "text-start") as { id: string };
  const finished = projector.finish();
  expect(finished).toMatchObject([
    { type: "text-end", id: textStart.id },
    {
      type: "message-metadata",
      messageMetadata: {
        custom: { agentUpSummary: { textPartIndex: 0, textPartId: textStart.id } },
      },
    },
    { type: "finish-step" },
    { type: "finish" },
  ]);
});

it("emits agentUpSummary message-metadata from summary custom entry", () => {
  const projector = new PiUIMessageProjector();
  const streamed = [
    event({ type: "message_start", message: { role: "assistant" } }),
    event({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "先说" } }),
    event({
      type: "tool_execution_start",
      toolCallId: "call-1",
      toolName: "read",
      args: { path: "a" },
    }),
    event({
      type: "tool_execution_end",
      toolCallId: "call-1",
      toolName: "read",
      result: { content: [{ type: "text", text: "ok" }] },
      isError: false,
    }),
    event({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "总结" } }),
  ].flatMap((item) => projector.project(item));

  const textStarts = streamed.filter((chunk) => chunk.type === "text-start") as Array<{
    type: string;
    id: string;
  }>;
  expect(textStarts).toHaveLength(2);

  const meta = projector.project(
    event({
      type: "entry_appended",
      entry: {
        type: "custom",
        customType: "agentup-summary",
        data: { textPartIndex: 1 },
      },
    }),
  );

  expect(meta).toEqual([
    {
      type: "message-metadata",
      messageMetadata: {
        custom: {
          agentUpSummary: {
            textPartIndex: 1,
            textPartId: textStarts[1]?.id,
          },
        },
      },
    },
  ]);
});

function event(value: Record<string, unknown>): AgentSessionEvent {
  return value as AgentSessionEvent;
}

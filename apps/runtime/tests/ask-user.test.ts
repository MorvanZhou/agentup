import { expect, it } from "vitest";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
  AskUserBroker,
  createAskUserExtension,
  formatAskUserResultText,
  parseAskUserAnswer,
} from "../src/session/tools/index.js";

it("resolves a pending ask_user with a selection answer", async () => {
  const broker = new AskUserBroker();
  let seenId = "";
  const unsub = broker.subscribe((request) => {
    seenId = request.id;
    expect(request.questions).toHaveLength(1);
  });
  const pending = broker.request({
    userId: "u1",
    agentId: "a1",
    toolCallId: "call-1",
    questions: [
      {
        question: "用哪个数据库？",
        options: [{ title: "Postgres" }, { title: "SQLite" }],
        allowMultiple: false,
      },
    ],
  });
  expect(seenId).toBeTruthy();
  expect(
    broker.answer(seenId, {
      kind: "answers",
      items: [{ kind: "selection", selections: ["Postgres"] }],
    }),
  ).toBe(true);
  await expect(pending).resolves.toEqual({
    kind: "answers",
    items: [{ kind: "selection", selections: ["Postgres"] }],
  });
  expect(broker.answer(seenId, { kind: "cancelled" })).toBe(false);
  unsub();
});

it("answer 时 emitResolved，文案与 Pi ask_user 工具结果同形", async () => {
  const broker = new AskUserBroker();
  const questions = [
    {
      question: "查天气这事，谁来办？",
      options: [{ title: "交给 Weaty（气象员）" }, { title: "我直接查" }],
      allowMultiple: false,
    },
  ];
  let seenId = "";
  broker.subscribe((request) => {
    seenId = request.id;
  });
  const pending = broker.request({
    userId: "u1",
    agentId: "a1",
    toolCallId: "call-ask",
    questions,
  });
  const seen: Array<{ toolCallId: string; resultText: string }> = [];
  const unsub = broker.subscribeResolved((event) => {
    seen.push({ toolCallId: event.request.toolCallId, resultText: event.resultText });
  });
  const answer = {
    kind: "answers" as const,
    items: [{ kind: "selection" as const, selections: ["交给 Weaty（气象员）"] }],
  };
  expect(broker.answer(seenId, answer)).toBe(true);
  await pending;
  expect(seen).toHaveLength(1);
  expect(seen[0]?.toolCallId).toBe("call-ask");
  expect(seen[0]?.resultText).toBe(formatAskUserResultText(questions, answer));
  expect(seen[0]?.resultText).toContain("User answered:");
  expect(seen[0]?.resultText).toContain("交给 Weaty（气象员）");
  unsub();
});

it("rejects answers whose length does not match questions", async () => {
  const broker = new AskUserBroker();
  let seenId = "";
  broker.subscribe((request) => {
    seenId = request.id;
  });
  const pending = broker.request({
    userId: "u1",
    agentId: "a1",
    toolCallId: "call-batch",
    questions: [
      {
        question: "A?",
        options: [{ title: "1" }],
        allowMultiple: false,
      },
      {
        question: "B?",
        options: [{ title: "2" }],
        allowMultiple: false,
      },
    ],
  });
  expect(
    broker.answer(seenId, {
      kind: "answers",
      items: [{ kind: "selection", selections: ["1"] }],
    }),
  ).toBe(false);
  expect(
    broker.answer(seenId, {
      kind: "answers",
      items: [
        { kind: "selection", selections: ["1"] },
        { kind: "skipped" },
      ],
    }),
  ).toBe(true);
  await expect(pending).resolves.toMatchObject({ kind: "answers" });
});

it("cancels when the abort signal fires", async () => {
  const broker = new AskUserBroker();
  const controller = new AbortController();
  const pending = broker.request(
    {
      userId: "u1",
      agentId: "a1",
      toolCallId: "call-2",
      questions: [
        {
          question: "继续吗？",
          options: [{ title: "是" }, { title: "否" }],
          allowMultiple: false,
        },
      ],
    },
    controller.signal,
  );
  controller.abort();
  await expect(pending).resolves.toEqual({ kind: "cancelled" });
});

it("accepts more than four questions in one ask_user call", async () => {
  const broker = new AskUserBroker();
  let execute:
    | ((
        id: string,
        params: {
          questions: Array<{
            question: string;
            options: Array<{ title: string }>;
          }>;
        },
        signal?: AbortSignal,
      ) => Promise<{ details: { questions?: unknown[]; error?: string } }>)
    | undefined;
  createAskUserExtension(broker, "u1", "a1")({
    registerTool(tool: { execute: NonNullable<typeof execute> }) {
      execute = tool.execute;
    },
  } as unknown as ExtensionAPI);

  const questions = Array.from({ length: 5 }, (_, index) => ({
    question: `Q${index + 1}?`,
    options: [{ title: `A${index + 1}` }],
  }));
  let seenCount = 0;
  broker.subscribe((request) => {
    seenCount = request.questions.length;
    broker.answer(request.id, {
      kind: "answers",
      items: request.questions.map(() => ({ kind: "skipped" as const })),
    });
  });

  const result = await execute!("call-many", { questions });
  expect(seenCount).toBe(5);
  expect(result.details.error).toBeUndefined();
  expect(result.details.questions).toHaveLength(5);
});

it("parses answer bodies from the desktop API", () => {
  expect(parseAskUserAnswer({ cancelled: true })).toEqual({ kind: "cancelled" });
  expect(
    parseAskUserAnswer({
      answer: {
        kind: "answers",
        items: [{ kind: "freeform", text: "  自定义  " }, { kind: "skipped" }],
      },
    }),
  ).toEqual({
    kind: "answers",
    items: [{ kind: "freeform", text: "自定义" }, { kind: "skipped" }],
  });
  expect(
    parseAskUserAnswer({ answer: { kind: "selection", selections: ["A"] } }),
  ).toBeUndefined();
  expect(parseAskUserAnswer({})).toBeUndefined();
});

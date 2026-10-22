import { expect, it } from "vitest";

import { summarizeAskUserTool } from "../../src/pages/conversation/model/message/ask-user-summary.js";

const args = {
  questions: [
    {
      question: "用哪个数据库？",
      context: "单区服务",
      options: [{ title: "Postgres" }, { title: "SQLite" }],
      allowMultiple: false,
    },
    {
      question: "需要哪些能力？",
      options: [{ title: "搜索" }, { title: "联网" }],
      allowMultiple: true,
    },
  ],
};

it("parses answered tool result into dialog-like rows", () => {
  const summary = summarizeAskUserTool(
    args,
    [
      "User answered:",
      "1. 用哪个数据库？ → Postgres",
      "2. 需要哪些能力？ → 搜索; 联网",
    ].join("\n"),
  );
  expect(summary.cancelled).toBe(false);
  expect(summary.rows).toEqual([
    {
      index: 0,
      question: "用哪个数据库？",
      context: "单区服务",
      mode: "单选",
      status: "answered",
      answerLabel: "Postgres",
      answers: ["Postgres"],
    },
    {
      index: 1,
      question: "需要哪些能力？",
      context: undefined,
      mode: "多选",
      status: "answered",
      answerLabel: "搜索；联网",
      answers: ["搜索", "联网"],
    },
  ]);
});

it("marks skipped and cancelled results", () => {
  expect(
    summarizeAskUserTool(
      args,
      ["User answered:", "1. 用哪个数据库？ → Postgres", "2. 需要哪些能力？ → (skipped)"].join(
        "\n",
      ),
    ).rows[1],
  ).toMatchObject({ status: "skipped", answerLabel: "已跳过" });

  const cancelled = summarizeAskUserTool(
    args,
    "User dismissed the questions. Proceed with your best judgment.",
  );
  expect(cancelled.cancelled).toBe(true);
  expect(cancelled.rows.every((row) => row.answerLabel === "已放弃")).toBe(true);

  const interrupted = summarizeAskUserTool(
    args,
    "User dismissed the questions. Session was interrupted before answers were received.",
  );
  expect(interrupted.cancelled).toBe(true);
  expect(interrupted.rows.every((row) => row.answerLabel === "已中断")).toBe(true);
});

it("shows pending rows while waiting for answers", () => {
  const summary = summarizeAskUserTool(args, undefined);
  expect(summary.rows.map((row) => row.status)).toEqual(["pending", "pending"]);
  expect(summary.rows[0]?.answerLabel).toBe("等待回答");
});

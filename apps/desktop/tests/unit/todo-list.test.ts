import { expect, it } from "vitest";

import {
  completedTodoTitle,
  currentTodoParts,
  isPlanComplete,
  isSegmentStreaming,
  parseTodoToolResult,
  planFromTodoParts,
  todoPlacement,
  todoPlanKey,
} from "../../src/pages/conversation/model/message/todo-list.js";

it("reads checklist lines and an error lead from a todo result", () => {
  expect(
    parseTodoToolResult("Added todo #2: 写测试\n[ ] #1: 读文件\n[x] #2: 写测试"),
  ).toEqual({
    items: [
      { id: 1, text: "读文件", done: false },
      { id: 2, text: "写测试", done: true },
    ],
  });
  expect(parseTodoToolResult("Error: text required for add\n[ ] #1: 读文件")).toEqual({
    error: "text required for add",
    items: [{ id: 1, text: "读文件", done: false }],
  });
  expect(parseTodoToolResult("No todos")).toEqual({ items: [] });
});

it("parses vendor TaskCreate success lines and TodoWrite JSON for old transcripts", () => {
  expect(
    parseTodoToolResult("Task #1 created successfully: 构建可运行 UI（index.html + styles.css + app.js）"),
  ).toEqual({
    items: [{ id: 1, text: "构建可运行 UI（index.html + styles.css + app.js）", done: false }],
  });
  expect(
    parseTodoToolResult(
      JSON.stringify({
        todos: [
          { id: "a", content: "读 brief", status: "completed" },
          { id: "b", content: "写 UI", status: "pending" },
        ],
      }),
    ).items.map((item) => ({ text: item.text, done: item.done })),
  ).toEqual([
    { text: "读 brief", done: true },
    { text: "写 UI", done: false },
  ]);
});

it("treats vendor TaskCreate tool parts as todo for PlanDock", () => {
  const plan = planFromTodoParts([
    {
      type: "tool-call",
      toolName: "TaskCreate",
      result: "Task #1 created successfully: 构建可运行 UI",
    },
  ]);
  expect(plan?.items).toEqual([{ id: 1, text: "构建可运行 UI", done: false }]);
});

it("keeps the plan from the current segment and drops it after a new conversation", () => {
  const reset = { role: "system", id: "context-reset-1" };
  const messages = [
    {
      role: "assistant",
      content: [{ type: "tool-call", toolName: "todo", result: "[ ] #1: 旧计划" }],
    },
    reset,
    { role: "user" },
    {
      role: "assistant",
      content: [
        { type: "tool-call", toolName: "todo", result: "[x] #1: 新计划\n[ ] #2: 下一步" },
        { type: "tool-call", toolName: "todo" },
      ],
    },
  ];
  const isReset = (message: { role: string; id?: string }) => message.id === "context-reset-1";
  const plan = planFromTodoParts(currentTodoParts(messages, isReset));
  expect(plan?.items.map((item) => item.text)).toEqual(["新计划", "下一步"]);
  expect(plan?.updating).toBe(true);
  expect(planFromTodoParts(currentTodoParts([messages[0]!, reset], isReset))).toBeUndefined();
});

it("hides a finished plan and treats a later edit as a new plan", () => {
  const done = planFromTodoParts([
    { type: "tool-call", toolName: "todo", result: "[x] #1: 写完" },
  ]);
  const open = planFromTodoParts([
    { type: "tool-call", toolName: "todo", result: "[x] #1: 写完\n[ ] #2: 还没做" },
  ]);
  const updating = planFromTodoParts([
    { type: "tool-call", toolName: "todo", result: "[x] #1: 写完" },
    { type: "tool-call", toolName: "todo" },
  ]);
  expect(done && isPlanComplete(done)).toBe(true);
  expect(done && isPlanComplete(done, true)).toBe(false);
  expect(open && isPlanComplete(open)).toBe(false);
  expect(updating && isPlanComplete(updating)).toBe(false);
  expect(done && completedTodoTitle(done)).toBe("1/1 项已完成");
  expect(open && completedTodoTitle(open)).toBe("1/2 项已完成");
  expect(
    isSegmentStreaming(
      [
        { role: "assistant", status: { type: "complete" } },
        { role: "user" },
        { role: "assistant", status: { type: "running" } },
      ],
      () => false,
    ),
  ).toBe(true);
  expect(done && open && todoPlanKey(done) !== todoPlanKey(open)).toBe(true);
});

it("keeps one anchor and follows the latest finished snapshot", () => {
  const parts = [
    { type: "tool-call", toolName: "todo", result: "[ ] #1: 读文件" },
    { type: "reasoning" },
    { type: "tool-call", toolName: "todo", result: "[x] #1: 读文件" },
    { type: "tool-call", toolName: "todo" },
  ];
  expect(todoPlacement(parts)).toEqual({ anchorIndex: 0, sourceIndex: 2 });
  expect(todoPlacement([{ type: "tool-call", toolName: "read" }])).toBeUndefined();
});

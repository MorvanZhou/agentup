import { expect, it } from "vitest";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  TODO_TOOL,
  applyTodoAction,
  createTodoExtension,
  emptyTodoState,
  formatTodoList,
  todoStateFromEntries,
} from "../src/session/tools/index.js";

it("adds, toggles, lists, and clears without writing outside the result", () => {
  const added = applyTodoAction(emptyTodoState(), { action: "add", text: "  写测试\n" });
  expect(added.error).toBeUndefined();
  expect(added.state).toEqual({ todos: [{ id: 1, text: "写测试", done: false }], nextId: 2 });
  expect(added.text).toBe("Added todo #1: 写测试\n[ ] #1: 写测试");

  const toggled = applyTodoAction(added.state, { action: "toggle", id: 1 });
  expect(toggled.state.todos[0]).toEqual({ id: 1, text: "写测试", done: true });
  expect(formatTodoList(toggled.state.todos)).toBe("[x] #1: 写测试");

  const listed = applyTodoAction(toggled.state, { action: "list" });
  expect(listed.state).toEqual(toggled.state);
  expect(listed.text).toBe("[x] #1: 写测试");

  const cleared = applyTodoAction(listed.state, { action: "clear" });
  expect(cleared.state).toEqual(emptyTodoState());
  expect(cleared.text).toBe("Cleared 1 todos\nNo todos");
});

it("rejects missing text, unknown ids, and a full list", () => {
  expect(applyTodoAction(emptyTodoState(), { action: "add", text: "   " }).error).toBe("text required for add");
  expect(applyTodoAction(emptyTodoState(), { action: "toggle" }).error).toBe("id required for toggle");
  expect(applyTodoAction(emptyTodoState(), { action: "toggle", id: 4 }).error).toBe("#4 not found");

  let state = emptyTodoState();
  for (let index = 0; index < 30; index += 1) {
    state = applyTodoAction(state, { action: "add", text: `任务 ${index}` }).state;
  }
  expect(applyTodoAction(state, { action: "add", text: "再来一个" }).error).toBe("todo list is full");
  expect(state.todos).toHaveLength(30);
});

it("restores the latest snapshot on the current branch and ignores other tools", () => {
  const state = todoStateFromEntries([
    { type: "message", message: { role: "user", content: "hi" } },
    todoEntry([{ id: 1, text: "旧计划", done: false }], 2),
    {
      type: "message",
      message: { role: "toolResult", toolName: "read", details: { todos: [], nextId: 1 } },
    },
    todoEntry(
      [
        { id: 1, text: "旧计划", done: true },
        { id: 2, text: "写测试", done: false },
      ],
      3,
    ),
    { type: "message", message: { role: "toolResult", toolName: TODO_TOOL, details: { todos: "bad" } } },
  ]);
  expect(state).toEqual({
    todos: [
      { id: 1, text: "旧计划", done: true },
      { id: 2, text: "写测试", done: false },
    ],
    nextId: 3,
  });
});

it("rebuilds the list when the session branch changes", async () => {
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => Promise<void>>();
  let execute: ((id: string, params: { action: string; text?: string; id?: number }) => Promise<{ content: Array<{ text: string }>; details: { todos: unknown[]; nextId: number } }>) | undefined;
  createTodoExtension()({
    on(event: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<void>) {
      handlers.set(event, handler);
    },
    registerTool(tool: { execute: NonNullable<typeof execute> }) {
      execute = tool.execute;
    },
  } as unknown as ExtensionAPI);

  const branch = [
    todoEntry([{ id: 1, text: "读文件", done: false }], 2),
  ];
  await handlers.get("session_start")?.({}, { sessionManager: { getBranch: () => branch } } as unknown as ExtensionContext);
  const listed = await execute!("call-1", { action: "list" });
  expect(listed.content[0]?.text).toBe("[ ] #1: 读文件");

  const added = await execute!("call-2", { action: "add", text: "写测试" });
  expect(added.details.todos).toEqual([
    { id: 1, text: "读文件", done: false },
    { id: 2, text: "写测试", done: false },
  ]);
  expect(added.details.nextId).toBe(3);

  await handlers.get("session_tree")?.(
    {},
    { sessionManager: { getBranch: () => branch } } as unknown as ExtensionContext,
  );
  const afterFork = await execute!("call-3", { action: "list" });
  expect(afterFork.content[0]?.text).toBe("[ ] #1: 读文件");
});

function todoEntry(todos: Array<{ id: number; text: string; done: boolean }>, nextId: number) {
  return {
    type: "message",
    message: {
      role: "toolResult",
      toolName: TODO_TOOL,
      details: { action: "add", todos, nextId },
    },
  };
}

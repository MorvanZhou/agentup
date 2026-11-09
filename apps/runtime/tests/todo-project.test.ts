import { expect, it } from "vitest";

import { createExternalTranslator } from "../src/session/external/events.js";
import { codebuddyTodoProjector } from "../src/session/external/sdk/adapters/codebuddy/todo.js";
import { cursorTodoProjector } from "../src/session/external/sdk/adapters/cursor/todo.js";
import {
  emptyTodoBoard,
  flattenToolResultText,
} from "../src/session/external/sdk/host/todo-board.js";

it("codebuddy projector owns Task* but not Bash", () => {
  expect(codebuddyTodoProjector.ownsTool("TaskCreate")).toBe(true);
  expect(codebuddyTodoProjector.ownsTool("TaskUpdate")).toBe(true);
  expect(codebuddyTodoProjector.ownsTool("Bash")).toBe(false);
  expect(cursorTodoProjector.ownsTool("TodoWrite")).toBe(true);
  expect(cursorTodoProjector.ownsTool("TaskCreate")).toBe(false);
});

it("flattens vendor content arrays into result text", () => {
  expect(
    flattenToolResultText([
      { type: "text", text: "Task #1 created successfully: 构建可运行 UI" },
    ]),
  ).toBe("Task #1 created successfully: 构建可运行 UI");
});

it("rewrites TaskCreate into Host formatTodoList lines and keeps the board", () => {
  const first = codebuddyTodoProjector.apply(
    emptyTodoBoard(),
    "TaskCreate",
    {
      subject: "构建可运行 UI（index.html + styles.css + app.js）",
      description: "补齐界面层",
      activeForm: "构建可运行 UI",
    },
    "Task #1 created successfully: 构建可运行 UI（index.html + styles.css + app.js）",
  );
  expect(first.hostArgs).toEqual({
    action: "add",
    text: "构建可运行 UI（index.html + styles.css + app.js）",
  });
  expect(first.resultText).toContain("[ ] #1: 构建可运行 UI（index.html + styles.css + app.js）");
  expect(first.board.items).toEqual([
    { id: 1, text: "构建可运行 UI（index.html + styles.css + app.js）", done: false },
  ]);

  const second = codebuddyTodoProjector.apply(
    first.board,
    "TaskCreate",
    { subject: "写 HANDOFF", description: "交接说明" },
    "Task #2 created successfully: 写 HANDOFF",
  );
  expect(second.resultText).toContain("[ ] #1:");
  expect(second.resultText).toContain("[ ] #2: 写 HANDOFF");
  expect(second.board.items).toHaveLength(2);

  const done = codebuddyTodoProjector.apply(
    second.board,
    "TaskUpdate",
    { taskId: "1", status: "completed" },
    "Updated task #1",
  );
  expect(done.resultText).toContain("[x] #1:");
  expect(done.resultText).toContain("[ ] #2:");
  expect(done.hostArgs).toEqual({ action: "toggle", id: 1 });
});

it("rewrites Cursor TodoWrite merge/replace into Host checklist", () => {
  const replaced = cursorTodoProjector.apply(
    emptyTodoBoard(),
    "TodoWrite",
    {
      merge: false,
      todos: [
        { id: "a", content: "读 brief", status: "completed" },
        { id: "b", content: "写 UI", status: "in_progress" },
      ],
    },
    "Todos updated",
  );
  expect(replaced.board.items.map((item) => ({ text: item.text, done: item.done }))).toEqual([
    { text: "读 brief", done: true },
    { text: "写 UI", done: false },
  ]);
  expect(replaced.resultText).toContain("[x] #");
  expect(replaced.resultText).toContain("写 UI");
});

it("translator without projector leaves TaskCreate as vendor name", () => {
  const translator = createExternalTranslator();
  const start = translator.push({
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "t-raw-1",
          name: "TaskCreate",
          input: { subject: "构建可运行 UI" },
        },
      ],
    },
  });
  expect(start).toEqual([
    expect.objectContaining({
      type: "tool_execution_start",
      toolCallId: "t-raw-1",
      toolName: "TaskCreate",
    }),
  ]);
});

it("translator with codebuddy projector announces TaskCreate as todo and ends with checklist", () => {
  const translator = createExternalTranslator({ todoProjector: codebuddyTodoProjector });
  const start = translator.push({
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "t-create-1",
          name: "TaskCreate",
          input: {
            subject: "构建可运行 UI",
            description: "补齐界面",
            activeForm: "构建可运行 UI",
          },
        },
      ],
    },
  });
  expect(start).toEqual([
    expect.objectContaining({
      type: "tool_execution_start",
      toolCallId: "t-create-1",
      toolName: "todo",
    }),
  ]);

  const end = translator.push({
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "t-create-1",
          content: [{ type: "text", text: "Task #1 created successfully: 构建可运行 UI" }],
        },
      ],
    },
  });
  expect(end).toEqual([
    expect.objectContaining({
      type: "tool_execution_end",
      toolCallId: "t-create-1",
      toolName: "todo",
      isError: false,
      result: expect.stringContaining("[ ] #1: 构建可运行 UI"),
    }),
  ]);

  const tool = translator.trail.find((item) => item.kind === "tool");
  expect(tool).toMatchObject({
    kind: "tool",
    name: "todo",
    done: true,
    args: { action: "add", text: "构建可运行 UI" },
  });
  expect(typeof tool === "object" && tool.kind === "tool" ? tool.result : "").toEqual(
    expect.stringContaining("[ ] #1: 构建可运行 UI"),
  );
});

import { StringEnum, Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionContext, type ExtensionFactory } from "@earendil-works/pi-coding-agent";

/** 当前会话的待办。状态写在 tool result details 里，随分支恢复，不写项目文件。 */
export const TODO_TOOL = "todo";

const MAX_TODOS = 30;
const MAX_TEXT = 160;

export type TodoItem = {
  id: number;
  text: string;
  done: boolean;
};

export type TodoState = {
  todos: TodoItem[];
  nextId: number;
};

export type TodoAction = "list" | "add" | "toggle" | "clear";

type TodoDetails = {
  action: TodoAction;
  todos: TodoItem[];
  nextId: number;
  error?: string;
};

const TodoParams = Type.Object({
  action: StringEnum(["list", "add", "toggle", "clear"] as const, {
    description: "list 查看；add 需要 text；toggle 按 id 切换完成；clear 清空",
  }),
  text: Type.Optional(Type.String({ description: "新任务内容（add）" })),
  id: Type.Optional(Type.Number({ description: "要切换的任务编号（toggle）" })),
});

export function emptyTodoState(): TodoState {
  return { todos: [], nextId: 1 };
}

/** 模型与桌面共用的清单文本。每行 `[ ] #id: text` 或 `[x] #id: text`。 */
export function formatTodoList(todos: readonly TodoItem[]): string {
  if (todos.length === 0) return "No todos";
  return todos.map((todo) => `[${todo.done ? "x" : " "}] #${todo.id}: ${todo.text}`).join("\n");
}

/** 沿当前分支重放 todo 的 details，得到该分支上的清单。 */
export function todoStateFromEntries(entries: readonly unknown[]): TodoState {
  let state = emptyTodoState();
  for (const entry of entries) {
    const next = readTodoState(entry);
    if (next) state = next;
  }
  return state;
}

export function applyTodoAction(
  state: TodoState,
  params: { action?: string; text?: string; id?: number },
): { state: TodoState; text: string; error?: string } {
  const current = cloneState(state);
  switch (params.action) {
    case "list":
      return done(current, "");
    case "add": {
      const text = params.text?.trim().replace(/\s+/g, " ") ?? "";
      if (!text) return done(current, "Error: text required for add", "text required for add");
      if (text.length > MAX_TEXT) return done(current, "Error: text too long", "text too long");
      if (current.todos.length >= MAX_TODOS) return done(current, "Error: todo list is full", "todo list is full");
      const item: TodoItem = { id: current.nextId, text, done: false };
      current.nextId += 1;
      current.todos.push(item);
      return done(current, `Added todo #${item.id}: ${item.text}`);
    }
    case "toggle": {
      if (params.id === undefined) return done(current, "Error: id required for toggle", "id required for toggle");
      if (!Number.isInteger(params.id) || params.id < 1) {
        return done(current, "Error: id required for toggle", "id required for toggle");
      }
      const todo = current.todos.find((item) => item.id === params.id);
      if (!todo) {
        const error = `#${params.id} not found`;
        return done(current, `Error: ${error}`, error);
      }
      todo.done = !todo.done;
      return done(current, `Todo #${todo.id} ${todo.done ? "completed" : "uncompleted"}`);
    }
    case "clear": {
      const count = current.todos.length;
      return done({ todos: [], nextId: 1 }, `Cleared ${count} todos`);
    }
    default:
      return done(current, `Error: unknown action: ${params.action ?? ""}`, `unknown action: ${params.action ?? ""}`);
  }
}

export function createTodoExtension(): ExtensionFactory {
  return (pi) => {
    let state = emptyTodoState();
    const restore = (ctx: ExtensionContext) => {
      state = todoStateFromEntries(ctx.sessionManager.getBranch());
    };
    pi.on("session_start", async (_event, ctx) => restore(ctx));
    pi.on("session_tree", async (_event, ctx) => restore(ctx));

    pi.registerTool(
      defineTool<typeof TodoParams, TodoDetails>({
        name: TODO_TOOL,
        label: "Todo",
        description:
          "Manage the current conversation's todo list. Actions: list, add (text), toggle (id), clear. " +
          "The list follows the session branch and is not written to a file.",
        promptSnippet: "Track the current conversation's task list",
        promptGuidelines: [
          "Use the todo tool for multi-step work in this conversation. Do not create a TODO.md file for that plan.",
          "Add each task before starting it, toggle it when done, and list the plan when you need to recover it.",
        ],
        parameters: TodoParams,
        executionMode: "sequential",
        annotations: {
          readOnlyHint: false,
          openWorldHint: false,
          destructiveHint: false,
        },
        async execute(_toolCallId, params) {
          const result = applyTodoAction(state, params);
          state = result.state;
          const action = isTodoAction(params.action) ? params.action : "list";
          return {
            content: [{ type: "text", text: result.text }],
            details: {
              action,
              todos: result.state.todos.map((item) => ({ ...item })),
              nextId: result.state.nextId,
              ...(result.error ? { error: result.error } : {}),
            },
          };
        },
      }),
    );
  };
}

function done(state: TodoState, lead: string, error?: string): { state: TodoState; text: string; error?: string } {
  const list = formatTodoList(state.todos);
  return {
    state,
    text: lead ? `${lead}\n${list}` : list,
    ...(error ? { error } : {}),
  };
}

function cloneState(state: TodoState): TodoState {
  return {
    todos: state.todos.map((item) => ({ ...item })),
    nextId: state.nextId,
  };
}

function isTodoAction(action: string): action is TodoAction {
  return action === "list" || action === "add" || action === "toggle" || action === "clear";
}

function readTodoState(entry: unknown): TodoState | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const record = entry as { type?: unknown; message?: unknown };
  if (record.type !== "message" || !record.message || typeof record.message !== "object") return undefined;
  const message = record.message as { role?: unknown; toolName?: unknown; details?: unknown };
  if (message.role !== "toolResult" || message.toolName !== TODO_TOOL) return undefined;
  return parseTodoState(message.details);
}

function parseTodoState(details: unknown): TodoState | undefined {
  if (!details || typeof details !== "object") return undefined;
  const record = details as { todos?: unknown; nextId?: unknown };
  if (!Array.isArray(record.todos) || !Number.isInteger(record.nextId) || (record.nextId as number) < 1) {
    return undefined;
  }
  const todos: TodoItem[] = [];
  for (const item of record.todos) {
    if (!item || typeof item !== "object") return undefined;
    const todo = item as { id?: unknown; text?: unknown; done?: unknown };
    if (!Number.isInteger(todo.id) || (todo.id as number) < 1) return undefined;
    if (typeof todo.text !== "string" || typeof todo.done !== "boolean") return undefined;
    todos.push({ id: todo.id as number, text: todo.text, done: todo.done });
  }
  return { todos, nextId: record.nextId as number };
}

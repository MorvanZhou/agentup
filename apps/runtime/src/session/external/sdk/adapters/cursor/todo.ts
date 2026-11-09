import { TODO_TOOL } from "../../../../tools/todo.js";
import {
  bumpTodoNextId,
  cloneTodoBoard,
  flattenToolResultText,
  hostTodoIdOf,
  parseHostTodoChecklist,
  upsertTodoItem,
  withTodoListLead,
  type ExternalTodoApplyResult,
  type ExternalTodoProjector,
  type TodoBoard,
  type TodoItem,
} from "../../host/todo-board.js";

/** Cursor：TodoWrite（及偶见蛇形别名）→ Host todo。 */
const CURSOR_TODO_NAMES = new Set(["TodoWrite", "todo_write", "UpdateTodos", TODO_TOOL]);

export const cursorTodoProjector: ExternalTodoProjector = {
  ownsTool(toolName) {
    return CURSOR_TODO_NAMES.has(toolName.trim());
  },
  apply(board, toolName, args, rawResult) {
    return applyCursorTodo(board, toolName.trim(), args, rawResult);
  },
};

function applyCursorTodo(
  board: TodoBoard,
  name: string,
  args: Record<string, unknown>,
  rawResult: unknown,
): ExternalTodoApplyResult {
  const next = cloneTodoBoard(board);
  const resultBody = flattenToolResultText(rawResult);

  if (name === "TodoWrite" || name === "todo_write" || name === "UpdateTodos") {
    applyTodoWrite(next, args);
    return {
      board: next,
      resultText: withTodoListLead(resultBody, next.items),
      hostArgs: { action: "list" },
    };
  }

  if (name === TODO_TOOL) {
    const parsed = parseHostTodoChecklist(resultBody);
    if (parsed.length > 0) {
      next.items = parsed;
      for (const item of parsed) next.idMap.set(String(item.id), item.id);
      bumpTodoNextId(next);
    }
    return {
      board: next,
      resultText: resultBody.includes("[") ? resultBody : withTodoListLead("", next.items),
      hostArgs: { ...args },
    };
  }

  return {
    board: next,
    resultText: withTodoListLead(resultBody, next.items),
    hostArgs: { action: "list" },
  };
}

function applyTodoWrite(board: TodoBoard, args: Record<string, unknown>): void {
  const todos = Array.isArray(args.todos) ? args.todos : [];
  const merge = args.merge === true;
  const incoming: TodoItem[] = [];
  for (const raw of todos) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const vendorId = stringArg(row.id) || String(board.nextId + incoming.length);
    const id = hostTodoIdOf(board, vendorId);
    const text = stringArg(row.content) || stringArg(row.text) || `Task #${id}`;
    const status = stringArg(row.status);
    const done = status === "completed" || status === "cancelled";
    incoming.push({ id, text, done });
  }
  if (!merge) {
    board.items = incoming;
    board.idMap = new Map(incoming.map((item) => [String(item.id), item.id]));
  } else {
    for (const item of incoming) upsertTodoItem(board, item);
  }
  bumpTodoNextId(board);
}

function stringArg(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

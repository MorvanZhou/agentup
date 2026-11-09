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
} from "../../host/todo-board.js";

/** CodeBuddy / Workbuddy：TaskCreate · TaskUpdate · TaskList · TaskGet → Host todo。 */
const TASK_TOOL_NAMES = new Set(["TaskCreate", "TaskUpdate", "TaskList", "TaskGet", TODO_TOOL]);

export const codebuddyTodoProjector: ExternalTodoProjector = {
  ownsTool(toolName) {
    return TASK_TOOL_NAMES.has(toolName.trim());
  },
  apply(board, toolName, args, rawResult) {
    return applyCodebuddyTodo(board, toolName.trim(), args, rawResult);
  },
};

function applyCodebuddyTodo(
  board: TodoBoard,
  name: string,
  args: Record<string, unknown>,
  rawResult: unknown,
): ExternalTodoApplyResult {
  const next = cloneTodoBoard(board);
  const resultBody = flattenToolResultText(rawResult);

  if (name === "TaskCreate") {
    const text =
      stringArg(args.subject) || stringArg(args.description) || extractCreatedSubject(resultBody);
    const vendorId = extractTaskNumber(resultBody) ?? String(next.nextId);
    const id = hostTodoIdOf(next, vendorId);
    upsertTodoItem(next, { id, text: text || `Task #${id}`, done: false });
    bumpTodoNextId(next);
    return {
      board: next,
      resultText: `Added todo #${id}: ${text || `Task #${id}`}\n${withTodoListLead("", next.items)}`,
      hostArgs: { action: "add", text: text || `Task #${id}` },
    };
  }

  if (name === "TaskUpdate") {
    const vendorId = stringArg(args.taskId) || extractTaskNumber(resultBody) || "";
    const id = vendorId ? hostTodoIdOf(next, vendorId) : undefined;
    const status = stringArg(args.status);
    const subject = stringArg(args.subject);
    if (id !== undefined) {
      if (status === "deleted") {
        next.items = next.items.filter((item) => item.id !== id);
      } else {
        const existing = next.items.find((item) => item.id === id);
        const text = subject || existing?.text || `Task #${id}`;
        const done = status === "completed";
        upsertTodoItem(next, {
          id,
          text,
          done: status ? done : (existing?.done ?? false),
        });
      }
    }
    bumpTodoNextId(next);
    const lead =
      status === "completed" && id !== undefined
        ? `Todo #${id} completed`
        : status === "deleted" && id !== undefined
          ? `Cleared todo #${id}`
          : resultBody.split("\n")[0] || "";
    return {
      board: next,
      resultText: withTodoListLead(lead, next.items),
      hostArgs:
        status === "completed" && id !== undefined
          ? { action: "toggle", id }
          : { action: "list" },
    };
  }

  if (name === "TaskList" || name === "TaskGet") {
    const parsed = parseHostTodoChecklist(resultBody);
    if (parsed.length > 0) {
      next.items = parsed;
      for (const item of parsed) next.idMap.set(String(item.id), item.id);
      bumpTodoNextId(next);
    }
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

function stringArg(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function extractTaskNumber(text: string): string | undefined {
  const match = /Task\s*#(\d+)/i.exec(text);
  return match?.[1];
}

function extractCreatedSubject(text: string): string {
  const match = /Task\s*#\d+\s+created successfully:\s*(.+)$/im.exec(text.trim());
  return match?.[1]?.trim() ?? "";
}

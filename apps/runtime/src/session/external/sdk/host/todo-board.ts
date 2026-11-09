import { formatTodoList, type TodoItem } from "../../../tools/todo.js";
import type {
  ExternalTodoApplyResult,
  ExternalTodoBoard,
  ExternalTodoProjector,
} from "../contract.js";

/**
 * Host 侧 Todo / PlanDock 抽象：看板状态与清单正文格式。
 * 厂商工具名与参数形状由各 `adapters/<driverId>/todo.ts` 的 ExternalTodoProjector 负责。
 */

export type TodoBoard = ExternalTodoBoard;
export type { ExternalTodoApplyResult, ExternalTodoProjector };

export function emptyTodoBoard(): TodoBoard {
  return { items: [], idMap: new Map(), nextId: 1 };
}

export function cloneTodoBoard(board: TodoBoard): TodoBoard {
  return {
    items: board.items.map((item) => ({ ...item })),
    idMap: new Map(board.idMap),
    nextId: board.nextId,
  };
}

/** 把厂商 tool result 收成纯文本（数组 content / 对象壳）。 */
export function flattenToolResultText(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    return raw
      .map((block) => {
        if (!block || typeof block !== "object") return "";
        const row = block as Record<string, unknown>;
        if (typeof row.text === "string") return row.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (raw && typeof raw === "object") {
    const row = raw as Record<string, unknown>;
    if (typeof row.text === "string") return row.text;
    if (typeof row.content === "string") return row.content;
    try {
      return JSON.stringify(raw);
    } catch {
      return String(raw);
    }
  }
  if (raw == null) return "";
  return String(raw);
}

export function hostTodoIdOf(board: TodoBoard, vendorId: string): number {
  const key = vendorId.trim();
  const mapped = board.idMap.get(key);
  if (mapped !== undefined) return mapped;
  const asNum = Number(key);
  const id = Number.isInteger(asNum) && asNum >= 1 ? asNum : board.nextId;
  board.idMap.set(key, id);
  return id;
}

export function upsertTodoItem(board: TodoBoard, item: TodoItem): void {
  const index = board.items.findIndex((row) => row.id === item.id);
  if (index >= 0) board.items[index] = item;
  else board.items.push(item);
  board.idMap.set(String(item.id), item.id);
}

export function bumpTodoNextId(board: TodoBoard): void {
  const max = board.items.reduce((high, item) => Math.max(high, item.id), 0);
  board.nextId = Math.max(board.nextId, max + 1);
}

const ITEM_LINE = /^\[( |x)\] #(\d+): (.*)$/;

export function parseHostTodoChecklist(text: string): TodoItem[] {
  const items: TodoItem[] = [];
  for (const raw of text.split("\n")) {
    const match = ITEM_LINE.exec(raw.trim());
    if (!match) continue;
    items.push({
      id: Number(match[2]),
      done: match[1] === "x",
      text: match[3] ?? "",
    });
  }
  return items;
}

/** 成功叙述 + Host 清单行；叙述本身已是清单时不重复。 */
export function withTodoListLead(lead: string, items: readonly TodoItem[]): string {
  const list = formatTodoList(items);
  const head = lead.trim();
  if (!head) return list;
  if (head.includes("[") && head.includes("#")) {
    return head.includes(list) ? head : `${head}\n${list}`;
  }
  if (list === "No todos") return head;
  return `${head}\n${list}`;
}

export { formatTodoList };
export type { TodoItem };

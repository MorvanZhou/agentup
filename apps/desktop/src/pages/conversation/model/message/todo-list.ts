import { tf } from "../../../../shared/model/ui-locale";

/** 从 todo 工具结果文本还原清单。行格式与 runtime `formatTodoList` 一致。 */

export type TodoListItem = {
  id: number;
  text: string;
  done: boolean;
};

const ITEM_LINE = /^\[( |x)\] #(\d+): (.*)$/;

export type TodoPartRef = {
  type: string;
  toolName?: string;
  result?: unknown;
};

export type TodoPlacement = {
  /** 唯一渲染的那张卡，停在第一次 todo 调用的位置。 */
  anchorIndex: number;
  /** 用来填这张卡的最新一份结果；进行中的调用还没结果时沿用上一份。 */
  sourceIndex: number;
};

/** 一条回复里的多次 todo 只保留一张卡，内容跟到最新结果。 */
export function todoPlacement(parts: readonly TodoPartRef[]): TodoPlacement | undefined {
  let anchorIndex = -1;
  let sourceIndex = -1;
  parts.forEach((part, index) => {
    if (!isTodoPart(part)) return;
    if (anchorIndex < 0) anchorIndex = index;
    if (part.result !== undefined) sourceIndex = index;
  });
  if (anchorIndex < 0) return undefined;
  return { anchorIndex, sourceIndex: sourceIndex < 0 ? anchorIndex : sourceIndex };
}

export function isTodoPart(part: TodoPartRef | undefined): boolean {
  return part?.type === "tool-call" && part.toolName === "todo";
}

export type TodoMessageRef = {
  role: string;
  id?: string;
  metadata?: unknown;
  status?: { type?: string };
  content?: readonly TodoPartRef[];
  parts?: readonly TodoPartRef[];
};

export type TodoPlan = {
  items: TodoListItem[];
  updating: boolean;
  error?: string;
};

/** 回复还在生成时不收起；结束后若全部完成，底部不再占位。 */
export function isPlanComplete(plan: TodoPlan, streaming = false): boolean {
  if (streaming || plan.updating) return false;
  return plan.items.length > 0 && plan.items.every((item) => item.done);
}

/** 完成后挂在助手消息下方的标题，如「3/3 项已完成」。 */
export function completedTodoTitle(plan: Pick<TodoPlan, "items">): string {
  const total = plan.items.length;
  const done = plan.items.filter((item) => item.done).length;
  return tf("todoDoneCount", { done, total });
}

/** 当前会话段里最近一条助手回复是否还在生成。 */
export function isSegmentStreaming(
  messages: readonly TodoMessageRef[],
  isReset: (message: TodoMessageRef) => boolean,
): boolean {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || isReset(message)) return false;
    if (message.role !== "assistant") continue;
    const type = message.status?.type;
    return type === "running" || type === "requires-action";
  }
  return false;
}

/** 清单内容变化后，手动隐藏失效，新的未完成计划会再出现。 */
export function todoPlanKey(plan: TodoPlan): string {
  return plan.items.map((item) => `${item.id}\0${item.done ? "1" : "0"}\0${item.text}`).join("\n");
}

/** 当前会话段里的 part：遇到「新对话」分隔就停，不再带上一段的计划。 */
export function currentTodoParts(
  messages: readonly TodoMessageRef[],
  isReset: (message: TodoMessageRef) => boolean,
): TodoPartRef[] {
  const chunks: TodoPartRef[][] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || isReset(message)) break;
    if (message.role !== "assistant") continue;
    const content = message.content ?? message.parts;
    if (content?.length) chunks.push([...content]);
  }
  chunks.reverse();
  return chunks.flat();
}

/** 从当前会话段抽出最新一份清单。清空后没有条目时不占界面。 */
export function planFromTodoParts(parts: readonly TodoPartRef[]): TodoPlan | undefined {
  const place = todoPlacement(parts);
  if (!place) return undefined;
  const source = parts[place.sourceIndex];
  const hasResult = source?.result !== undefined;
  const parsed =
    hasResult && typeof source?.result === "string"
      ? parseTodoToolResult(source.result)
      : { items: [] as TodoListItem[] };
  const updating =
    !hasResult || parts.some((part, index) => index > place.sourceIndex && isTodoPart(part));
  if (parsed.items.length === 0 && !updating) return undefined;
  return {
    items: parsed.items,
    updating,
    ...(parsed.error ? { error: parsed.error } : {}),
  };
}

export function parseTodoToolResult(result: string): { error?: string; items: TodoListItem[] } {
  const items: TodoListItem[] = [];
  let error: string | undefined;
  for (const raw of result.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("Error: ")) {
      error = line.slice("Error: ".length);
      continue;
    }
    const match = ITEM_LINE.exec(line);
    if (!match) continue;
    items.push({
      id: Number(match[2]),
      done: match[1] === "x",
      text: match[3] ?? "",
    });
  }
  return error ? { error, items } : { items };
}

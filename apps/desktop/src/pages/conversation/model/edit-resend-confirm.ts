import {
  diffEditHunks,
  parseEditHunks,
  splitContentLines,
  summarizeDiff,
} from "../components/agent-main/thread/assistant-ui/tools/tool-file-view";

export type EditResendPart = {
  type?: string;
  toolName?: string;
  args?: unknown;
};

export type EditResendMessage = {
  id: string;
  role: string;
  parts?: readonly EditResendPart[];
};

/** 编辑重发回滚时单个文件的路径与行变更（与 Write/Edit 卡片统计一致）。 */
export type RollbackFileImpact = {
  path: string;
  added: number;
  removed: number;
};

/**
 * 编辑该 user 消息重发时，其后 Write/Edit 触及的工作区路径与行数（同路径合并、保持首次出现顺序）。
 */
export function filesAffectedByEditResend(
  messages: readonly EditResendMessage[],
  editedMessageId: string,
): RollbackFileImpact[] {
  if (!editedMessageId) return [];
  const index = messages.findIndex((message) => message.id === editedMessageId);
  if (index < 0) return [];
  const order: string[] = [];
  const byPath = new Map<string, RollbackFileImpact>();
  for (let i = index + 1; i < messages.length; i += 1) {
    const message = messages[i];
    if (!message || message.role !== "assistant") continue;
    for (const part of message.parts ?? []) {
      if (part.type !== "tool-call") continue;
      if (part.toolName !== "write" && part.toolName !== "edit") continue;
      const filePath = pathFromToolArgs(part.args);
      if (!filePath) continue;
      const delta = lineDeltaFromTool(part.toolName, part.args);
      const existing = byPath.get(filePath);
      if (existing) {
        existing.added += delta.added;
        existing.removed += delta.removed;
        continue;
      }
      order.push(filePath);
      byPath.set(filePath, { path: filePath, added: delta.added, removed: delta.removed });
    }
  }
  return order.map((path) => byPath.get(path)!);
}

/**
 * 编辑该 user 消息重发时，其后是否出现过 Write/Edit（会触发工作区文件回滚）。
 */
export function wouldRollbackFilesOnEdit(
  messages: readonly EditResendMessage[],
  editedMessageId: string,
): boolean {
  if (!editedMessageId) return false;
  const index = messages.findIndex((message) => message.id === editedMessageId);
  if (index < 0) return false;
  for (let i = index + 1; i < messages.length; i += 1) {
    const message = messages[i];
    if (!message || message.role !== "assistant") continue;
    for (const part of message.parts ?? []) {
      if (part.type !== "tool-call") continue;
      if (part.toolName === "write" || part.toolName === "edit") return true;
    }
  }
  return false;
}

/** 弹窗列表用：过长路径只保留末两段。 */
export function displayRollbackPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/^\.?\//, "");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 2) return normalized || path;
  return parts.slice(-2).join("/");
}

function pathFromToolArgs(args: unknown): string | undefined {
  if (!args || typeof args !== "object" || Array.isArray(args)) return undefined;
  const record = args as Record<string, unknown>;
  for (const key of ["path", "file_path"] as const) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

/** 与 Write/Edit 工具卡片同一套行统计。 */
function lineDeltaFromTool(
  toolName: "write" | "edit" | string,
  args: unknown,
): { added: number; removed: number } {
  if (toolName === "write") {
    const content =
      args && typeof args === "object" && !Array.isArray(args)
        ? (args as { content?: unknown }).content
        : undefined;
    const text = typeof content === "string" ? content : "";
    return { added: splitContentLines(text).length, removed: 0 };
  }
  if (toolName === "edit") {
    return summarizeDiff(diffEditHunks(parseEditHunks(args)));
  }
  return { added: 0, removed: 0 };
}

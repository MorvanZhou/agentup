import type {
  ExtensionContext,
  ExtensionFactory,
  SessionBeforeTreeEvent,
  SessionEntry,
  ToolCallEvent,
} from "@earendil-works/pi-coding-agent";

import {
  checkpointRoot,
  restoreAbandonedTurns,
  snapshotBeforeMutation,
} from "./checkpoint.js";

/**
 * Cursor / Claude Code 风格文件检查点：
 * - Write/Edit 改文件前按「当前分支最新 user entry」备份；
 * - navigateTree（编辑消息重发）前还原被放弃 turn 改过的文件。
 *
 * 注意：`turn_start` 有时早于 user 写入分支，不能把那时的 entry id 缓存后优先使用，
 * 否则后续 turn 的快照会落进上一 turn 并被 already-snapped 跳过（Edit 后重发无法回滚）。
 */
export function createCheckpointExtension(visitRoot: string): ExtensionFactory {
  const checkpointsDir = checkpointRoot(visitRoot);

  return (pi) => {
    pi.on("tool_call", async (event: ToolCallEvent, ctx: ExtensionContext) => {
      if (event.toolName !== "write" && event.toolName !== "edit") return undefined;
      const filePath = toolPath(event);
      if (!filePath) return undefined;
      const turnId = latestUserEntryId(ctx) || "";
      snapshotBeforeMutation(ctx.cwd, checkpointsDir, turnId, filePath);
      return undefined;
    });

    pi.on("session_before_tree", async (event: SessionBeforeTreeEvent, ctx: ExtensionContext) => {
      const abandoned = abandonedUserEntryIds(
        event.preparation.targetId,
        event.preparation.entriesToSummarize,
        (id) => ctx.sessionManager.getEntry(id),
      );
      if (abandoned.length === 0) return undefined;
      restoreAbandonedTurns(ctx.cwd, checkpointsDir, abandoned);
      return undefined;
    });
  };
}

function latestUserEntryId(ctx: ExtensionContext): string | undefined {
  const branch = ctx.sessionManager.getBranch();
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (entry?.type === "message" && entry.message.role === "user") return entry.id;
  }
  return undefined;
}

function toolPath(event: ToolCallEvent): string | undefined {
  const input = "input" in event ? event.input : undefined;
  if (!input || typeof input !== "object") return undefined;
  const pathValue = (input as { path?: unknown }).path;
  return typeof pathValue === "string" && pathValue.trim() ? pathValue : undefined;
}

/**
 * 需要还原检查点的 user turn：
 * - 导航目标若是 user message，Pi 会把 leaf 设到其 parent，该 turn 本身被放弃；
 * - 另含 entriesToSummarize 中的后续 user turn（共同祖先之后到旧 leaf）。
 */
function abandonedUserEntryIds(
  targetId: string,
  entriesToSummarize: readonly SessionEntry[],
  getEntry: (id: string) => SessionEntry | undefined,
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const push = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  };
  const target = getEntry(targetId);
  if (target?.type === "message" && target.message.role === "user") push(target.id);
  for (const entry of entriesToSummarize) {
    if (entry.type === "message" && entry.message.role === "user") push(entry.id);
  }
  return ids;
}

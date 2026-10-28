import fs from "node:fs";

import { copyStagedArtifactsToParent } from "../../tools/deliver-artifacts.js";
import { ensureCwdLayout } from "../../workspace/cwd-layout.js";
import type { DelegationStore } from "../store.js";
import type { DelegationTask } from "../types.js";
import { isTerminalStatus } from "./helpers.js";
import { resolveAgentCwd } from "./visit.js";

/** sync 或 inbox：把已确认附件拷到父 ARTIFACT/from-<name>-<id>/，只保留一层。 */
export function deliverTaskArtifacts(
  store: DelegationStore,
  userDataRoot: string,
  task: DelegationTask,
  sourceCwd: string,
  parentCwd = resolveAgentCwd(userDataRoot, task.userId, task.fromAgentId),
): void {
  if (task.artifactsDelivered) return;
  if (task.artifacts === undefined) return;
  if (task.groupId) {
    store.update(task.id, { artifactsDelivered: true });
    return;
  }
  if (!parentCwd) return;
  if (!fs.existsSync(sourceCwd)) return;
  ensureCwdLayout(parentCwd);
  try {
    copyStagedArtifactsToParent({
      sourceCwd,
      parentCwd,
      toAgentId: task.toAgentId,
      toAgentName: task.toAgentName,
      staged: task.artifacts,
    });
    store.update(task.id, { artifactsDelivered: true });
  } catch {
    // 投递失败不阻断委托终态；下次父 turn 可再试
  }
}

/**
 * 父会话 agent_start：把尚未落盘的委托附件拷入 parentCwd。
 * 须在 createArtifactsExtension 快照之后调用。
 */
export function materializePendingArtifacts(
  store: DelegationStore,
  userDataRoot: string,
  userId: string,
  fromAgentId: string,
  parentCwd: string,
): void {
  const tasks = store.list(userId, { fromAgentId });
  for (const task of tasks) {
    if (!isTerminalStatus(task.status)) continue;
    if (task.artifactsDelivered) continue;
    if (task.artifacts === undefined) continue;
    const sourceCwd = resolveAgentCwd(userDataRoot, task.userId, task.toAgentId);
    if (!sourceCwd) continue;
    deliverTaskArtifacts(store, userDataRoot, task, sourceCwd, parentCwd);
  }
}

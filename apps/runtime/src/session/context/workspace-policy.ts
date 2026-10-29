import { groupDirPath } from "../group/workspace.js";
import { readProjectRoots } from "../workspace/project-roots.js";
import type { ExecutionMode } from "./mode.js";
import type { Visit } from "../../package/sync.js";
import { userDataRootFromVisit } from "./user-data-root.js";

/**
 * 工作区允许范围。群场景不挂成员个人 instance.json 的项目目录，
 * 改挂群级 `settings.json` 里的目录（群内所有成员共享）。
 */
export type WorkspacePolicy = {
  includePrivateCwd: boolean;
  includeProjectRoots: boolean;
  includeGroupProjectRoots: boolean;
  includeGroupWorkspace: boolean;
};

export const WORKSPACE_POLICY: Record<ExecutionMode, WorkspacePolicy> = {
  single: {
    includePrivateCwd: true,
    includeProjectRoots: true,
    includeGroupProjectRoots: false,
    includeGroupWorkspace: false,
  },
  "group-holder": {
    includePrivateCwd: true,
    includeProjectRoots: false,
    includeGroupProjectRoots: true,
    includeGroupWorkspace: true,
  },
  "single-delegation": {
    includePrivateCwd: true,
    includeProjectRoots: false,
    includeGroupProjectRoots: false,
    includeGroupWorkspace: false,
  },
  "group-delegation": {
    includePrivateCwd: true,
    includeProjectRoots: false,
    includeGroupProjectRoots: true,
    includeGroupWorkspace: true,
  },
};

/**
 * 按场景取会话可用的项目挂载：
 * 一对一读 visit 自己的 `instance.json`/`profile.json`；群读群 `settings.json`。
 * 群身份缺失时回落为空，避免误读成员个人挂载。每次调用现读盘，UI 挂载后无需重开会话。
 */
export function sessionProjectRoots(input: {
  policy: WorkspacePolicy;
  visit: Visit;
  groupId?: string;
}): string[] {
  if (input.policy.includeProjectRoots) {
    return readProjectRoots(input.visit.root, input.visit.kind === "personal" ? "personal" : "agent");
  }
  if (input.policy.includeGroupProjectRoots && input.groupId) {
    const userDataRoot = userDataRootFromVisit(input.visit);
    const groupDir = groupDirPath(userDataRoot, input.visit.userId, input.groupId);
    return readProjectRoots(groupDir, "group");
  }
  return [];
}

import type { ExecutionMode } from "./mode.js";

/** 工作区允许范围。群场景不挂个人项目目录。 */
export type WorkspacePolicy = {
  includePrivateCwd: boolean;
  includeProjectRoots: boolean;
  includeGroupWorkspace: boolean;
};

export const WORKSPACE_POLICY: Record<ExecutionMode, WorkspacePolicy> = {
  single: { includePrivateCwd: true, includeProjectRoots: true, includeGroupWorkspace: false },
  "group-holder": { includePrivateCwd: true, includeProjectRoots: false, includeGroupWorkspace: true },
  "single-delegation": { includePrivateCwd: true, includeProjectRoots: false, includeGroupWorkspace: false },
  "group-delegation": { includePrivateCwd: true, includeProjectRoots: false, includeGroupWorkspace: true },
};

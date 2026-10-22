import fs from "node:fs";
import path from "node:path";

import type { ToolCallEvent } from "@earendil-works/pi-coding-agent";

import {
  addProjectRoot,
  isInsideAnyRoot,
  proposeMountDirectory,
  ProjectRootsError,
  readProjectRoots,
  resolveAllowedRoots,
  validateCandidateRoot,
} from "../../workspace/project-roots.js";
import type { HitlExtensionContext, HitlOrigin } from "../origin.js";
import type { ApprovalBroker } from "./broker.js";
import type { MountGateResult, ProjectMountContext } from "./types.js";

/** 文件工具越界时：已在根内则放行；否则校验并 HITL / 自动挂载。 */
export async function handleProjectMountGate(
  broker: ApprovalBroker,
  userId: string,
  agentId: string,
  event: ToolCallEvent,
  cwd: string,
  projectMount: ProjectMountContext,
  origin: HitlOrigin,
  hitl: HitlExtensionContext,
  signal?: AbortSignal,
): Promise<MountGateResult> {
  const input = event.input as Record<string, unknown>;
  const rawPath = typeof input.path === "string" ? input.path : ".";
  const absolute = path.resolve(cwd, rawPath);
  const allowedRoots = resolveAllowedRoots(
    projectMount.cwd,
    readProjectRoots(projectMount.visitRoot, projectMount.kind),
  );
  let real = absolute;
  try {
    real = fs.realpathSync(absolute);
  } catch {
    // 文件尚不存在时用 resolve 路径判断
  }
  if (isInsideAnyRoot(real, allowedRoots)) return "continue";
  // 新建文件：父目录在根内也算合法
  try {
    const parentReal = fs.realpathSync(path.dirname(absolute));
    if (isInsideAnyRoot(parentReal, allowedRoots)) return "continue";
  } catch {
    // ignore
  }

  const proposed = proposeMountDirectory(absolute);
  if (!proposed) {
    return { block: true, reason: "路径超出允许范围，且无法提议可挂载目录" };
  }
  let mountPath: string;
  try {
    mountPath = validateCandidateRoot(projectMount.userDataRoot, proposed);
  } catch (error) {
    const message = error instanceof ProjectRootsError ? error.message : "不能挂载该目录";
    return { block: true, reason: message };
  }

  const args = {
    ...input,
    path: rawPath,
    project_mount: true,
    mount_path: mountPath,
    visit_root: projectMount.visitRoot,
    visit_kind: projectMount.kind,
  };

  if (broker.allowsPathMount(userId, agentId)) {
    try {
      addProjectRoot(projectMount.userDataRoot, projectMount.visitRoot, projectMount.kind, mountPath);
      return "continue";
    } catch (error) {
      const message = error instanceof ProjectRootsError ? error.message : "挂载项目目录失败";
      return { block: true, reason: message };
    }
  }

  const allowed = await broker.request(
    {
      userId,
      agentId,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      args,
      origin,
      ...(hitl.taskId ? { taskId: hitl.taskId } : {}),
      ...(hitl.parentAgentId ? { parentAgentId: hitl.parentAgentId } : {}),
    },
    signal,
  );
  if (allowed === undefined) return undefined;
  return allowed ? "continue" : { block: true, reason: "用户拒绝了这次工具调用" };
}

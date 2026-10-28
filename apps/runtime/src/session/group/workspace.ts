import fs from "node:fs";
import path from "node:path";

import { isInside } from "../workspace/project-roots.js";
import { ARTIFACT_DIR, ATTACHMENTS_DIR, WORK_DIR } from "../workspace/cwd-layout.js";
import { GroupError } from "./types.js";

const ID = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;

export type GroupWorkspace = {
  root: string;
  attachments: string;
  work: string;
  artifact: string;
};

export function groupWorkspaceRoot(userDataRoot: string, userId: string, groupId: string): string {
  if (!ID.test(groupId) || !userId || userId === "." || userId === ".." || /[/\\\0]/.test(userId)) {
    throw new Error("群不存在");
  }
  const groupsRoot = path.resolve(userDataRoot, "users", userId, ".runtime", "groups");
  const root = path.resolve(groupsRoot, groupId, "workspace");
  if (!isInside(groupsRoot, root)) throw new Error("群不存在");
  return root;
}

/**
 * 清空群共享目录里的成品。includeWork 为真时连同过程目录一起清。
 * 上传目录保留。目录若被换成链接，只拆掉链接，不跟着删到外面。
 */
export function clearGroupWorkspace(
  userDataRoot: string,
  userId: string,
  groupId: string,
  includeWork: boolean,
): void {
  const root = groupWorkspaceRoot(userDataRoot, userId, groupId);
  const indexFile = path.resolve(root, "..", "..", `${groupId}.json`);
  const groupsDir = path.dirname(indexFile);
  if (!isInside(groupsDir, indexFile) || indexFile === groupsDir || !fs.existsSync(indexFile)) {
    throw new GroupError("群不存在");
  }
  emptyInside(root, path.join(root, ARTIFACT_DIR));
  if (includeWork) emptyInside(root, path.join(root, WORK_DIR));
}

export function ensureGroupWorkspace(userDataRoot: string, userId: string, groupId: string): GroupWorkspace {
  const root = groupWorkspaceRoot(userDataRoot, userId, groupId);
  const attachments = path.join(root, ATTACHMENTS_DIR);
  const work = path.join(root, WORK_DIR);
  const artifact = path.join(root, ARTIFACT_DIR);
  fs.mkdirSync(attachments, { recursive: true });
  fs.mkdirSync(work, { recursive: true });
  fs.mkdirSync(artifact, { recursive: true });
  return { root, attachments, work, artifact };
}

export function groupWorkspacePrompt(workspace: GroupWorkspace): string {
  return [
    "# Group shared workspace",
    "",
    `This group shares one workspace at \`${workspace.root}\`. Handoffs and generated files go here, not in your private cwd.`,
    `- \`${workspace.attachments}/\`: user uploads for this group. Read only; never modify or delete them.`,
    `- \`${workspace.work}/\`: shared work in progress. Write drafts and intermediate files here so another member can continue them.`,
    `- \`${workspace.artifact}/\`: shared finished files for the group.`,
    "Prefer the shared WORK directory while iterating, then place finished outputs in the shared ARTIFACT directory.",
    "Use your private cwd only for scratch that must not be shared. Do not treat private ARTIFACT/ as the group handoff.",
  ].join("\n");
}

function emptyInside(workspaceRoot: string, dir: string): void {
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(dir);
  if (!isInside(root, target) || target === root) throw new GroupError("群不存在");
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(target);
  } catch {
    fs.mkdirSync(target, { recursive: true });
    return;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fs.unlinkSync(target);
    fs.mkdirSync(target);
    return;
  }
  for (const name of fs.readdirSync(target)) {
    const child = path.resolve(target, name);
    if (!isInside(target, child) || child === target) continue;
    let childStat: fs.Stats;
    try {
      childStat = fs.lstatSync(child);
    } catch {
      continue;
    }
    if (childStat.isSymbolicLink()) {
      fs.unlinkSync(child);
      continue;
    }
    fs.rmSync(child, { recursive: true, force: true });
  }
}

export function isGroupWorkspaceReadOnly(workspace: GroupWorkspace, absolutePath: string): boolean {
  const resolved = path.resolve(absolutePath);
  return isInside(workspace.attachments, resolved);
}

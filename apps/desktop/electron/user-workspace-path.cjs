/**
 * 打开 / 在文件管理器中显示：与 runtime 工作区布局对齐的本机路径门禁。
 * 渲染进程可传任意绝对路径，这里用 realpath + 布局根 isInside，不信相对串。
 */

const fsp = require("node:fs/promises");
const path = require("node:path");

/** @param {string} root @param {string} target */
function isInside(root, target) {
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  return target === root || target.startsWith(prefix);
}

/**
 * 约定工作区（与 runtime 一致）：
 * - users/<uid>/agents/<aid>/cwd
 * - users/<uid>/personal-assistant/cwd
 * - users/<uid>/.runtime/groups/<gid>/workspace
 * 先看是否落在 dataRoot 下，再锁定「工作区根」后用 isInside，避免 cwd-extra / workspace-x 前缀误放行。
 *
 * @param {string} dataRootReal
 * @param {string} targetReal
 */
function isUnderManagedWorkspace(dataRootReal, targetReal) {
  if (targetReal === dataRootReal) return false;
  const relative = path.relative(dataRootReal, targetReal);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return false;
  const parts = relative.split(path.sep).filter(Boolean);
  if (parts[0] !== "users" || parts.length < 3) return false;

  // users/<uid>/agents/<aid>/cwd[/...]
  if (parts[2] === "agents" && parts.length >= 5 && parts[4] === "cwd") {
    return isInside(path.join(dataRootReal, ...parts.slice(0, 5)), targetReal);
  }
  // users/<uid>/personal-assistant/cwd[/...]
  if (parts[2] === "personal-assistant" && parts.length >= 4 && parts[3] === "cwd") {
    return isInside(path.join(dataRootReal, ...parts.slice(0, 4)), targetReal);
  }
  // users/<uid>/.runtime/groups/<gid>/workspace[/...]（不含 holders 等运行态）
  if (
    parts[2] === ".runtime" &&
    parts[3] === "groups" &&
    parts[4] &&
    parts.length >= 6 &&
    parts[5] === "workspace"
  ) {
    return isInside(path.join(dataRootReal, ...parts.slice(0, 6)), targetReal);
  }
  return false;
}

/**
 * @param {string} dataRootReal
 * @param {string} targetReal
 * @param {{
 *   readdir?: typeof fsp.readdir,
 *   readFile?: typeof fsp.readFile,
 *   realpath?: typeof fsp.realpath,
 * }} [io]
 */
async function isUnderMountedProjectRoot(dataRootReal, targetReal, io = {}) {
  const readdir = io.readdir ?? fsp.readdir;
  const readFile = io.readFile ?? fsp.readFile;
  const realpath = io.realpath ?? fsp.realpath;
  const usersDir = path.join(dataRootReal, "users");
  let userNames;
  try {
    userNames = await readdir(usersDir);
  } catch {
    return false;
  }
  for (const userId of userNames) {
    if (userId === "." || userId === "..") continue;
    const personalProfile = path.join(usersDir, userId, "personal-assistant", "profile.json");
    if (await pathInsideAnyProjectRoot(personalProfile, targetReal, { readFile, realpath })) return true;
    const agentsDir = path.join(usersDir, userId, "agents");
    let agentIds;
    try {
      agentIds = await readdir(agentsDir);
    } catch {
      continue;
    }
    for (const agentId of agentIds) {
      const instancePath = path.join(agentsDir, agentId, "instance.json");
      if (await pathInsideAnyProjectRoot(instancePath, targetReal, { readFile, realpath })) return true;
    }
  }
  return false;
}

/**
 * @param {string} jsonPath
 * @param {string} targetReal
 * @param {{ readFile: typeof fsp.readFile, realpath: typeof fsp.realpath }} io
 */
async function pathInsideAnyProjectRoot(jsonPath, targetReal, io) {
  let raw;
  try {
    raw = await io.readFile(jsonPath, "utf8");
  } catch {
    return false;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!data || typeof data !== "object" || !Array.isArray(data.project_roots)) return false;
  for (const item of data.project_roots) {
    if (typeof item !== "string" || !item.trim()) continue;
    let rootReal;
    try {
      rootReal = await io.realpath(item);
    } catch {
      continue;
    }
    if (isInside(rootReal, targetReal)) return true;
  }
  return false;
}

/**
 * @param {string} targetPath
 * @param {string} dataRoot
 * @param {string} deniedMessage
 * @param {{ realpath?: typeof fsp.realpath, readdir?: typeof fsp.readdir, readFile?: typeof fsp.readFile }} [io]
 */
async function resolveUserWorkspacePath(targetPath, dataRoot, deniedMessage, io = {}) {
  if (typeof targetPath !== "string" || !targetPath.trim()) throw new Error("路径无效");
  if (typeof dataRoot !== "string" || !dataRoot.trim()) throw new Error("路径无效");
  const realpath = io.realpath ?? fsp.realpath;
  const root = await realpath(dataRoot);
  const target = await realpath(targetPath);
  if (isUnderManagedWorkspace(root, target)) return target;
  if (await isUnderMountedProjectRoot(root, target, io)) return target;
  throw new Error(deniedMessage);
}

module.exports = {
  isInside,
  isUnderManagedWorkspace,
  isUnderMountedProjectRoot,
  resolveUserWorkspacePath,
};

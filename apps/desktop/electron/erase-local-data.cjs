/**
 * 全清本机 AgentUp 数据：业务根（默认 ~/.agentup）+ Electron userData + 日志目录。
 * 不扫盘删用户挂载的外部项目。
 */

const os = require("node:os");
const path = require("node:path");

const DATA_ROOT_MARKER = "data-root.path";

/** @param {{ env?: NodeJS.ProcessEnv, homedir?: string }} [options] */
function resolveAgentDataRoot(options = {}) {
  const env = options.env ?? process.env;
  const homedir = options.homedir ?? os.homedir();
  const configured = typeof env.AGENTUP_USER_DATA_ROOT === "string" ? env.AGENTUP_USER_DATA_ROOT.trim() : "";
  if (configured) {
    return path.isAbsolute(configured) ? configured : path.resolve(homedir, configured);
  }
  return path.join(homedir, ".agentup");
}

/**
 * 收集待删路径；logs 若已在 userData 下则不重复。
 * @param {{ agentDataRoot: string, userDataPath: string, logsPath?: string }} input
 */
function collectErasePaths(input) {
  const roots = [];
  const add = (raw) => {
    if (typeof raw !== "string" || !raw.trim()) return;
    const resolved = path.resolve(raw.trim());
    if (roots.some((item) => item === resolved)) return;
    // 子路径已被父覆盖则跳过
    if (roots.some((item) => isInside(resolved, item))) return;
    // 新路径是已有项的父：去掉被覆盖的子项
    for (let i = roots.length - 1; i >= 0; i -= 1) {
      if (isInside(roots[i], resolved)) roots.splice(i, 1);
    }
    roots.push(resolved);
  };
  add(input.agentDataRoot);
  add(input.userDataPath);
  if (input.logsPath) add(input.logsPath);
  return roots;
}

/** @param {string} child @param {string} parent */
function isInside(child, parent) {
  if (child === parent) return true;
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/**
 * @param {{
 *   paths: string[],
 *   rm?: (target: string, opts: { recursive: boolean, force: boolean }) => Promise<void>,
 *   logInfo?: (msg: string) => void,
 *   logError?: (msg: string) => void,
 * }} input
 */
async function eraseLocalDataPaths(input) {
  const rm = input.rm ?? require("node:fs/promises").rm;
  const logInfo = input.logInfo ?? (() => {});
  const logError = input.logError ?? (() => {});
  for (const target of input.paths) {
    try {
      await rm(target, { recursive: true, force: true });
      logInfo(`erased ${target}`);
    } catch (error) {
      logError(`erase failed ${target}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
}

/** @param {string} userDataPath */
function dataRootMarkerPath(userDataPath) {
  return path.join(userDataPath, DATA_ROOT_MARKER);
}

/**
 * 供 Windows 卸载脚本读取真实业务根（含自定义 AGENTUP_USER_DATA_ROOT）。
 * @param {{ userDataPath: string, agentDataRoot: string, writeFile?: typeof import("node:fs/promises").writeFile, mkdir?: typeof import("node:fs/promises").mkdir }} input
 */
async function writeDataRootMarker(input) {
  const writeFile = input.writeFile ?? require("node:fs/promises").writeFile;
  const mkdir = input.mkdir ?? require("node:fs/promises").mkdir;
  await mkdir(input.userDataPath, { recursive: true });
  await writeFile(dataRootMarkerPath(input.userDataPath), input.agentDataRoot, "utf8");
}

module.exports = {
  DATA_ROOT_MARKER,
  resolveAgentDataRoot,
  collectErasePaths,
  eraseLocalDataPaths,
  dataRootMarkerPath,
  writeDataRootMarker,
};

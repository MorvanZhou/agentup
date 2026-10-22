/**
 * 打包后 resources/runtime 只带 node_modules.tgz；启动前解压成 node_modules。
 * - 优先解压到 runtime 目录（mac 拖到 /Applications 后通常可写；NSIS 安装期已解压则跳过）
 * - 若安装目录只读（如 Program Files 非提升），回落到 userData 镜像整棵 runtime
 */
const { spawnSync } = require("node:child_process");
const {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { ARCHIVE_NAME } = require("./pack-runtime-modules.cjs");

/**
 * @param {{
 *   runtimeRoot: string,
 *   userDataRoot: string,
 *   appVersion: string,
 *   logInfo?: (msg: string) => void,
 *   logError?: (msg: string) => void,
 * }} options
 * @returns {string} 实际应作为 runtime cwd / cli 根目录的路径
 */
function ensureRuntimeModules(options) {
  const { runtimeRoot, userDataRoot, appVersion, logInfo = () => {}, logError = () => {} } = options;
  const modulesDir = path.join(runtimeRoot, "node_modules");
  const archivePath = path.join(runtimeRoot, ARCHIVE_NAME);

  if (existsSync(modulesDir)) {
    return runtimeRoot;
  }
  if (!existsSync(archivePath)) {
    throw new Error(`runtime 缺少 node_modules 与 ${ARCHIVE_NAME}：${runtimeRoot}`);
  }

  logInfo(`解压 runtime ${ARCHIVE_NAME} → node_modules（首次启动或安装未展开）`);
  try {
    extractArchiveInPlace(archivePath, runtimeRoot);
    if (existsSync(modulesDir)) {
      tryRemoveArchive(archivePath, logInfo);
      return runtimeRoot;
    }
  } catch (error) {
    logError(
      `安装目录解压失败，回落 userData：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const destRoot = path.join(userDataRoot, "runtime-modules", appVersion);
  const destModules = path.join(destRoot, "node_modules");
  if (!existsSync(destModules)) {
    mkdirSync(destRoot, { recursive: true });
    cpSync(path.join(runtimeRoot, "package.json"), path.join(destRoot, "package.json"));
    cpSync(path.join(runtimeRoot, "dist"), path.join(destRoot, "dist"), { recursive: true });
    // 解压到临时目录再 rename，避免半成品
    const staging = mkdtempSync(path.join(os.tmpdir(), "agentup-runtime-nm-"));
    try {
      extractArchiveInPlace(archivePath, staging);
      const stagedModules = path.join(staging, "node_modules");
      if (!existsSync(stagedModules)) {
        throw new Error("归档内缺少 node_modules");
      }
      rmSync(destModules, { recursive: true, force: true });
      try {
        renameSync(stagedModules, destModules);
      } catch {
        // 跨盘符时 rename 会失败
        cpSync(stagedModules, destModules, { recursive: true });
      }
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }
  logInfo(`runtime 依赖已落到 ${destRoot}`);
  return destRoot;
}

/**
 * @param {string} archivePath
 * @param {string} cwd 解压后得到 cwd/node_modules
 */
function extractArchiveInPlace(archivePath, cwd) {
  mkdirSync(cwd, { recursive: true });
  // 先探探目录是否可写（Program Files 无提升会在此失败）
  const probe = path.join(cwd, `.agentup-write-probe-${process.pid}`);
  try {
    writeFileSync(probe, "ok");
    rmSync(probe, { force: true });
  } catch (error) {
    throw new Error(`目录不可写：${cwd}（${error instanceof Error ? error.message : error}）`);
  }

  const result = spawnSync(tarBinary(), ["-xzf", archivePath, "-C", cwd], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim() || `exit ${result.status}`;
    throw new Error(`tar 解压失败：${detail}`);
  }
}

/**
 * @returns {string}
 */
function tarBinary() {
  return process.platform === "win32" ? "tar.exe" : "tar";
}

/**
 * @param {string} archivePath
 * @param {(msg: string) => void} logInfo
 */
function tryRemoveArchive(archivePath, logInfo) {
  try {
    const bytes = statSync(archivePath).size;
    rmSync(archivePath, { force: true });
    logInfo(`已删除 ${ARCHIVE_NAME}（释放 ${(bytes / 1024 / 1024).toFixed(1)} MB）`);
  } catch {
    /* 只读介质上删不掉也无妨 */
  }
}

module.exports = {
  ensureRuntimeModules,
  extractArchiveInPlace,
  ARCHIVE_NAME,
};

if (require.main === module) {
  const runtimeRoot = process.argv[2];
  const userDataRoot = process.argv[3] || path.join(os.tmpdir(), "agentup-ud");
  if (!runtimeRoot) {
    console.error("usage: node ensure-runtime-modules.cjs <runtime_root> [user_data_root]");
    process.exit(2);
  }
  const root = ensureRuntimeModules({
    runtimeRoot,
    userDataRoot,
    appVersion: "dev",
    logInfo: console.log,
    logError: console.error,
  });
  console.log(`runtime root → ${root}`);
}

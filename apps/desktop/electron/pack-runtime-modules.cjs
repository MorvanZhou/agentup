/**
 * 把已 materialize 的 runtime/node_modules 打成单个 node_modules.tgz，再删掉松散树。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 打包注意事项（改这里之前请先读完）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 为何要打 tgz
 * - Desktop 的 app.asar 默认已打包；慢的是 resources/runtime/node_modules 松散树。
 * - runtime 用 ELECTRON_RUN_AS_NODE=1 跑，**不能**靠 asar / node_modules.asar
 *   （该模式下 Electron 不提供 asar 虚拟 FS；依赖必须是真实路径）。
 * - NSIS 对上万小文件逐条解压极慢；DMG/zip 拷贝上万小文件也慢。
 * - 打成单文件 node_modules.tgz 后，安装器只处理 1 个文件；展开用系统 tar。
 *
 * 【禁止】tar.create({ follow: true }) / dereference / 全量解开 symlink
 * - materialize 刻意保留「.pnpm 实体 + 顶层相对 symlink」，体积≈一份依赖。
 * - follow:true 会把同一包拷多份：node_modules.tgz ~110MB（正常 ~45MB），
 *   mac dmg 从 ~160MB 胀到 ~216MB+。已踩坑，勿再开。
 * - 正确：默认不 follow，把相对 symlink 写进归档（体积≈松散 materialize 树）。
 *
 * 平台展开
 * - Windows：installer.nsh 在 NSIS 安装期（提升权限）tar 展开，可建 symlink；
 *   失败则 ensure-runtime-modules 首次启动兜底。
 * - mac：无安装脚本，首次启动 ensure-runtime-modules 再展开；
 *   拖到 /Applications 后通常可写；只读则回落 userData。
 *
 * 体积回归信号：若 dmg 突然多出几十 MB，先查本文件是否被改成 follow/dereference。
 *
 * 相关：materialize-modules.cjs / after-pack.cjs / ensure-runtime-modules.cjs /
 *       installer.nsh / package.json → build.nsis
 */
const { existsSync, rmSync, statSync } = require("node:fs");
const path = require("node:path");

const ARCHIVE_NAME = "node_modules.tgz";

/**
 * @param {string} runtimeRoot 含 node_modules 的 runtime 目录
 * @param {{ tarRequireFrom?: string }} [options]
 * @returns {Promise<{ archivePath: string, archiveBytes: number }>}
 */
async function packRuntimeModules(runtimeRoot, options = {}) {
  const modulesDir = path.join(runtimeRoot, "node_modules");
  const archivePath = path.join(runtimeRoot, ARCHIVE_NAME);
  if (!existsSync(modulesDir)) {
    throw new Error(`packRuntimeModules: 缺少 ${modulesDir}`);
  }

  const tar = loadTar(options.tarRequireFrom ?? runtimeRoot);
  if (existsSync(archivePath)) rmSync(archivePath, { force: true });

  await tar.create(
    {
      gzip: true,
      file: archivePath,
      cwd: runtimeRoot,
      // 切勿加 follow:true / dereference——会解引用相对 symlink，dmg 暴涨（见文件头注释）
      portable: true,
    },
    ["node_modules"],
  );

  rmSync(modulesDir, { recursive: true, force: true });
  const archiveBytes = statSync(archivePath).size;
  return { archivePath, archiveBytes };
}

/**
 * @param {string} [fromRoot]
 */
function loadTar(fromRoot) {
  const paths = [];
  if (fromRoot) paths.push(fromRoot);
  paths.push(process.cwd());
  try {
    return require(require.resolve("tar", { paths }));
  } catch {
    try {
      return require("tar");
    } catch {
      throw new Error(`packRuntimeModules: 无法解析 tar 包（from=${fromRoot || "-"}）`);
    }
  }
}

module.exports = { packRuntimeModules, ARCHIVE_NAME, loadTar };

if (require.main === module) {
  const root = process.argv[2];
  if (!root) {
    console.error("usage: node pack-runtime-modules.cjs <runtime_root>");
    process.exit(2);
  }
  packRuntimeModules(root)
    .then(({ archivePath, archiveBytes }) => {
      console.log(`packed ${archivePath} (${(archiveBytes / 1024 / 1024).toFixed(1)} MB)`);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}

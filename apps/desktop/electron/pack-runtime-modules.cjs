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
 * 平台与 follow（相对 symlink）
 * - **mac（follow:false，默认）**：保留 .pnpm 相对 symlink，体积≈一份依赖；
 *   dmg 约 ~160MB。切勿在 mac 上开 follow——会胀到 ~216MB+（已踩坑）。
 * - **win（follow:true，必须）**：Windows bsdtar 创建 symlink 时要求目标已存在；
 *   归档里「顶层链接」常先于「.pnpm 实体」出现 → `Cannot create symlink ...
 *   No such file or directory`，安装/CI 解压会大面积失败。故 win 打包必须
 *   解引用成实体文件。setup 会更大，但 NSIS 仍只解压 1 个 tgz（安装仍快）。
 *
 * 体积回归信号
 * - mac dmg 突然多出几十 MB → 是否误对 darwin 开了 follow。
 * - win CI/安装出现大量 Cannot create symlink → 是否误对 win32 关了 follow。
 *
 * 相关：materialize-modules.cjs / after-pack.cjs / ensure-runtime-modules.cjs /
 *       installer.nsh / package.json → build.nsis
 */
const { existsSync, rmSync, statSync } = require("node:fs");
const path = require("node:path");

const ARCHIVE_NAME = "node_modules.tgz";

/**
 * @param {string} runtimeRoot 含 node_modules 的 runtime 目录
 * @param {{ tarRequireFrom?: string, follow?: boolean }} [options]
 *        follow：win32 必须 true；darwin 必须 false（见文件头）
 * @returns {Promise<{ archivePath: string, archiveBytes: number, follow: boolean }>}
 */
async function packRuntimeModules(runtimeRoot, options = {}) {
  const modulesDir = path.join(runtimeRoot, "node_modules");
  const archivePath = path.join(runtimeRoot, ARCHIVE_NAME);
  if (!existsSync(modulesDir)) {
    throw new Error(`packRuntimeModules: 缺少 ${modulesDir}`);
  }

  const follow = options.follow === true;
  const tar = loadTar(options.tarRequireFrom ?? runtimeRoot);
  if (existsSync(archivePath)) rmSync(archivePath, { force: true });

  await tar.create(
    {
      gzip: true,
      file: archivePath,
      cwd: runtimeRoot,
      // mac: false 保体积；win: true 才能被 bsdtar 解出（见文件头）
      follow,
      portable: true,
    },
    ["node_modules"],
  );

  rmSync(modulesDir, { recursive: true, force: true });
  const archiveBytes = statSync(archivePath).size;
  return { archivePath, archiveBytes, follow };
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
  const follow = process.argv.includes("--follow");
  if (!root) {
    console.error("usage: node pack-runtime-modules.cjs <runtime_root> [--follow]");
    process.exit(2);
  }
  packRuntimeModules(root, { follow })
    .then(({ archivePath, archiveBytes, follow: usedFollow }) => {
      console.log(
        `packed ${archivePath} (${(archiveBytes / 1024 / 1024).toFixed(1)} MB, follow=${usedFollow})`,
      );
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}

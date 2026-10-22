/**
 * 把已 materialize 的 runtime/node_modules 打成单个 node_modules.tgz，再删掉松散树。
 * NSIS / DMG 只拷一个文件，避免逐文件解压上万小文件。
 *
 * follow:true 解开相对 symlink，保证 Windows 无 SeCreateSymbolicLink 时也能解压。
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
      // 解开 symlink，避免安装/解压时依赖 Windows 创建符号链接权限
      follow: true,
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

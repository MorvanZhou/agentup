/**
 * 打包前裁剪 runtime 的 node_modules：只删确定用不到的文档 / sourcemap / 类型包。
 * 不删业务依赖；不删包内部名为 doc/test 的业务目录（例如 yaml/dist/doc）。
 *
 * @param {string} modulesRoot deploy 出的 node_modules 目录
 * @returns {{ removedFiles: number, removedDirs: number }}
 */
function pruneRuntimeModules(modulesRoot) {
  const fs = require("node:fs");
  const path = require("node:path");

  let removedFiles = 0;
  let removedDirs = 0;

  /** 任意深度都可删 */
  const dropDirAnywhere = new Set(["@types", ".github", "coverage"]);
  /** 仅当父目录是 npm 包根（含 package.json）时才删，避免误伤 yaml/dist/doc 等 */
  const dropDirAtPackageRoot = new Set([
    "docs",
    "doc",
    "example",
    "examples",
    "test",
    "tests",
    "__tests__",
    "powered-test",
  ]);

  /**
   * @param {string} filePath
   * @param {string} nameLower
   */
  function shouldDropFile(_filePath, nameLower) {
    if (nameLower.endsWith(".map") || nameLower.endsWith(".md") || nameLower === "tsconfig.json") {
      return true;
    }
    // 无扩展名的常见文档文件名（不匹配 changelog.js）
    return (
      nameLower === "readme" ||
      nameLower === "changelog" ||
      nameLower === "changes" ||
      nameLower === "history" ||
      nameLower === "authors" ||
      nameLower === "contributors"
    );
  }

  /**
   * @param {string} dir
   */
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const atPackageRoot = fs.existsSync(path.join(dir, "package.json"));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (dropDirAnywhere.has(entry.name) || (atPackageRoot && dropDirAtPackageRoot.has(entry.name))) {
          fs.rmSync(full, { recursive: true, force: true });
          removedDirs += 1;
          continue;
        }
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!shouldDropFile(full, entry.name.toLowerCase())) continue;
      try {
        fs.rmSync(full, { force: true });
        removedFiles += 1;
      } catch {
        /* ignore */
      }
    }
  }

  if (!fs.existsSync(modulesRoot)) {
    throw new Error(`pruneRuntimeModules: 目录不存在 ${modulesRoot}`);
  }
  walk(modulesRoot);
  return { removedFiles, removedDirs };
}

module.exports = { pruneRuntimeModules };

if (require.main === module) {
  const target = process.argv[2];
  if (!target) {
    console.error("usage: node prune-runtime-modules.cjs <node_modules_dir>");
    process.exit(2);
  }
  const result = pruneRuntimeModules(target);
  console.log(`pruned runtime modules: files=${result.removedFiles} dirs=${result.removedDirs}`);
}

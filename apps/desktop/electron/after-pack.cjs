const { cpSync, existsSync, lstatSync, readdirSync, readlinkSync } = require("node:fs");
const path = require("node:path");
const { pruneRuntimeModules } = require("./prune-runtime-modules.cjs");

/**
 * electron-builder 会按 .gitignore 跳过 node_modules；打包后再拷入已裁剪的 runtime 依赖。
 * mac:   <Product>.app/Contents/Resources/runtime
 * win:   resources/runtime
 *
 * pnpm deploy 的 node_modules 大量是指向本机构建目录的绝对 symlink；
 * 若不解引用拷贝，装到其他机器（或 CI 产物）上会全部断裂，runtime 立刻
 * ERR_MODULE_NOT_FOUND（如 @hono/node-server）→ UI 一直提示「本机 runtime 没有启动」。
 */
exports.default = async function afterPack(context) {
  const platform = context.electronPlatformName;
  const productName = context.packager.appInfo.productFilename;
  let runtimeRoot;
  if (platform === "darwin") {
    runtimeRoot = path.join(context.appOutDir, `${productName}.app`, "Contents", "Resources", "runtime");
  } else if (platform === "win32") {
    runtimeRoot = path.join(context.appOutDir, "resources", "runtime");
  } else {
    return;
  }

  const srcModules = path.join(__dirname, "..", "build", "runtime", "node_modules");
  const destModules = path.join(runtimeRoot, "node_modules");
  if (!existsSync(srcModules)) {
    throw new Error(`runtime node_modules 不存在：${srcModules}`);
  }
  if (!existsSync(runtimeRoot)) {
    throw new Error(`打包产物缺少 runtime：${runtimeRoot}`);
  }
  // build-mac / build-win 已预裁剪；此处再跑一遍，避免直接调 pack:* 时漏剪。
  pruneRuntimeModules(srcModules);
  cpSync(srcModules, destModules, { recursive: true, dereference: true });

  const broken = findBrokenSymlinks(destModules);
  if (broken.length > 0) {
    const sample = broken.slice(0, 5).join("\n  ");
    throw new Error(
      `runtime node_modules 仍有 ${broken.length} 个断裂 symlink（应已 dereference）。例如：\n  ${sample}`,
    );
  }
};

/** @param {string} root */
function findBrokenSymlinks(root) {
  /** @type {string[]} */
  const broken = [];
  /** @param {string} dir */
  function walk(dir) {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      const st = lstatSync(full);
      if (st.isSymbolicLink()) {
        try {
          const target = readlinkSync(full);
          const resolved = path.resolve(path.dirname(full), target);
          if (!existsSync(resolved)) broken.push(full);
        } catch {
          broken.push(full);
        }
      } else if (st.isDirectory()) {
        walk(full);
      }
    }
  }
  walk(root);
  return broken;
}

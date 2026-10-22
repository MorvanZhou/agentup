const { cpSync, existsSync } = require("node:fs");
const path = require("node:path");
const { pruneRuntimeModules } = require("./prune-runtime-modules.cjs");

/**
 * electron-builder 会按 .gitignore 跳过 node_modules；打包后再拷入已裁剪的 runtime 依赖。
 * mac:   <Product>.app/Contents/Resources/runtime
 * win:   resources/runtime
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
  cpSync(srcModules, destModules, { recursive: true });
};

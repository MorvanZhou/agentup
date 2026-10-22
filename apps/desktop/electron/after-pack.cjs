const { existsSync } = require("node:fs");
const path = require("node:path");
const { materializeModules } = require("./materialize-modules.cjs");
const { packRuntimeModules } = require("./pack-runtime-modules.cjs");
const { pruneRuntimeModules } = require("./prune-runtime-modules.cjs");

/**
 * electron-builder afterPack：把 runtime 依赖塞进安装包。
 *
 * 流水线（改顺序/步骤前请读 pack-runtime-modules.cjs 文件头「打包注意事项」）
 * 1. prune  — 去掉文档 / sourcemap / @types（build-mac/win 已预裁，此处再跑防漏）
 * 2. materialize — 绝对 symlink → 包内相对 symlink（体积≈一份 .pnpm）
 * 3. pack tgz — 打成 node_modules.tgz 并删松散树（加速 NSIS / DMG 拷贝）
 *
 * 为何不进 app.asar / 不写 extraResources 的 node_modules
 * - electron-builder 会按 .gitignore 跳过 node_modules，故在 afterPack 再拷。
 * - runtime 子进程 ELECTRON_RUN_AS_NODE=1，不能依赖 asar 虚拟文件系统。
 * - package.json extraResources 只放 dist + package.json；node_modules 由此处注入。
 *
 * 产物路径
 * - mac: <Product>.app/Contents/Resources/runtime/{dist,package.json,node_modules.tgz}
 * - win: resources/runtime/...（同上；NSIS customInstall 安装期展开 tgz）
 *
 * 【禁止】在 pack 步骤解引用 symlink（follow:true）——dmg 会从 ~160MB 胀到 220MB+。
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
  console.log("→ materialize runtime node_modules（解开绝对 symlink，保留相对链接）");
  materializeModules(srcModules, destModules);
  // 切勿在 packRuntimeModules 里开 follow——见 pack-runtime-modules.cjs 文件头
  console.log("→ pack runtime node_modules → node_modules.tgz（单文件，加速 NSIS/DMG）");
  const { archiveBytes } = await packRuntimeModules(runtimeRoot, {
    tarRequireFrom: path.join(__dirname, "..", "build", "runtime"),
  });
  console.log(`→ packed node_modules.tgz ${(archiveBytes / 1024 / 1024).toFixed(1)} MB`);
};

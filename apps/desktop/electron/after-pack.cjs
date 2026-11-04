const { cpSync, existsSync, rmSync } = require("node:fs");
const path = require("node:path");
const { materializeModules } = require("./materialize-modules.cjs");
const { packRuntimeModules } = require("./pack-runtime-modules.cjs");
const { pruneRuntimeModules } = require("./prune-runtime-modules.cjs");

/**
 * electron-builder afterPack：把 runtime 依赖 + 钉版 npm 塞进安装包。
 *
 * 流水线（改顺序/步骤前请读 pack-runtime-modules.cjs 文件头「打包注意事项」）
 * 1. prune  — 去掉文档 / sourcemap / @types（build-mac/win 已预裁，此处再跑防漏）
 * 2. materialize — 绝对 symlink → 包内相对 symlink（体积≈一份 .pnpm）
 * 3. pack tgz — 打成 node_modules.tgz 并删松散树（加速 NSIS / DMG 拷贝）
 * 4. copy npm — 钉版 npm 整树（含其 node_modules）拷进 Resources
 *
 * 为何不进 app.asar / 不写 extraResources 的 node_modules
 * - electron-builder 会按 .gitignore 跳过 node_modules，故在 afterPack 再拷。
 * - 曾把 npm 放 extraResources：只剩 cli 壳（~740KB），缺 graceful-fs → MODULE_NOT_FOUND。
 * - runtime 子进程 ELECTRON_RUN_AS_NODE=1，不能依赖 asar 虚拟文件系统。
 * - package.json extraResources：只放 runtime dist + package.json。
 *
 * 产物路径
 * - mac: <Product>.app/Contents/Resources/{runtime/..., npm/bin/npm-cli.js + node_modules}
 * - win: resources/{runtime/..., npm/...}（NSIS customInstall 安装期展开 runtime 的 tgz）
 *
 * follow 按平台分叉（详见 pack-runtime-modules.cjs）
 * - darwin：follow=false，保 dmg ~160MB
 * - win32：follow=true，否则 Windows tar 解压 symlink 会大面积失败
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

  // 钉版 npm：勿走 extraResources（会被 gitignore 剔掉 node_modules）
  const srcNpm = path.join(__dirname, "..", "build", "npm");
  const destNpm = path.join(path.dirname(runtimeRoot), "npm");
  const npmCli = path.join(srcNpm, "bin", "npm-cli.js");
  const npmGracefulFs = path.join(srcNpm, "node_modules", "graceful-fs", "package.json");
  if (!existsSync(npmCli) || !existsSync(npmGracefulFs)) {
    throw new Error(
      `bundled npm 不完整：${srcNpm}（先跑 prepare-bundled-npm.cjs；须含 node_modules/graceful-fs）`,
    );
  }
  console.log("→ copy bundled npm（含 node_modules，afterPack 绕过 gitignore）");
  rmSync(destNpm, { recursive: true, force: true });
  cpSync(srcNpm, destNpm, { recursive: true });
  if (!existsSync(path.join(destNpm, "node_modules", "graceful-fs", "package.json"))) {
    throw new Error(`打包产物 npm 缺少 node_modules：${destNpm}`);
  }

  // build-mac / build-win 已预裁剪；此处再跑一遍，避免直接调 pack:* 时漏剪。
  pruneRuntimeModules(srcModules);
  console.log("→ materialize runtime node_modules（解开绝对 symlink，保留相对链接）");
  materializeModules(srcModules, destModules);

  // win 必须 follow；mac 禁止 follow——见 pack-runtime-modules.cjs 文件头
  const follow = platform === "win32";
  console.log(
    `→ pack runtime node_modules → node_modules.tgz（follow=${follow}；加速 NSIS/DMG）`,
  );
  const { archiveBytes } = await packRuntimeModules(runtimeRoot, {
    tarRequireFrom: path.join(__dirname, "..", "build", "runtime"),
    follow,
  });
  console.log(`→ packed node_modules.tgz ${(archiveBytes / 1024 / 1024).toFixed(1)} MB`);
};

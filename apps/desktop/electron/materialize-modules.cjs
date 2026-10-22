/**
 * 把 pnpm deploy 出的 node_modules 改成可随安装包分发的形态：
 * - 保留 .pnpm 实体 + 顶层相对 symlink（体积≈本机 deploy，约一份依赖）
 * - 禁止残留指向构建机绝对路径的 symlink（否则装到别的机器 runtime 会挂）
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 体积红线（与 pack-runtime-modules.cjs 配套，勿单独改）
 * ═══════════════════════════════════════════════════════════════════════════
 * - 【禁止】fs.cpSync({ dereference: true })、tar follow:true、或其它全量解引用：
 *   同一包会被拷多份，mac dmg 从 ~160MB 膨胀到 220MB+（已踩坑）。
 * - Node 对「目录 symlink」的 dereference 拷贝本身也不可靠。
 * - 正确姿态：实体只在 .pnpm；顶层包名是相对 symlink；打 tgz 时同样保留链接。
 * - 下游：after-pack → packRuntimeModules（单文件加速 NSIS/DMG）→ 安装/首次启动展开。
 */
const {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
} = require("node:fs");
const path = require("node:path");

/**
 * @param {string} srcRoot
 * @param {string} destRoot
 */
function materializeModules(srcRoot, destRoot) {
  if (!existsSync(srcRoot)) {
    throw new Error(`source node_modules 不存在：${srcRoot}`);
  }
  const srcReal = realpathSync(srcRoot);
  rmSync(destRoot, { recursive: true, force: true });
  mkdirSync(destRoot, { recursive: true });

  // 1) 先拷实体文件 / 目录，跳过 symlink（.pnpm 里的真文件会进来）
  copyRealEntries(srcRoot, destRoot);

  // 2) 把 symlink 改写成 dest 树内的相对链接；偶发外链再实体拷贝
  recreateSymlinks(srcRoot, destRoot, srcReal, destRoot);

  const escaped = findEscapingSymlinks(destRoot);
  if (escaped.length > 0) {
    const sample = escaped.slice(0, 8).join("\n  ");
    throw new Error(
      `materialize 后仍有 ${escaped.length} 个指向包外的 symlink。例如：\n  ${sample}`,
    );
  }
}

/**
 * @param {string} srcDir
 * @param {string} destDir
 */
function copyRealEntries(srcDir, destDir) {
  mkdirSync(destDir, { recursive: true });
  for (const name of readdirSync(srcDir)) {
    const srcPath = path.join(srcDir, name);
    const destPath = path.join(destDir, name);
    const st = lstatSync(srcPath);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      copyRealEntries(srcPath, destPath);
    } else {
      cpSync(srcPath, destPath);
    }
  }
}

/**
 * @param {string} srcDir
 * @param {string} destDir
 * @param {string} srcRootReal
 * @param {string} destRoot
 */
function recreateSymlinks(srcDir, destDir, srcRootReal, destRoot) {
  for (const name of readdirSync(srcDir)) {
    const srcPath = path.join(srcDir, name);
    const destPath = path.join(destDir, name);
    const st = lstatSync(srcPath);
    if (st.isSymbolicLink()) {
      const real = realpathSync(srcPath);
      if (isInside(srcRootReal, real)) {
        const destTarget = path.join(destRoot, path.relative(srcRootReal, real));
        if (!existsSync(destTarget)) {
          throw new Error(`symlink 目标未拷入：${srcPath} → ${real}（期望 ${destTarget}）`);
        }
        mkdirSync(path.dirname(destPath), { recursive: true });
        if (existsSync(destPath)) rmSync(destPath, { recursive: true, force: true });
        const rel = path.relative(path.dirname(destPath), destTarget);
        // Windows 上目录链接用 'junction' 需绝对路径；'dir'/'file' 相对路径在 GHA 可用
        const linkType = statSync(real).isDirectory() ? "dir" : "file";
        symlinkSync(rel, destPath, linkType);
      } else if (statSync(real).isDirectory()) {
        mkdirSync(destPath, { recursive: true });
        copyRealEntries(real, destPath);
      } else {
        mkdirSync(path.dirname(destPath), { recursive: true });
        cpSync(real, destPath);
      }
      continue;
    }
    if (st.isDirectory()) {
      recreateSymlinks(srcPath, destPath, srcRootReal, destRoot);
    }
  }
}

/**
 * @param {string} root
 * @param {string} candidate
 */
function isInside(root, candidate) {
  if (candidate === root) return true;
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return candidate.startsWith(prefix);
}

/**
 * 允许的 symlink：相对路径且解析后仍在 root 内。
 * @param {string} root
 * @returns {string[]}
 */
function findEscapingSymlinks(root) {
  const rootReal = realpathSync(root);
  /** @type {string[]} */
  const bad = [];
  /** @param {string} dir */
  function walk(dir) {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      const st = lstatSync(full);
      if (st.isSymbolicLink()) {
        const target = readlinkSync(full);
        if (path.isAbsolute(target)) {
          bad.push(`${full} -> ${target}`);
          continue;
        }
        let resolved;
        try {
          resolved = realpathSync(full);
        } catch {
          bad.push(`${full} -> ${target} (dangling)`);
          continue;
        }
        if (!isInside(rootReal, resolved)) {
          bad.push(`${full} -> ${target}`);
        }
      } else if (st.isDirectory()) {
        walk(full);
      }
    }
  }
  walk(root);
  return bad;
}

module.exports = { materializeModules, findEscapingSymlinks };

if (require.main === module) {
  const src = process.argv[2];
  const dest = process.argv[3];
  if (!src || !dest) {
    console.error("usage: node materialize-modules.cjs <src_node_modules> <dest_node_modules>");
    process.exit(1);
  }
  materializeModules(src, dest);
  console.log(`materialized ${src} → ${dest}`);
}

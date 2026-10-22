/**
 * 把 pnpm deploy 出的 node_modules 解成「无外逃 symlink」的实体树。
 * Node fs.cpSync({ dereference: true }) 对目录 symlink 仍会保留链接，不可靠。
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
  rmSync(destRoot, { recursive: true, force: true });
  mkdirSync(destRoot, { recursive: true });
  const seen = new Set();
  copyTree(srcRoot, destRoot, seen);

  const escaped = findEscapingSymlinks(destRoot);
  if (escaped.length > 0) {
    const sample = escaped.slice(0, 8).join("\n  ");
    throw new Error(
      `materialize 后仍有 ${escaped.length} 个指向包外的 symlink（打包必挂）。例如：\n  ${sample}`,
    );
  }
}

/**
 * @param {string} src
 * @param {string} dest
 * @param {Set<string>} seen
 */
function copyTree(src, dest, seen) {
  const st = lstatSync(src);
  if (st.isSymbolicLink()) {
    const real = realpathSync(src);
    // 同一真实目录被多处 link 时只展开一次内容，其余做成相对 symlink（仍在 dest 树内）
    if (statSync(real).isDirectory()) {
      if (seen.has(real)) {
        // 已展开过：直接再走一遍实体拷贝（体积换可移植；避免相对 symlink 算错）
        copyDirContents(real, dest, seen);
        return;
      }
      seen.add(real);
      mkdirSync(dest, { recursive: true });
      copyDirContents(real, dest, seen);
      return;
    }
    mkdirSync(path.dirname(dest), { recursive: true });
    cpSync(real, dest);
    return;
  }
  if (st.isDirectory()) {
    mkdirSync(dest, { recursive: true });
    copyDirContents(src, dest, seen);
    return;
  }
  mkdirSync(path.dirname(dest), { recursive: true });
  cpSync(src, dest);
}

/**
 * @param {string} srcDir
 * @param {string} destDir
 * @param {Set<string>} seen
 */
function copyDirContents(srcDir, destDir, seen) {
  for (const name of readdirSync(srcDir)) {
    copyTree(path.join(srcDir, name), path.join(destDir, name), seen);
  }
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
        const resolved = path.resolve(path.dirname(full), target);
        if (!resolved.startsWith(rootReal + path.sep) && resolved !== rootReal) {
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

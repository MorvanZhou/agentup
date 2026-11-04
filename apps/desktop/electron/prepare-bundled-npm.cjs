#!/usr/bin/env node
/**
 * 把钉版 npm 解到 apps/desktop/build/npm，供 afterPack 整树拷进 Resources/npm。
 *
 * 为何自带：打包 Electron 旁没有官方 Node 的 lib/node_modules/npm；无系统 Node 时
 * SDK 接入（npm install）会失败。npm 为纯 JS，mac/win 共用一份。
 *
 * 勿用 extraResources 拷 npm：electron-builder 会按 .gitignore 丢掉其 node_modules，
 * 装出来只剩 cli 壳 → `Cannot find module 'graceful-fs'`。须 afterPack cpSync。
 *
 * 体积：tarball ~3MB；解压后裁掉 man/docs ≈15MB（落盘进 Resources）。
 */
const { createHash } = require("node:crypto");
const {
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const { loadTar } = require("./pack-runtime-modules.cjs");

/** 与 Electron 38 / Node 22 兼容；升级时同步改 INTEGRITY */
const NPM_VERSION = "10.9.2";
const NPM_TARBALL = `https://registry.npmjs.org/npm/-/npm-${NPM_VERSION}.tgz`;
const NPM_INTEGRITY =
  "sha512-iriPEPIkoMYUy3F6f3wwSZAU93E0Eg6cHwIR6jzzOXWSy+SD/rOODEs74cVONHKSx2obXtuUoyidVEhISrisgQ==";

const desktopRoot = path.join(__dirname, "..");
const destRoot = path.join(desktopRoot, "build", "npm");
const stampPath = path.join(destRoot, ".agentup-npm-version");

function integrityOk(filePath, integrity) {
  const [algo, expectedB64] = integrity.split("-");
  if (algo !== "sha512" || !expectedB64) return false;
  const digest = createHash("sha512").update(readFileSync(filePath)).digest("base64");
  return digest === expectedB64;
}

function alreadyPrepared() {
  if (!existsSync(path.join(destRoot, "bin", "npm-cli.js"))) return false;
  if (!existsSync(stampPath)) return false;
  return readFileSync(stampPath, "utf8").trim() === NPM_VERSION;
}

async function downloadTarball(url, destFile) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`下载 npm 失败: HTTP ${res.status} ${url}`);
  }
  await pipeline(res.body, createWriteStream(destFile));
}

/**
 * 用 Node `tar` 解压，勿 spawn 系统 tar：
 * Windows CI 上 PATH 常先命中 Git MSYS 的 GNU tar，会把 `C:\...` 当成
 * `host:path` →「Cannot connect to C: resolve failed」。
 */
async function extractTarball(tgzPath, extractDir) {
  mkdirSync(extractDir, { recursive: true });
  const tar = loadTar(path.join(__dirname, ".."));
  await tar.x({ file: tgzPath, cwd: extractDir });
}

/** 同盘 rename；跨盘（Win CI：Temp 在 C:、仓库在 D:）回落 copy+rm，避免 EXDEV。 */
function moveDir(from, to) {
  try {
    renameSync(from, to);
  } catch (error) {
    if (!error || error.code !== "EXDEV") throw error;
    cpSync(from, to, { recursive: true });
    rmSync(from, { recursive: true, force: true });
  }
}

function prepareFromExtract(packageDir) {
  // 安装器只需 cli + lib；裁掉文档省 ~2.5MB
  for (const name of ["man", "docs"]) {
    const p = path.join(packageDir, name);
    if (existsSync(p)) rmSync(p, { recursive: true, force: true });
  }
  const cli = path.join(packageDir, "bin", "npm-cli.js");
  if (!existsSync(cli)) {
    throw new Error(`npm 包缺少 bin/npm-cli.js：${packageDir}`);
  }
  rmSync(destRoot, { recursive: true, force: true });
  mkdirSync(path.dirname(destRoot), { recursive: true });
  moveDir(packageDir, destRoot);
  writeFileSync(stampPath, `${NPM_VERSION}\n`);
}

async function main() {
  if (alreadyPrepared()) {
    console.log(`→ bundled npm ${NPM_VERSION} 已就绪：${destRoot}`);
    return;
  }

  // 工作目录放在 build/ 下，与 destRoot 同盘，避免 Win runner Temp(C:)→仓库(D:) 的 EXDEV
  const work = path.join(desktopRoot, "build", `.tmp-npm-${NPM_VERSION}-${process.pid}`);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const tgz = path.join(work, `npm-${NPM_VERSION}.tgz`);
  const extractDir = path.join(work, "extract");

  try {
    console.log(`→ 下载 npm@${NPM_VERSION}`);
    await downloadTarball(NPM_TARBALL, tgz);
    if (!integrityOk(tgz, NPM_INTEGRITY)) {
      throw new Error(`npm@${NPM_VERSION} 完整性校验失败（sha512）`);
    }
    console.log(`→ 解压到 ${destRoot}`);
    await extractTarball(tgz, extractDir);
    const packageDir = path.join(extractDir, "package");
    if (!existsSync(packageDir)) {
      throw new Error(`npm tarball 布局异常，缺少 package/：${extractDir}`);
    }
    prepareFromExtract(packageDir);
    console.log(`→ bundled npm ${NPM_VERSION} 就绪（afterPack → Resources/npm）`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

module.exports = { NPM_VERSION, destRoot, main, alreadyPrepared };

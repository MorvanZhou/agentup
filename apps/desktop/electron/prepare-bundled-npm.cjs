#!/usr/bin/env node
/**
 * 把钉版 npm 解到 apps/desktop/build/npm，供 electron-builder extraResources 打进安装包。
 *
 * 为何自带：打包 Electron 旁没有官方 Node 的 lib/node_modules/npm；无系统 Node 时
 * SDK 接入（npm install）会失败。npm 为纯 JS，mac/win 共用一份。
 *
 * 体积：tarball ~3MB；解压后裁掉 man/docs ≈15MB（落盘进 Resources）。
 */
const { createHash } = require("node:crypto");
const { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } =
  require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const { execFileSync } = require("node:child_process");

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

function extractTarball(tgzPath, extractDir) {
  mkdirSync(extractDir, { recursive: true });
  // mac/linux 有 tar；Windows 打包机用 tar.exe（Win10+）
  execFileSync("tar", ["-xzf", tgzPath, "-C", extractDir], { stdio: "inherit" });
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
  renameSync(packageDir, destRoot);
  writeFileSync(stampPath, `${NPM_VERSION}\n`);
}

async function main() {
  if (alreadyPrepared()) {
    console.log(`→ bundled npm ${NPM_VERSION} 已就绪：${destRoot}`);
    return;
  }

  const work = path.join(
    tmpdir(),
    `agentup-npm-${NPM_VERSION}-${process.pid}`,
  );
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
    extractTarball(tgz, extractDir);
    const packageDir = path.join(extractDir, "package");
    if (!existsSync(packageDir)) {
      throw new Error(`npm tarball 布局异常，缺少 package/：${extractDir}`);
    }
    prepareFromExtract(packageDir);
    console.log(`→ bundled npm ${NPM_VERSION} 就绪（extraResources → Resources/npm）`);
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

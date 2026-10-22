#!/usr/bin/env node
/**
 * mac arm64 打包。
 *
 * 不直接用 node_modules/electron/dist：pnpm 安装解压时经常把 .framework 里的
 * symlink 解成实体文件（Electron Framework / Versions/Current 各一份），体积约 3×。
 * 改为从官方 zip 用系统 unzip 解到临时目录（保留 symlink），再交给 electron-builder；
 * 同时清掉易导致 HTTPS EPROTO 的 HTTP(S)_PROXY。
 *
 * CI（GitHub Actions）上常见没有本机 Electron zip 缓存；此时必须自行下载 zip，
 * 不能回退给 electron-builder 默认路径，否则会打出 ~600MB+ 的膨胀包。
 */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { pipeline } = require("node:stream/promises");
const { createWriteStream } = require("node:fs");

function unsetProxies(env) {
  for (const key of Object.keys(env)) {
    if (/^(https?|all|git_https?)_proxy$/i.test(key)) {
      delete env[key];
    }
  }
  return env;
}

function electronCacheRoots() {
  const roots = [];
  if (process.env.ELECTRON_CACHE) roots.push(process.env.ELECTRON_CACHE);
  roots.push(path.join(os.homedir(), "Library", "Caches", "electron"));
  roots.push(path.join(os.homedir(), ".cache", "electron"));
  return roots;
}

function findElectronZip(version) {
  const name = `electron-v${version}-darwin-arm64.zip`;
  for (const cacheRoot of electronCacheRoots()) {
    const direct = path.join(cacheRoot, name);
    if (fs.existsSync(direct)) return direct;
    if (!fs.existsSync(cacheRoot)) continue;
    for (const entry of fs.readdirSync(cacheRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(cacheRoot, entry.name, name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

async function downloadElectronZip(version, destPath) {
  const mirror = (process.env.ELECTRON_MIRROR || "https://github.com/electron/electron/releases/download/").replace(
    /\/?$/,
    "/",
  );
  const url = `${mirror}v${version}/electron-v${version}-darwin-arm64.zip`;
  console.log(`→ 下载 Electron zip: ${url}`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`下载 Electron zip 失败: HTTP ${res.status} ${url}`);
  }
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const tmp = `${destPath}.partial`;
  await pipeline(res.body, createWriteStream(tmp));
  fs.renameSync(tmp, destPath);
  return destPath;
}

function extractElectronDist(zipPath) {
  const dest = path.join(
    os.tmpdir(),
    `agentup-electron-dist-${crypto.randomBytes(6).toString("hex")}`,
  );
  fs.mkdirSync(dest, { recursive: true });
  const unzip = spawnSync("unzip", ["-q", zipPath, "-d", dest], { stdio: "inherit" });
  if (unzip.status !== 0) {
    fs.rmSync(dest, { recursive: true, force: true });
    throw new Error(`unzip Electron zip 失败: ${zipPath}`);
  }
  const frameworkLink = path.join(
    dest,
    "Electron.app/Contents/Frameworks/Electron Framework.framework/Versions/Current",
  );
  if (!fs.lstatSync(frameworkLink).isSymbolicLink()) {
    fs.rmSync(dest, { recursive: true, force: true });
    throw new Error("解压后 Electron Framework symlink 丢失，拒绝用膨胀拷贝打包");
  }
  return dest;
}

async function main() {
  const electronPkg = path.dirname(require.resolve("electron/package.json"));
  const version = require(path.join(electronPkg, "package.json")).version;

  let zipPath = findElectronZip(version);
  let downloadedZip = null;
  if (!zipPath) {
    downloadedZip = path.join(
      os.tmpdir(),
      `agentup-electron-v${version}-darwin-arm64.zip`,
    );
    zipPath = await downloadElectronZip(version, downloadedZip);
  } else {
    console.log(`→ 使用缓存 Electron zip（保留 symlink）: ${zipPath}`);
  }

  const env = unsetProxies({ ...process.env });
  const cli = require.resolve("electron-builder/cli.js");
  const args = ["--mac", "--arm64"];

  let tempDist = null;
  try {
    tempDist = extractElectronDist(zipPath);
    args.push(`-c.electronDist=${tempDist}`);

    const result = spawnSync(process.execPath, [cli, ...args], {
      stdio: "inherit",
      env,
    });
    process.exit(result.status ?? 1);
  } finally {
    if (tempDist) {
      fs.rmSync(tempDist, { recursive: true, force: true });
    }
    if (downloadedZip) {
      fs.rmSync(downloadedZip, { force: true });
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

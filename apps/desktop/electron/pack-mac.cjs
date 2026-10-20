#!/usr/bin/env node
/**
 * mac arm64 打包。
 *
 * 不直接用 node_modules/electron/dist：pnpm 安装解压时经常把 .framework 里的
 * symlink 解成实体文件（Electron Framework / Versions/Current 各一份），体积约 3×。
 * 改为从 Electron 官方 zip 缓存用系统 unzip 解到临时目录（保留 symlink），再交给
 * electron-builder；同时清掉易导致 HTTPS EPROTO 的 HTTP(S)_PROXY。
 */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

function unsetProxies(env) {
  for (const key of Object.keys(env)) {
    if (/^(https?|all|git_https?)_proxy$/i.test(key)) {
      delete env[key];
    }
  }
  return env;
}

function findElectronZip(version) {
  const cacheRoot = path.join(os.homedir(), "Library", "Caches", "electron");
  const name = `electron-v${version}-darwin-arm64.zip`;
  const direct = path.join(cacheRoot, name);
  if (fs.existsSync(direct)) return direct;
  if (!fs.existsSync(cacheRoot)) return null;
  for (const entry of fs.readdirSync(cacheRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(cacheRoot, entry.name, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
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

const electronPkg = path.dirname(require.resolve("electron/package.json"));
const version = require(path.join(electronPkg, "package.json")).version;
const zipPath = findElectronZip(version);

const env = unsetProxies({ ...process.env });
const cli = require.resolve("electron-builder/cli.js");
const args = ["--mac", "--arm64"];

let tempDist = null;
try {
  if (zipPath) {
    console.log(`→ 使用缓存 Electron zip（保留 symlink）: ${zipPath}`);
    tempDist = extractElectronDist(zipPath);
    args.push(`-c.electronDist=${tempDist}`);
  } else {
    console.log(
      `→ 未找到 electron-v${version}-darwin-arm64.zip 缓存，交由 electron-builder 下载解压`,
    );
  }

  const result = spawnSync(process.execPath, [cli, ...args], {
    stdio: "inherit",
    env,
  });
  process.exit(result.status ?? 1);
} finally {
  if (tempDist) {
    fs.rmSync(tempDist, { recursive: true, force: true });
  }
}

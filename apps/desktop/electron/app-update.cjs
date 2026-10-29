/**
 * Desktop 应用更新：解析 electron-updater 风格 yml、比版本、拼 feed / 下载 URL。
 * 当前阶段只做检测 + 打开安装包下载；接入公证后同一 feed 可交给 electron-updater。
 */

/**
 * @param {string} text
 * @returns {{
 *   version: string,
 *   files: Array<{ url: string, sha512: string, size?: number }>,
 *   path: string,
 *   sha512: string,
 * }}
 */
function parseUpdateYml(text) {
  const raw = String(text || "");
  const versionMatch = /^version:\s*(.+)\s*$/m.exec(raw);
  const version = versionMatch ? versionMatch[1].trim().replace(/^['"]|['"]$/g, "") : "";
  if (!version) {
    throw new Error("app-update: yml 缺少 version");
  }

  /** @type {Array<{ url: string, sha512: string, size?: number }>} */
  const files = [];
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const urlMatch = /^\s*-\s*url:\s*(.+)\s*$/.exec(lines[i] || "");
    if (!urlMatch) continue;
    const url = urlMatch[1].trim().replace(/^['"]|['"]$/g, "");
    let sha512 = "";
    /** @type {number | undefined} */
    let size;
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j] || "";
      if (/^\s*-\s*url:/.test(line) || /^[a-zA-Z]/.test(line)) break;
      const shaMatch = /^\s*sha512:\s*(.+)\s*$/.exec(line);
      if (shaMatch) {
        sha512 = shaMatch[1].trim().replace(/^['"]|['"]$/g, "");
        continue;
      }
      const sizeMatch = /^\s*size:\s*(\d+)\s*$/.exec(line);
      if (sizeMatch) {
        size = Number(sizeMatch[1]);
      }
    }
    if (!url || !sha512) {
      throw new Error("app-update: files 项缺少 url 或 sha512");
    }
    files.push(size === undefined ? { url, sha512 } : { url, sha512, size });
  }
  if (files.length === 0) {
    throw new Error("app-update: yml 缺少 files");
  }

  const pathMatch = /^path:\s*(.+)\s*$/m.exec(raw);
  const shaMatch = /^sha512:\s*(.+)\s*$/m.exec(raw);
  const pathValue = pathMatch
    ? pathMatch[1].trim().replace(/^['"]|['"]$/g, "")
    : files[0].url;
  const shaValue = shaMatch
    ? shaMatch[1].trim().replace(/^['"]|['"]$/g, "")
    : files[0].sha512;

  return {
    version,
    files,
    path: pathValue,
    sha512: shaValue,
  };
}

/**
 * @param {string} version
 * @returns {number[]}
 */
function versionParts(version) {
  const core = String(version || "")
    .trim()
    .split(/[+-]/)[0]
    .replace(/^v/i, "");
  if (!core) return [0];
  return core.split(".").map((part) => {
    const n = Number.parseInt(part, 10);
    return Number.isFinite(n) ? n : 0;
  });
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function compareVersions(a, b) {
  const left = versionParts(a);
  const right = versionParts(b);
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i++) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * @param {string} remote
 * @param {string} current
 */
function isNewerVersion(remote, current) {
  return compareVersions(remote, current) > 0;
}

/**
 * @param {string} downloadsBase
 */
function normalizeDownloadsBase(downloadsBase) {
  return String(downloadsBase || "")
    .trim()
    .replace(/\/+$/, "");
}

/**
 * @param {string} downloadsBase
 * @param {string} platform
 */
function resolveUpdateFeedUrl(downloadsBase, platform) {
  const base = normalizeDownloadsBase(downloadsBase);
  if (!base) throw new Error("app-update: downloadsBase 为空");
  if (platform === "darwin") {
    return `${base}/desktop/mac/latest/latest-mac.yml`;
  }
  if (platform === "win32") {
    return `${base}/desktop/win/latest/latest.yml`;
  }
  throw new Error(`app-update: 不支持的平台 ${platform}`);
}

/**
 * 手动安装优先 dmg / setup.exe；没有再回落 path（通常是 zip）。
 * @param {{
 *   files: Array<{ url: string, sha512: string, size?: number }>,
 *   path: string,
 *   sha512: string,
 * }} info
 * @param {string} platform
 */
function pickManualInstallFile(info, platform) {
  const files = Array.isArray(info.files) ? info.files : [];
  if (platform === "darwin") {
    const dmg = files.find((file) => /\.dmg$/i.test(file.url));
    if (dmg) return dmg;
  }
  if (platform === "win32") {
    const exe = files.find((file) => /\.exe$/i.test(file.url));
    if (exe) return exe;
  }
  const byPath = files.find((file) => file.url === info.path);
  if (byPath) return byPath;
  if (files[0]) return files[0];
  throw new Error("app-update: 无可下载文件");
}

/**
 * @param {string} downloadsBase
 * @param {string} platform
 * @param {string} fileUrl
 */
function resolveDownloadUrl(downloadsBase, platform, fileUrl) {
  const base = normalizeDownloadsBase(downloadsBase);
  const name = String(fileUrl || "").trim().split(/[\\/]/).pop();
  if (!base || !name || name.includes("..")) {
    throw new Error("app-update: 非法下载文件名");
  }
  if (platform === "darwin") {
    return `${base}/desktop/mac/latest/${name}`;
  }
  if (platform === "win32") {
    return `${base}/desktop/win/latest/${name}`;
  }
  throw new Error(`app-update: 不支持的平台 ${platform}`);
}

/**
 * @param {{
 *   downloadsBase: string,
 *   platform: string,
 *   currentVersion: string,
 *   fetchText?: (url: string) => Promise<string>,
 * }} opts
 */
async function checkForAppUpdate(opts) {
  const platform = opts.platform;
  const feedUrl = resolveUpdateFeedUrl(opts.downloadsBase, platform);
  const fetchText =
    opts.fetchText ||
    (async (url) => {
      const res = await fetch(url, {
        headers: { Accept: "text/yaml, text/plain, */*" },
        redirect: "follow",
      });
      if (!res.ok) {
        throw new Error(`app-update: feed HTTP ${res.status}`);
      }
      return await res.text();
    });
  const text = await fetchText(feedUrl);
  const info = parseUpdateYml(text);
  const file = pickManualInstallFile(info, platform);
  const downloadUrl = resolveDownloadUrl(opts.downloadsBase, platform, file.url);
  const updateAvailable = isNewerVersion(info.version, opts.currentVersion);
  return {
    updateAvailable,
    currentVersion: opts.currentVersion,
    latestVersion: info.version,
    downloadUrl,
    sha512: file.sha512,
    fileName: file.url,
    feedUrl,
  };
}

module.exports = {
  parseUpdateYml,
  compareVersions,
  isNewerVersion,
  resolveUpdateFeedUrl,
  pickManualInstallFile,
  resolveDownloadUrl,
  checkForAppUpdate,
  CHECK_INTERVAL_MS: 4 * 60 * 60 * 1000,
};

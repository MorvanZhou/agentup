/**
 * 写出 electron-updater 兼容的 channel yml（latest.yml / latest-mac.yml）。
 *
 * 哈希为 sha512（base64），字段对齐 electron-builder 的 updateInfo：
 *   version / files[{url,sha512,size}] / path / sha512 / releaseDate
 *
 * 当前上传到 R2 的 latest/ 使用稳定文件名（无版本号）；本脚本按「yml 内 url =
 * 同目录文件名」生成，便于现在做检测+手动下载，以后接公证后直接把
 * electron-updater generic url 指到同一目录复用。
 *
 * 用法:
 *   node write-update-yml.cjs --version 0.1.8 --out latest-mac.yml \
 *     --file AgentUp-arm64-mac.zip=/path/to.zip \
 *     --file AgentUp-arm64.dmg=/path/to.dmg
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

/**
 * @param {string} filePath
 * @returns {{ sha512: string, size: number }}
 */
function hashFile(filePath) {
  const buf = fs.readFileSync(filePath);
  return {
    sha512: crypto.createHash("sha512").update(buf).digest("base64"),
    size: buf.length,
  };
}

/**
 * @param {{
 *   version: string,
 *   files: Array<{ url: string, sha512: string, size: number }>,
 *   releaseDate?: string,
 * }} info
 * @returns {string}
 */
function serializeUpdateInfo(info) {
  if (!info.version || typeof info.version !== "string") {
    throw new Error("write-update-yml: version 必填");
  }
  if (!Array.isArray(info.files) || info.files.length === 0) {
    throw new Error("write-update-yml: 至少需要一个 --file");
  }
  const releaseDate = info.releaseDate || new Date().toISOString();
  const primary = info.files[0];
  const lines = [];
  lines.push(`version: ${info.version}`);
  lines.push("files:");
  for (const file of info.files) {
    lines.push(`  - url: ${file.url}`);
    lines.push(`    sha512: ${file.sha512}`);
    lines.push(`    size: ${file.size}`);
  }
  // path/sha512 兼容 electron-updater 1.x–2.x；mac 上应优先 zip（调用方保证 files[0]）
  lines.push(`path: ${primary.url}`);
  lines.push(`sha512: ${primary.sha512}`);
  lines.push(`releaseDate: '${releaseDate}'`);
  lines.push("");
  return lines.join("\n");
}

/**
 * @param {{
 *   version: string,
 *   entries: Array<{ url: string, filePath: string }>,
 *   releaseDate?: string,
 * }} opts
 */
function buildUpdateInfo(opts) {
  const files = opts.entries.map((entry) => {
    const abs = path.resolve(entry.filePath);
    if (!fs.existsSync(abs)) {
      throw new Error(`write-update-yml: 找不到文件 ${abs}`);
    }
    const { sha512, size } = hashFile(abs);
    return { url: entry.url, sha512, size };
  });
  return {
    version: opts.version,
    files,
    releaseDate: opts.releaseDate,
  };
}

/**
 * @param {{
 *   version: string,
 *   outFile: string,
 *   entries: Array<{ url: string, filePath: string }>,
 *   releaseDate?: string,
 * }} opts
 */
function writeUpdateYml(opts) {
  const info = buildUpdateInfo(opts);
  const body = serializeUpdateInfo(info);
  const out = path.resolve(opts.outFile);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, body, "utf8");
  return { outFile: out, info };
}

function parseArgs(argv) {
  /** @type {{ version: string, outFile: string, entries: Array<{ url: string, filePath: string }>, releaseDate?: string }} */
  const opts = { version: "", outFile: "", entries: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--version") {
      opts.version = String(argv[++i] || "").trim();
    } else if (arg === "--out") {
      opts.outFile = String(argv[++i] || "").trim();
    } else if (arg === "--release-date") {
      opts.releaseDate = String(argv[++i] || "").trim();
    } else if (arg === "--file") {
      const raw = String(argv[++i] || "");
      const eq = raw.indexOf("=");
      if (eq <= 0) {
        throw new Error(`write-update-yml: --file 应为 url=path，收到: ${raw}`);
      }
      opts.entries.push({
        url: raw.slice(0, eq).trim(),
        filePath: raw.slice(eq + 1).trim(),
      });
    } else if (arg === "-h" || arg === "--help") {
      opts.help = true;
    } else {
      throw new Error(`write-update-yml: 未知参数 ${arg}`);
    }
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(`用法: node write-update-yml.cjs --version X.Y.Z --out latest.yml \\
  --file name.ext=/abs/or/rel/path [--file ...]`);
    process.exit(0);
  }
  if (!opts.version || !opts.outFile || opts.entries.length === 0) {
    console.error("write-update-yml: 需要 --version、--out、至少一个 --file");
    process.exit(1);
  }
  const { outFile, info } = writeUpdateYml(opts);
  console.log(`write-update-yml: wrote ${outFile} version=${info.version} files=${info.files.length}`);
}

module.exports = {
  hashFile,
  serializeUpdateInfo,
  buildUpdateInfo,
  writeUpdateYml,
};

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

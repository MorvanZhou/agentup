import fs from "node:fs";
import path from "node:path";

/**
 * Cursor SDK 把 rg 放在 optional 平台包 `@cursor/sdk-<platform>-<arch>/bin/rg`，
 * 但定位时只从 process.argv[1] / execPath 往上走——Electron / 自管安装目录对不上。
 * 公开兜底：启动前设绝对路径的 CURSOR_RIPGREP_PATH（见 cookbook#14）。
 */

export const CURSOR_RIPGREP_ENV = "CURSOR_RIPGREP_PATH";

/** 安装目录内自带的 rg（不存在则 undefined）。 */
export function resolveBundledCursorRipgrepPath(installDir: string): string | undefined {
  const platformPkg = `@cursor/sdk-${process.platform}-${process.arch}`;
  const binName = process.platform === "win32" ? "rg.exe" : "rg";
  const candidate = path.join(installDir, "node_modules", ...platformPkg.split("/"), "bin", binName);
  return isUsableRipgrep(candidate) ? candidate : undefined;
}

/**
 * 保证进程里有可用的 CURSOR_RIPGREP_PATH。
 * - 已有绝对路径且文件可用 → 保留
 * - 否则写入安装目录平台包里的 rg
 */
export function ensureCursorRipgrepPath(installDir: string): string | undefined {
  const configured = process.env[CURSOR_RIPGREP_ENV]?.trim();
  if (configured && path.isAbsolute(configured) && isUsableRipgrep(configured)) {
    return configured;
  }
  const bundled = resolveBundledCursorRipgrepPath(installDir);
  if (bundled) {
    process.env[CURSOR_RIPGREP_ENV] = bundled;
    return bundled;
  }
  return undefined;
}

function isUsableRipgrep(candidate: string): boolean {
  try {
    fs.accessSync(candidate, fs.constants.F_OK);
    const stat = fs.statSync(candidate);
    return stat.isFile();
  } catch {
    return false;
  }
}
